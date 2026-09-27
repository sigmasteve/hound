-- Hound: real-money Bones purchases — a fast-follow to the Bones shop
-- (0060_bones_shop.sql). Lets someone buy Bones with real money instead
-- of only earning them from challenge settlements; bought Bones spend
-- through purchase_cosmetic exactly like earned ones (bones_balance is
-- one number regardless of source).
--
-- Same "ownership/event ledger, not a bare counter" shape
-- cosmetic_purchases and activity_events already use, for the same
-- reason: bones_purchases is the auditable record of what actually
-- happened (which store, which product, which store transaction id), and
-- profiles.bones_balance is just the running total derived from it.
--
-- This migration is purely additive: two new tables and two new
-- functions, granted to nobody. Nothing existing is touched, and no
-- client can call either function directly — see credit_bones_purchase's
-- own comment below for why that's deliberate.
--
-- Run this once, in the SQL Editor.

-- The purchasable catalog — one row per store product id, mirroring
-- cosmetic_items' own "table as catalog" shape. Deliberately seeded with
-- no rows yet: the actual pack sizes/prices are a pricing decision, not
-- an engineering one, and inserting placeholder rows here risks a real
-- store product id later not matching whatever got typed in by hand.
-- Add real rows once the packs are defined in App Store Connect/Play
-- Console, using the same product id string on both stores so no
-- per-platform mapping is ever needed:
--   insert into public.bones_products (id, bones_amount) values
--     ('bones_pack_small', 100), ('bones_pack_medium', 550), ('bones_pack_large', 1200);
create table public.bones_products (
  id text primary key,
  bones_amount int not null check (bones_amount > 0),
  active boolean not null default true
);

alter table public.bones_products enable row level security;

create policy "Anyone signed in can browse the Bones packs"
  on public.bones_products for select
  to authenticated
  using (true);

-- Append-only, same shape as cosmetic_purchases: once credited, always
-- on the record. `unique (store, transaction_id)` is the actual
-- idempotency guard — credit_bones_purchase relies on this constraint
-- (via `on conflict do nothing`) to make a retried webhook delivery or a
-- client's sync-purchase call racing that same webhook both harmless,
-- rather than double-crediting.
create table public.bones_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  store text not null check (store in ('app_store', 'play_store')),
  product_id text not null references public.bones_products (id),
  transaction_id text not null,
  bones_credited int not null,
  status text not null default 'credited' check (status in ('credited', 'refunded')),
  created_at timestamptz not null default now(),
  unique (store, transaction_id)
);

alter table public.bones_purchases enable row level security;

create policy "Users can view their own Bones purchases"
  on public.bones_purchases for select
  to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policy at all — same "every write goes through
-- one function" shape purchase_cosmetic already establishes for
-- cosmetic_purchases. The difference here is *which* function is trusted
-- to call it: a purchase's realness can only be confirmed against
-- RevenueCat/the store itself, which happens in the sync-purchase and
-- revenuecat-webhook Edge Functions, not in a client-callable RPC — see
-- credit_bones_purchase's own revoke below for how that's enforced.
create or replace function public.credit_bones_purchase(
  p_user_id uuid,
  p_store text,
  p_product_id text,
  p_transaction_id text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  product public.bones_products%rowtype;
begin
  select * into product from public.bones_products where id = p_product_id and active;
  if not found then
    raise exception 'Unknown or inactive Bones product: %', p_product_id;
  end if;

  insert into public.bones_purchases (user_id, store, product_id, transaction_id, bones_credited)
  values (p_user_id, p_store, p_product_id, p_transaction_id, product.bones_amount)
  on conflict (store, transaction_id) do nothing;

  -- FOUND reflects whether the INSERT above actually added a row —
  -- false on a conflict, which is exactly the "already credited this
  -- transaction" case this whole function exists to make harmless.
  if found then
    update public.profiles set bones_balance = bones_balance + product.bones_amount where id = p_user_id;
  end if;
end;
$$;

-- Internal only: Postgres grants EXECUTE to PUBLIC by default (unlike
-- tables), which would let any signed-in user credit themselves Bones
-- through RPC with a made-up transaction id — same fix as 0057's own
-- revoke on tictacgo_notify. Only the sync-purchase/revenuecat-webhook
-- Edge Functions' service-role connections can still call this, since
-- service_role bypasses grants entirely.
revoke execute on function public.credit_bones_purchase(uuid, text, text, text) from public, anon, authenticated;

-- The other side of the same ledger: an Apple/Google-initiated refund
-- flips that transaction's row to 'refunded' and claws the balance back
-- — floored at zero rather than letting it go negative, since the Bones
-- may already have been spent in the shop by the time a refund lands.
-- Accepting that loss is simpler and safer than debt-collecting a
-- negative balance from a future purchase.
create or replace function public.refund_bones_purchase(
  p_store text,
  p_transaction_id text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  purchase public.bones_purchases%rowtype;
begin
  select * into purchase from public.bones_purchases
    where store = p_store and transaction_id = p_transaction_id and status = 'credited'
    for update;
  if not found then
    -- Unknown transaction, or already refunded — nothing to do. Not an
    -- error: a refund notification for a purchase we never recorded (or
    -- already processed) is a no-op, not a bug.
    return;
  end if;

  update public.bones_purchases set status = 'refunded' where id = purchase.id;
  update public.profiles
    set bones_balance = greatest(0, bones_balance - purchase.bones_credited)
    where id = purchase.user_id;
end;
$$;

-- Same reasoning as credit_bones_purchase's own revoke above.
revoke execute on function public.refund_bones_purchase(text, text) from public, anon, authenticated;
