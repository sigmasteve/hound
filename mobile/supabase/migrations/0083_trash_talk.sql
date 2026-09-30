-- Hound: trash talk — a short message wall on each challenge.
--
--   Taunts     one-tap lines ("Catch me if you can 🐾", "I'm 4,200 steps
--              ahead of Casey 😏"). The text is built here from a fixed
--              list, so a taunt can never carry anything a person typed.
--   Free text  up to 140 characters, in challenges that aren't global
--              (0075) — those are full of strangers, so taunts only.
--
-- Admin → Trash talk (trash_talk_config):
--   * free_text_enabled — the kill switch. Off: nobody can post free text,
--     and every free-text message already posted disappears from every
--     wall straight away (taunts stay). On again: they come back.
--   * filter_profanity — masks common swear words ("f***"). Slurs are
--     always refused, whatever this is set to.
--   * retention_days — how long a challenge's wall is kept after the
--     challenge ends (0, 3, 7 or 30). The wall is read-only once it ends.
--
-- Safety: anyone can mute a person (their messages disappear from your
-- walls), report a message (it goes to Admin → Trash talk, where it can be
-- removed), and delete their own messages.
--
-- Storage: challenge_messages lives in this database like everything
-- else. purge_social_data() runs daily on pg_cron and deletes a finished
-- challenge's messages once its retention_days have passed (a message
-- with an open report is kept until an admin deals with it), caps any one
-- wall at its newest 500 messages, and also clears out old nudges and
-- reactions (0082), which only ever show for a day.
--
-- New messages push the rest of the challenge through send-social-push
-- (0082's social_notify), at most one trash-talk push per person per
-- challenge every 2 hours, respecting mutes and each person's
-- "Nudges, reactions & trash talk" setting. Anyone can also mute one
-- challenge's trash talk (trash_talk_challenge_mutes): no pushes from
-- that challenge's wall, which still shows every message.
--
-- Before running: redeploy the function —
--   supabase functions deploy send-social-push
--
-- Run this once, after 0001-0082, in the SQL Editor.

-- ── Settings ─────────────────────────────────────────────────────────

create table public.trash_talk_config (
  id boolean primary key default true,
  constraint trash_talk_config_singleton check (id),
  free_text_enabled boolean not null default true,
  filter_profanity boolean not null default true,
  retention_days int not null default 7 check (retention_days in (0, 3, 7, 30)),
  updated_at timestamptz not null default now()
);

insert into public.trash_talk_config (id) values (true);

alter table public.trash_talk_config enable row level security;

create policy "Anyone signed in can read the trash talk config"
  on public.trash_talk_config for select
  to authenticated
  using (true);

create policy "Only admins can update the trash talk config"
  on public.trash_talk_config for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── Tables ───────────────────────────────────────────────────────────

create table public.challenge_messages (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('taunt', 'text')),
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now(),
  -- Removed by an admin after a report.
  hidden_at timestamptz,
  -- Deleted by its author. Kept (out of sight) only while reported.
  deleted_at timestamptz
);

create index challenge_messages_challenge_created on public.challenge_messages (challenge_id, created_at desc);
create index challenge_messages_user_created on public.challenge_messages (user_id, created_at desc);

create table public.challenge_message_reports (
  message_id uuid not null references public.challenge_messages (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (message_id, reporter_id)
);

create table public.trash_talk_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_user_id),
  check (user_id <> muted_user_id)
);

-- Challenges whose trash talk someone doesn't want pushed to them.
create table public.trash_talk_challenge_mutes (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

-- When each person last got a trash-talk push for each challenge.
create table public.trash_talk_pushes (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_at timestamptz not null,
  primary key (challenge_id, user_id)
);

-- All written only through the functions below.
alter table public.challenge_messages enable row level security;
alter table public.challenge_message_reports enable row level security;
alter table public.trash_talk_mutes enable row level security;
alter table public.trash_talk_pushes enable row level security;
alter table public.trash_talk_challenge_mutes enable row level security;

create policy "Users can see their own mutes"
  on public.trash_talk_mutes for select
  to authenticated
  using (user_id = auth.uid());

-- ── Text rules ───────────────────────────────────────────────────────

-- Slurs are never posted. Matched loosely (repeated letters, common
-- swaps) on a lowercased copy.
create or replace function public.trash_talk_has_slur(p_text text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(p_text) ~ '\m((n+[i1!|]+[g69]+[g69]+([e3]+r+|[a@4]+h?|u+h))|(f+[a@4]+[g69]+([o0]+t+)?s?\M)|(r+[e3]+t+[a@4]+r+d+([e3]+d|s)?\M)|(k+[i1!]+k+[e3]+s?\M)|(c+h+[i1!]+n+k+s?\M)|(s+p+[i1!]+c+s?\M)|(t+r+[a@4]+n+n+(y|[i1!][e3])+s?\M))';
$$;

-- Masks common swear words when the filter is on: "f***".
create or replace function public.trash_talk_mask(p_text text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  w text;
  result text := p_text;
begin
  foreach w in array array[
    'motherfucking', 'motherfucker', 'fucking', 'fucker', 'fucked', 'fuck',
    'bullshit', 'shitty', 'shit', 'bitches', 'bitch', 'asshole', 'bastard',
    'cunt', 'dickhead', 'dick', 'pussy', 'cock', 'slut', 'whore', 'twat', 'wanker', 'prick'
  ] loop
    result := regexp_replace(
      result,
      '\m' || w || '\M',
      left(w, 1) || repeat('*', char_length(w) - 1),
      'gi'
    );
  end loop;
  return result;
end;
$$;

-- "4,200 steps" / "3.5 mi" / "2 squares" / "5 days".
create or replace function public.trash_talk_amount(p_n numeric, p_unit text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_unit
    when 'mi' then trim(to_char(round(p_n, 1), 'FM999,990.0')) || ' mi'
    when 'squares' then round(p_n)::int || case when round(p_n) = 1 then ' square' else ' squares' end
    when 'days' then round(p_n)::int || case when round(p_n) = 1 then ' day' else ' days' end
    else trim(to_char(round(p_n), 'FM999,999,999')) || case when round(p_n) = 1 then ' step' else ' steps' end
  end;
$$;

-- ── Status ───────────────────────────────────────────────────────────

-- What the wall can do right now for the caller.
create or replace function public.trash_talk_status(p_challenge_id uuid)
returns table (
  can_post boolean,
  free_text_allowed boolean,
  free_text_reason text,
  read_only boolean,
  retention_days int,
  pushes_muted boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg public.trash_talk_config;
  c public.challenges;
  participant boolean;
  ended boolean;
begin
  select * into cfg from public.trash_talk_config;
  select * into c from public.challenges where id = p_challenge_id;
  participant := public.is_challenge_participant(p_challenge_id, auth.uid());
  ended := c.ends_at is not null and c.ends_at <= now();
  return query select
    participant and not ended,
    participant and not ended and cfg.free_text_enabled and not coalesce(c.is_global, false),
    case
      when not cfg.free_text_enabled then 'off'
      when coalesce(c.is_global, false) then 'global'
      when ended then 'ended'
      else null
    end,
    ended,
    cfg.retention_days,
    exists (
      select 1 from public.trash_talk_challenge_mutes cm
      where cm.challenge_id = p_challenge_id and cm.user_id = auth.uid()
    );
end;
$$;

-- ── Posting ──────────────────────────────────────────────────────────

-- Post a taunt (p_taunt, with p_target / p_n / p_unit where it uses them)
-- or free text (p_body). Returns the new message's id.
create or replace function public.post_trash_talk(
  p_challenge_id uuid,
  p_body text default null,
  p_taunt text default null,
  p_target uuid default null,
  p_n numeric default null,
  p_unit text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.trash_talk_config;
  c public.challenges;
  target_name text;
  msg_kind text;
  msg text;
  new_id uuid;
  recent int;
  recipients uuid[];
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or not public.is_challenge_participant(p_challenge_id, me) then
    raise exception 'Only people in this challenge can talk trash here.';
  end if;
  if c.ends_at <= now() then
    raise exception 'This challenge is over — the wall is read-only now.';
  end if;
  select * into cfg from public.trash_talk_config;

  select count(*) into recent from public.challenge_messages m
    where m.user_id = me and m.challenge_id = p_challenge_id and m.created_at > now() - interval '5 minutes';
  if recent >= 8 then
    raise exception 'Easy there — give it a few minutes before posting again.';
  end if;

  if p_taunt is not null then
    msg_kind := 'taunt';
    if p_target is not null then
      if p_target = me or not public.is_challenge_participant(p_challenge_id, p_target) then
        raise exception 'Pick someone in this challenge.';
      end if;
      select case when p.use_username and p.username is not null then p.username else split_part(p.name, ' ', 1) end
        into target_name from public.profiles p where p.id = p_target;
    end if;
    if p_taunt in ('coming_for', 'ahead_by', 'behind_by', 'wake_up') and target_name is null then
      raise exception 'That one needs someone to aim at.';
    end if;
    if p_taunt in ('ahead_by', 'behind_by') and (p_n is null or p_n <= 0 or p_n > 10000000
        or coalesce(p_unit, 'steps') not in ('steps', 'mi', 'squares', 'days')) then
      raise exception 'That one needs a number.';
    end if;
    msg := case p_taunt
      when 'catch_me' then 'Catch me if you can 🐾'
      when 'rearview' then 'See you in my rearview 👋'
      when 'all_you_got' then 'Is that all you got?'
      when 'couch' then 'Somebody''s couch is getting comfy 🛋️'
      when 'warming_up' then 'I''m just warming up 🔥'
      when 'coming_for' then target_name || ', I''m coming for you 👀'
      when 'ahead_by' then 'I''m ' || public.trash_talk_amount(p_n, coalesce(p_unit, 'steps')) || ' ahead of ' || target_name || ' 😏'
      when 'behind_by' then 'Only ' || public.trash_talk_amount(p_n, coalesce(p_unit, 'steps')) || ' behind ' || target_name || '… for now 😤'
      when 'wake_up' then 'Wake up, ' || target_name || '! ⏰'
      else null
    end;
    if msg is null then
      raise exception 'That taunt isn''t available.';
    end if;
  else
    msg_kind := 'text';
    if not cfg.free_text_enabled then
      raise exception 'Typed messages are turned off right now — try a taunt instead.';
    end if;
    if coalesce(c.is_global, false) then
      raise exception 'Global challenges are taunts only.';
    end if;
    msg := regexp_replace(trim(coalesce(p_body, '')), '\s+', ' ', 'g');
    if msg = '' then
      raise exception 'Write something first.';
    end if;
    if char_length(msg) > 140 then
      raise exception 'Keep it to 140 characters.';
    end if;
    if public.trash_talk_has_slur(msg) then
      raise exception 'That message can''t be posted.';
    end if;
    if cfg.filter_profanity then
      msg := public.trash_talk_mask(msg);
    end if;
  end if;

  insert into public.challenge_messages (challenge_id, user_id, kind, body)
    values (p_challenge_id, me, msg_kind, msg)
    returning id into new_id;

  -- Push everyone else who hasn't had one for this challenge in the last
  -- 2 hours, hasn't muted the author or this challenge's trash talk, and
  -- can get these pushes.
  select coalesce(array_agg(cp.user_id), '{}') into recipients
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id
    and cp.user_id <> me
    and public.social_push_reachable(cp.user_id)
    and not exists (select 1 from public.trash_talk_mutes mu where mu.user_id = cp.user_id and mu.muted_user_id = me)
    and not exists (
      select 1 from public.trash_talk_challenge_mutes cm
      where cm.challenge_id = p_challenge_id and cm.user_id = cp.user_id
    )
    and not exists (
      select 1 from public.trash_talk_pushes tp
      where tp.challenge_id = p_challenge_id and tp.user_id = cp.user_id and tp.last_at > now() - interval '2 hours'
    );

  if array_length(recipients, 1) > 0 then
    insert into public.trash_talk_pushes (challenge_id, user_id, last_at)
      select p_challenge_id, r, now() from unnest(recipients) r
      on conflict (challenge_id, user_id) do update set last_at = excluded.last_at;
    perform public.social_notify(jsonb_build_object(
      'kind', 'trash_talk', 'from_user', me, 'challenge_id', p_challenge_id,
      'to_users', to_jsonb(recipients), 'message', msg));
  end if;

  return new_id;
end;
$$;

-- ── Reading ──────────────────────────────────────────────────────────

-- The newest messages on a challenge's wall, oldest first. Leaves out
-- people the caller muted, removed and deleted messages, and — while the
-- kill switch is off — every free-text message.
create or replace function public.list_trash_talk(p_challenge_id uuid, p_limit int default 50)
returns table (
  id uuid,
  user_id uuid,
  name text,
  initials text,
  frame_id text,
  background_id text,
  icon_id text,
  kind text,
  body text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select m.id, m.user_id,
      case when p.use_username and p.username is not null then p.username else p.name end,
      p.initials, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id,
      m.kind, m.body, m.created_at
    from public.challenge_messages m
    join public.profiles p on p.id = m.user_id
    where m.challenge_id = p_challenge_id
      and public.is_challenge_participant(p_challenge_id, auth.uid())
      and m.hidden_at is null
      and m.deleted_at is null
      and (m.kind = 'taunt' or (select free_text_enabled from public.trash_talk_config))
      and not exists (
        select 1 from public.trash_talk_mutes mu where mu.user_id = auth.uid() and mu.muted_user_id = m.user_id
      )
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) newest
  order by created_at;
$$;

-- People the caller has muted, for the wall's "Muted" line.
create or replace function public.my_trash_talk_mutes()
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select mu.muted_user_id,
    case when p.use_username and p.username is not null then p.username else p.name end
  from public.trash_talk_mutes mu
  join public.profiles p on p.id = mu.muted_user_id
  where mu.user_id = auth.uid()
  order by 2;
$$;

-- ── Your own actions ─────────────────────────────────────────────────

create or replace function public.delete_trash_talk(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.challenge_messages set deleted_at = now()
    where id = p_message_id and user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'You can only delete your own messages.';
  end if;
  -- Nothing left to review: gone for good unless someone reported it.
  delete from public.challenge_messages m
    where m.id = p_message_id
      and not exists (select 1 from public.challenge_message_reports r where r.message_id = m.id and r.resolved_at is null);
end;
$$;

create or replace function public.report_trash_talk(p_message_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.challenge_messages;
begin
  select * into m from public.challenge_messages where id = p_message_id;
  if m.id is null or not public.is_challenge_participant(m.challenge_id, auth.uid()) then
    raise exception 'That message isn''t available.';
  end if;
  if m.user_id = auth.uid() then
    raise exception 'You can delete your own message instead.';
  end if;
  insert into public.challenge_message_reports (message_id, reporter_id, reason)
    values (p_message_id, auth.uid(), left(nullif(trim(coalesce(p_reason, '')), ''), 200))
    on conflict (message_id, reporter_id) do update
      set reason = excluded.reason, created_at = now(), resolved_at = null;
end;
$$;

create or replace function public.set_trash_talk_mute(p_user uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_user is null or p_user = auth.uid() then
    raise exception 'You can''t mute that person.';
  end if;
  if p_muted then
    insert into public.trash_talk_mutes (user_id, muted_user_id) values (auth.uid(), p_user)
      on conflict do nothing;
  else
    delete from public.trash_talk_mutes where user_id = auth.uid() and muted_user_id = p_user;
  end if;
end;
$$;

-- Stop (or restart) trash-talk pushes from one challenge.
create or replace function public.set_trash_talk_challenge_muted(p_challenge_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_challenge_participant(p_challenge_id, auth.uid()) then
    raise exception 'Only people in this challenge can do that.';
  end if;
  if p_muted then
    insert into public.trash_talk_challenge_mutes (challenge_id, user_id) values (p_challenge_id, auth.uid())
      on conflict do nothing;
  else
    delete from public.trash_talk_challenge_mutes where challenge_id = p_challenge_id and user_id = auth.uid();
  end if;
end;
$$;

-- ── Admin ────────────────────────────────────────────────────────────

-- Reported messages that still need a decision, most-reported first.
create or replace function public.admin_trash_talk_reports()
returns table (
  message_id uuid,
  body text,
  kind text,
  author_id uuid,
  author_name text,
  challenge_id uuid,
  challenge_name text,
  posted_at timestamptz,
  report_count int,
  reasons text[],
  last_reported_at timestamptz,
  hidden boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can do that.';
  end if;
  return query
    select m.id, m.body, m.kind, m.user_id, a.name, m.challenge_id, c.name, m.created_at,
      count(r.*)::int,
      array_remove(array_agg(r.reason order by r.created_at desc), null),
      max(r.created_at),
      m.hidden_at is not null
    from public.challenge_message_reports r
    join public.challenge_messages m on m.id = r.message_id
    join public.profiles a on a.id = m.user_id
    join public.challenges c on c.id = m.challenge_id
    where r.resolved_at is null
    group by m.id, a.name, c.name
    order by count(r.*) desc, max(r.created_at) desc;
end;
$$;

-- Remove the message (p_remove) or keep it, and close its reports.
create or replace function public.admin_resolve_trash_talk(p_message_id uuid, p_remove boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can do that.';
  end if;
  if p_remove then
    update public.challenge_messages set hidden_at = coalesce(hidden_at, now()) where id = p_message_id;
  end if;
  update public.challenge_message_reports set resolved_at = now()
    where message_id = p_message_id and resolved_at is null;
  -- A removed or author-deleted message with nothing left to review.
  delete from public.challenge_messages m
    where m.id = p_message_id and (m.hidden_at is not null or m.deleted_at is not null);
end;
$$;

-- ── Cleanup ──────────────────────────────────────────────────────────

create or replace function public.purge_social_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  keep_days int := (select retention_days from public.trash_talk_config);
begin
  -- A finished challenge's wall, once its retention has passed. A message
  -- with an open report waits for an admin.
  delete from public.challenge_messages m
    using public.challenges c
    where c.id = m.challenge_id
      and c.ends_at < now() - make_interval(days => keep_days)
      and not exists (select 1 from public.challenge_message_reports r where r.message_id = m.id and r.resolved_at is null);

  -- No wall keeps more than its newest 500.
  delete from public.challenge_messages m
    where m.id in (
      select ranked.id from (
        select x.id, row_number() over (partition by x.challenge_id order by x.created_at desc) as rn
        from public.challenge_messages x
      ) ranked
      where ranked.rn > 500
    )
    and not exists (select 1 from public.challenge_message_reports r where r.message_id = m.id and r.resolved_at is null);

  delete from public.challenge_message_reports where resolved_at < now() - interval '30 days';
  delete from public.trash_talk_pushes where last_at < now() - interval '1 day';
  delete from public.trash_talk_challenge_mutes cm
    using public.challenges c
    where c.id = cm.challenge_id and c.ends_at < now() - interval '1 day';

  -- 0082's nudges and reactions only ever show for a day.
  delete from public.nudges where created_at < now() - interval '7 days';
  delete from public.challenge_reactions where day < current_date - 2;
  delete from public.reaction_pushes where day < current_date - 2;
end;
$$;

revoke execute on function public.purge_social_data() from public, anon, authenticated;
revoke execute on function public.trash_talk_has_slur(text) from public, anon;
revoke execute on function public.trash_talk_mask(text) from public, anon;
revoke execute on function public.trash_talk_amount(numeric, text) from public, anon;

-- 09:17 UTC daily.
select cron.schedule('hound-purge-social-data', '17 9 * * *', $$ select public.purge_social_data(); $$);

-- ── Grants ───────────────────────────────────────────────────────────

revoke execute on function public.trash_talk_status(uuid) from public, anon;
grant execute on function public.trash_talk_status(uuid) to authenticated;
revoke execute on function public.post_trash_talk(uuid, text, text, uuid, numeric, text) from public, anon;
grant execute on function public.post_trash_talk(uuid, text, text, uuid, numeric, text) to authenticated;
revoke execute on function public.list_trash_talk(uuid, int) from public, anon;
grant execute on function public.list_trash_talk(uuid, int) to authenticated;
revoke execute on function public.my_trash_talk_mutes() from public, anon;
grant execute on function public.my_trash_talk_mutes() to authenticated;
revoke execute on function public.delete_trash_talk(uuid) from public, anon;
grant execute on function public.delete_trash_talk(uuid) to authenticated;
revoke execute on function public.report_trash_talk(uuid, text) from public, anon;
grant execute on function public.report_trash_talk(uuid, text) to authenticated;
revoke execute on function public.set_trash_talk_mute(uuid, boolean) from public, anon;
grant execute on function public.set_trash_talk_mute(uuid, boolean) to authenticated;
revoke execute on function public.set_trash_talk_challenge_muted(uuid, boolean) from public, anon;
grant execute on function public.set_trash_talk_challenge_muted(uuid, boolean) to authenticated;
revoke execute on function public.admin_trash_talk_reports() from public, anon;
grant execute on function public.admin_trash_talk_reports() to authenticated;
revoke execute on function public.admin_resolve_trash_talk(uuid, boolean) from public, anon;
grant execute on function public.admin_resolve_trash_talk(uuid, boolean) to authenticated;
