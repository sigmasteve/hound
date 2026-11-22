-- Hound: the Prize Counter (Steve, Nov 2026). Mockup:
-- claude.ai/artifact/PQ5Sv4xveiiTj5T9o39Jzh (boards 4 and 5).
--
-- During a Paw Slots challenge (0242) Paw Coins are only the score. When
-- it's settled, every coin a member finished with moves into their Paw
-- Coin wallet (on top of the Bones by place, unchanged), and the wallet
-- adds up across challenges. It buys only the Prize Counter's items, in
-- the Kennel. Those are never sold for Bones (their sale window ended
-- long ago, so buy_kennel_item and gift_kennel_item refuse them), coins
-- never turn into Bones and Bones never into coins, and they're all
-- looks: nothing that helps win a game.
--
--   paw_wallets           one per member: balance, earned, spent
--   paw_wallet_log        every coin in (a challenge) and out (an item)
--   prize_counter_items   what the counter sells, for how many coins
--
-- The items are ordinary kennel_items, so they're worn, placed and shown
-- like any other: two for the neck, a bowl and a ground for the yard, a
-- house, and a neon sign for the room. Their cost_bones is set (so the
-- yard can't place them unowned: free ones are everyone's) but their
-- available_until is in the past, so the Bones shop never sells them.
-- Bought ones skip the Kennel's level gates: they were earned.
--
-- Run this once, after 0242, in the SQL Editor.

-- ── The items ──

insert into public.kennel_items (id, slot, name, cost_bones, available_until) values
  ('neck_lucky7', 'neck', 'Lucky 7 Tag', 300, '2000-01-01'),
  ('collar_goldhound', 'neck', 'Golden Hound Collar', 600, '2000-01-01'),
  ('bowl_coin', 'bowl', 'Gold Coin Bowl', 800, '2000-01-01'),
  ('ground_confetti', 'ground', 'Jackpot Confetti', 1200, '2000-01-01'),
  ('room_neon', 'room', 'Neon Paw Slots Sign', 1500, '2000-01-01'),
  ('house_arcade', 'house', 'Arcade Doghouse', 5000, '2000-01-01')
on conflict (id) do nothing;

create table public.prize_counter_items (
  item_id text primary key references public.kennel_items (id) on delete cascade,
  price int not null check (price > 0 and price <= 100000),
  sort int not null default 0
);
insert into public.prize_counter_items (item_id, price, sort) values
  ('neck_lucky7', 300, 1),
  ('collar_goldhound', 600, 2),
  ('bowl_coin', 800, 3),
  ('ground_confetti', 1200, 4),
  ('room_neon', 1500, 5),
  ('house_arcade', 5000, 6);
alter table public.prize_counter_items enable row level security;
create policy "Anyone signed in can read the Prize Counter"
  on public.prize_counter_items for select to authenticated using (true);
create policy "Only admins can change the Prize Counter"
  on public.prize_counter_items for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
revoke all on public.prize_counter_items from anon;
revoke insert, delete on public.prize_counter_items from authenticated;

-- ── The wallet ──

create table public.paw_wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  earned int not null default 0 check (earned >= 0),
  spent int not null default 0 check (spent >= 0),
  updated_at timestamptz not null default now()
);

create table public.paw_wallet_log (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid references public.challenges (id) on delete set null,
  item_id text references public.kennel_items (id) on delete set null,
  amount int not null,
  created_at timestamptz not null default now()
);
create index paw_wallet_log_user on public.paw_wallet_log (user_id, created_at desc);
-- One credit a member a challenge.
create unique index paw_wallet_log_once on public.paw_wallet_log (user_id, challenge_id) where challenge_id is not null;

alter table public.paw_wallets enable row level security;
alter table public.paw_wallet_log enable row level security;
create policy "Members see their own wallet"
  on public.paw_wallets for select to authenticated using (user_id = auth.uid());
create policy "Members see their own wallet log"
  on public.paw_wallet_log for select to authenticated using (user_id = auth.uid());
revoke all on public.paw_wallets, public.paw_wallet_log from anon;
revoke insert, update, delete on public.paw_wallets, public.paw_wallet_log from authenticated;

-- When a Paw Slots challenge is settled (its slots_result rows go in),
-- each member's coins go to their wallet, once.
create or replace function public.paw_wallet_on_settle()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  coins int;
begin
  if new.kind is distinct from 'slots_result' or new.challenge_id is null then
    return new;
  end if;
  select sp.coins into coins from public.slots_players sp where sp.challenge_id = new.challenge_id and sp.user_id = new.user_id;
  if coalesce(coins, 0) <= 0 then
    return new;
  end if;
  insert into public.paw_wallet_log (user_id, challenge_id, amount) values (new.user_id, new.challenge_id, coins)
  on conflict do nothing;
  if found then
    insert into public.paw_wallets (user_id, balance, earned) values (new.user_id, coins, coins)
    on conflict (user_id) do update set balance = public.paw_wallets.balance + excluded.balance,
                                        earned = public.paw_wallets.earned + excluded.earned, updated_at = now();
  end if;
  return new;
end;
$$;
revoke execute on function public.paw_wallet_on_settle() from public, anon, authenticated;
create trigger paw_wallet_on_settle
  after insert on public.activity_events
  for each row execute procedure public.paw_wallet_on_settle();

-- ── What the app does ──

-- The wallet, the counter and what came in lately.
create or replace function public.prize_counter_state()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  w public.paw_wallets%rowtype;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into w from public.paw_wallets where user_id = me;
  return jsonb_build_object(
    'balance', coalesce(w.balance, 0),
    'earned', coalesce(w.earned, 0),
    'spent', coalesce(w.spent, 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.item_id, 'name', i.name, 'slot', i.slot, 'price', p.price,
               'owned', exists (select 1 from public.kennel_purchases pu where pu.user_id = me and pu.item_id = p.item_id))
               order by p.sort, p.price)
      from public.prize_counter_items p join public.kennel_items i on i.id = p.item_id
    ), '[]'::jsonb),
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object('challengeId', l.challenge_id, 'name', c.name, 'amount', l.amount, 'at', l.created_at) order by l.created_at desc)
      from (select * from public.paw_wallet_log l where l.user_id = me and l.challenge_id is not null order by l.created_at desc limit 10) l
      left join public.challenges c on c.id = l.challenge_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.prize_counter_state() from public, anon;
grant execute on function public.prize_counter_state() to authenticated;

-- An item for Paw Coins.
create or replace function public.prize_counter_buy(p_item_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  price int;
  have int;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select p.price into price from public.prize_counter_items p where p.item_id = p_item_id;
  if not found then
    raise exception 'That isn''t on the Prize Counter.';
  end if;
  if exists (select 1 from public.kennel_purchases pu where pu.user_id = me and pu.item_id = p_item_id) then
    raise exception 'You already have that.';
  end if;
  select w.balance into have from public.paw_wallets w where w.user_id = me for update;
  if coalesce(have, 0) < price then
    raise exception 'That''s % Paw Coins and you have %.', price, coalesce(have, 0);
  end if;
  update public.paw_wallets set balance = balance - price, spent = spent + price, updated_at = now() where user_id = me;
  insert into public.kennel_purchases (user_id, item_id, bones) values (me, p_item_id, 0);
  insert into public.paw_wallet_log (user_id, item_id, amount) values (me, p_item_id, -price);
  return public.prize_counter_state();
end;
$$;
revoke execute on function public.prize_counter_buy(text) from public, anon;
grant execute on function public.prize_counter_buy(text) to authenticated;

-- ── Admin → Overview → Hound → Prize Counter ──

create or replace function public.admin_prize_counter_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'wallets', (select count(*) from public.paw_wallets w where w.earned > 0),
    'withCoins', (select count(*) from public.paw_wallets w where w.balance > 0),
    'earned', (select coalesce(sum(w.earned), 0) from public.paw_wallets w),
    'spent', (select coalesce(sum(w.spent), 0) from public.paw_wallets w),
    'balance', (select coalesce(sum(w.balance), 0) from public.paw_wallets w),
    'buyers', (select count(distinct l.user_id) from public.paw_wallet_log l where l.item_id is not null),
    'bought', (select count(*) from public.paw_wallet_log l where l.item_id is not null),
    'bought7d', (select count(*) from public.paw_wallet_log l where l.item_id is not null and l.created_at > now() - interval '7 days'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.item_id, 'name', i.name, 'price', p.price,
               'sold', (select count(*) from public.paw_wallet_log l where l.item_id = p.item_id)) order by p.sort)
      from public.prize_counter_items p join public.kennel_items i on i.id = p.item_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_prize_counter_overview() from public, anon;
grant execute on function public.admin_prize_counter_overview() to authenticated;
