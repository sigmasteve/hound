-- Hound: admins can give a member Bones (Steve, Nov 2026).
--
-- Admin → People → a member → Give Bones: an amount and an optional note.
-- They land in the member's spendable balance (bones_balance) only, never
-- in bones_earned_total, so they don't open locked games (0067, 0217):
-- like bought Bones, they're for spending. Every grant is kept in
-- admin_bones_grants, with who gave it and why.
--
--   admin_give_bones(user, bones, note)   gives them; returns the new balance
--   admin_member_bones(user)              their balance, earned total and
--                                         the last grants, for the card
--   admin_bones_grants_overview()         the totals, for Admin → Overview →
--                                         Hound → Bones given
--
-- Run this once, after 0001-0217, in the SQL Editor.

create table if not exists public.admin_bones_grants (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  bones integer not null check (bones between 1 and 10000),
  note text check (note is null or char_length(note) <= 140),
  created_at timestamptz not null default now()
);
create index if not exists admin_bones_grants_user on public.admin_bones_grants (user_id, created_at desc);

alter table public.admin_bones_grants enable row level security;
revoke all on public.admin_bones_grants from anon, authenticated;

create or replace function public.admin_give_bones(p_user uuid, p_bones integer, p_note text default null)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  balance integer;
begin
  perform public.admin_require();
  if p_bones is null or p_bones < 1 or p_bones > 10000 then
    raise exception 'Give between 1 and 10,000 Bones.';
  end if;
  if clean_note is not null and char_length(clean_note) > 140 then
    raise exception 'Keep the note to 140 characters.';
  end if;
  -- The spendable balance only: not bones_earned_total.
  update public.profiles p
    set bones_balance = coalesce(p.bones_balance, 0) + p_bones
    where p.id = p_user
    returning p.bones_balance into balance;
  if not found then
    raise exception 'No such member.';
  end if;
  insert into public.admin_bones_grants (admin_id, user_id, bones, note)
    values (auth.uid(), p_user, p_bones, clean_note);
  return balance;
end;
$$;
revoke execute on function public.admin_give_bones(uuid, integer, text) from public, anon;
grant execute on function public.admin_give_bones(uuid, integer, text) to authenticated;

create or replace function public.admin_member_bones(p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  perform public.admin_require();
  return (
    select jsonb_build_object(
      'balance', coalesce(p.bones_balance, 0),
      'earned', coalesce(p.bones_earned_total, 0),
      'given_total', (select coalesce(sum(g.bones), 0) from public.admin_bones_grants g where g.user_id = p_user),
      'grants', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'bones', g.bones,
          'note', g.note,
          'by', coalesce(a.name, 'An admin'),
          'at', g.created_at
        ) order by g.created_at desc), '[]'::jsonb)
        from (select * from public.admin_bones_grants g where g.user_id = p_user order by g.created_at desc limit 5) g
        left join public.profiles a on a.id = g.admin_id
      )
    )
    from public.profiles p
    where p.id = p_user
  );
end;
$$;
revoke execute on function public.admin_member_bones(uuid) from public, anon;
grant execute on function public.admin_member_bones(uuid) to authenticated;

create or replace function public.admin_bones_grants_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  perform public.admin_require();
  return jsonb_build_object(
    'bones_30d', (select coalesce(sum(g.bones), 0) from public.admin_bones_grants g where g.created_at > now() - interval '30 days'),
    'grants_30d', (select count(*) from public.admin_bones_grants g where g.created_at > now() - interval '30 days'),
    'people_30d', (select count(distinct g.user_id) from public.admin_bones_grants g where g.created_at > now() - interval '30 days'),
    'bones_all', (select coalesce(sum(g.bones), 0) from public.admin_bones_grants g),
    'people_all', (select count(distinct g.user_id) from public.admin_bones_grants g),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(u.name, 'Someone'),
        'bones', g.bones,
        'note', g.note,
        'by', coalesce(a.name, 'An admin'),
        'at', g.created_at
      ) order by g.created_at desc), '[]'::jsonb)
      from (select * from public.admin_bones_grants g order by g.created_at desc limit 10) g
      left join public.profiles u on u.id = g.user_id
      left join public.profiles a on a.id = g.admin_id
    )
  );
end;
$$;
revoke execute on function public.admin_bones_grants_overview() from public, anon;
grant execute on function public.admin_bones_grants_overview() to authenticated;
