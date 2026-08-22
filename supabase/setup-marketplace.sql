-- ─────────────────────────────────────────────────────────────
-- someday — shared-world marketplace (Phase 1: schema + RPCs).
-- Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Ownership + money live server-side so players can trade with each other:
-- an owner LISTS a property for sale at a price, and any player can BUY it
-- (money moves seller→? no, buyer→seller) and ownership transfers atomically.
-- Only claimed properties get a row; unclaimed = buy from the "bank".
-- ─────────────────────────────────────────────────────────────

-- Server-side income accrual clock.
alter table profiles add column if not exists income_collected_at timestamptz not null default now();

create table if not exists properties (
  id              text primary key,          -- 'b:lng,lat', 'b:lng,lat#f3', 'district_...', 'country_KOR'
  kind            text not null,             -- building | house | floor | district | province | country
  name            text not null default '',
  owner_id        uuid references profiles(id) on delete set null,
  price           bigint not null default 0, -- current value
  income_per_hour bigint not null default 0,
  for_sale        boolean not null default false,
  list_price      bigint,
  meta            jsonb not null default '{}'::jsonb, -- geometry, floor, zone, etc.
  purchased_at    timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists idx_properties_owner on properties(owner_id);
create index if not exists idx_properties_forsale on properties(for_sale) where for_sale = true;

create table if not exists property_log (
  id          bigint generated always as identity primary key,
  property_id text not null,
  type        text not null,   -- purchase | player_sale | sell_bank | list | unlist
  buyer_id    uuid,
  seller_id   uuid,
  price       bigint,
  created_at  timestamptz not null default now()
);

alter table properties enable row level security;
alter table property_log enable row level security;

-- Anyone can read ownership + listings (to render the map and browse the market).
drop policy if exists properties_select on properties;
create policy properties_select on properties for select using (true);
drop policy if exists property_log_select on property_log;
create policy property_log_select on property_log for select using (true);
-- All writes go through SECURITY DEFINER RPCs; no direct client writes.

-- ── buy: claim from bank (unowned) OR buy a listed property from its owner ──
create or replace function buy_property(
  p_id text, p_kind text, p_name text,
  p_price bigint, p_income bigint, p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row properties%rowtype;
  v_bal bigint;
  v_cost bigint;
  v_found boolean;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;

  select * into v_row from properties where id = p_id for update;
  v_found := found;

  if v_found and v_row.owner_id = v_uid then
    return jsonb_build_object('success', false, 'message', '이미 소유한 자산입니다');
  end if;

  if v_found and v_row.owner_id is not null then
    if not v_row.for_sale then
      return jsonb_build_object('success', false, 'message', '판매 중이 아닙니다');
    end if;
    v_cost := v_row.list_price;
  else
    v_cost := p_price; -- unowned → bank price (client-computed)
  end if;

  select balance into v_bal from profiles where id = v_uid for update;
  if v_bal < v_cost then
    return jsonb_build_object('success', false, 'message', '잔액이 부족합니다');
  end if;

  update profiles set balance = balance - v_cost where id = v_uid;

  if v_found and v_row.owner_id is not null then
    update profiles set balance = balance + v_cost where id = v_row.owner_id; -- pay seller
    update properties set owner_id = v_uid, for_sale = false, list_price = null,
           price = v_cost, purchased_at = now(), updated_at = now() where id = p_id;
    insert into property_log(property_id, type, buyer_id, seller_id, price)
      values (p_id, 'player_sale', v_uid, v_row.owner_id, v_cost);
  elsif v_found then
    update properties set owner_id = v_uid, price = v_cost,
           income_per_hour = coalesce(p_income, v_row.income_per_hour),
           for_sale = false, list_price = null, purchased_at = now(), updated_at = now() where id = p_id;
    insert into property_log(property_id, type, buyer_id, price) values (p_id, 'purchase', v_uid, v_cost);
  else
    insert into properties(id, kind, name, owner_id, price, income_per_hour, meta, purchased_at)
      values (p_id, p_kind, p_name, v_uid, v_cost, coalesce(p_income, 0), coalesce(p_meta, '{}'::jsonb), now());
    insert into property_log(property_id, type, buyer_id, price) values (p_id, 'purchase', v_uid, v_cost);
  end if;

  select balance into v_bal from profiles where id = v_uid;
  return jsonb_build_object('success', true, 'balance', v_bal, 'price', v_cost);
end $$;

-- ── list / unlist ──
create or replace function list_property(p_id text, p_list_price bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  if p_list_price is null or p_list_price <= 0 then return jsonb_build_object('success', false, 'message', '가격이 올바르지 않습니다'); end if;
  update properties set for_sale = true, list_price = p_list_price, updated_at = now()
    where id = p_id and owner_id = v_uid;
  if not found then return jsonb_build_object('success', false, 'message', '소유한 자산이 아닙니다'); end if;
  insert into property_log(property_id, type, seller_id, price) values (p_id, 'list', v_uid, p_list_price);
  return jsonb_build_object('success', true);
end $$;

create or replace function unlist_property(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  update properties set for_sale = false, list_price = null, updated_at = now()
    where id = p_id and owner_id = v_uid;
  if not found then return jsonb_build_object('success', false, 'message', '소유한 자산이 아닙니다'); end if;
  insert into property_log(property_id, type, seller_id) values (p_id, 'unlist', v_uid);
  return jsonb_build_object('success', true);
end $$;

-- ── sell back to bank (70% refund, released for others to re-buy) ──
create or replace function sell_to_bank(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row properties%rowtype; v_refund bigint; v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  select * into v_row from properties where id = p_id for update;
  if not found or v_row.owner_id is distinct from v_uid then
    return jsonb_build_object('success', false, 'message', '소유한 자산이 아닙니다');
  end if;
  v_refund := round(v_row.price * 0.70);
  update profiles set balance = balance + v_refund where id = v_uid returning balance into v_bal;
  update properties set owner_id = null, for_sale = false, list_price = null,
         price = round(v_row.price * 0.85), purchased_at = null, updated_at = now() where id = p_id;
  insert into property_log(property_id, type, seller_id, price) values (p_id, 'sell_bank', v_uid, v_refund);
  return jsonb_build_object('success', true, 'refund', v_refund, 'balance', v_bal);
end $$;

-- ── balance delta (clicker/ad/goal credit, or travel spend). Capped to curb abuse. ──
create or replace function add_balance(p_amount bigint, p_source text default 'reward')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  if p_amount is null or abs(p_amount) > 20000000 then
    return jsonb_build_object('success', false, 'message', '금액이 올바르지 않습니다');
  end if;
  select balance into v_bal from profiles where id = v_uid for update;
  if v_bal + p_amount < 0 then
    return jsonb_build_object('success', false, 'message', '잔액이 부족합니다');
  end if;
  update profiles set balance = v_bal + p_amount where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'balance', v_bal);
end $$;

-- ── collect accrued passive income (called on load / periodically) ──
create or replace function collect_income()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rate bigint; v_last timestamptz; v_secs numeric; v_earned bigint; v_bal bigint;
  v_cap constant int := 8 * 3600; -- max 8h accrual, like the client idle cap
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  select coalesce(sum(income_per_hour), 0) into v_rate from properties where owner_id = v_uid;
  select income_collected_at into v_last from profiles where id = v_uid for update;
  v_secs := least(extract(epoch from (now() - v_last)), v_cap);
  v_earned := floor(v_rate * v_secs / 3600.0);
  update profiles set balance = balance + v_earned, income_collected_at = now()
    where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'earned', v_earned, 'balance', v_bal, 'rate_per_hour', v_rate);
end $$;
