-- ─────────────────────────────────────────────────────────────
-- someday — server-side validation (anti-cheat). Run in SQL Editor.
-- Closes: (1) minting money via add_balance, (2) buying properties too cheap.
-- Rewards are now server-authoritative; add_balance is removed.
-- ─────────────────────────────────────────────────────────────

-- Server-tracked daily clicks + claimed goals.
alter table profiles add column if not exists clicks_today int  not null default 0;
alter table profiles add column if not exists clicks_day   date;
alter table profiles add column if not exists claimed_goals text[] not null default '{}';

-- ── Clicker: server enforces the daily cap (client can't mint) ──
create or replace function click_reward(p_clicks int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
  v_reward constant bigint := 10000; v_limit constant int := 400;
  v_day date; v_used int; v_grant int; v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  if p_clicks is null or p_clicks < 1 then return jsonb_build_object('success', false); end if;
  p_clicks := least(p_clicks, v_limit); -- ignore absurd batches
  select clicks_today, clicks_day into v_used, v_day from profiles where id = v_uid for update;
  if v_day is distinct from current_date then v_used := 0; end if;
  v_grant := least(p_clicks, greatest(0, v_limit - v_used));
  update profiles set clicks_today = v_used + v_grant, clicks_day = current_date,
         balance = balance + v_grant::bigint * v_reward
   where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'granted', v_grant, 'balance', v_bal, 'left', v_limit - (v_used + v_grant));
end $$;

-- ── Rewarded ads: reward comes from the ads table, once/day per ad ──
create table if not exists ad_claims (
  user_id uuid not null, ad_id uuid not null, day date not null default current_date,
  primary key (user_id, ad_id, day)
);
alter table ad_claims enable row level security; -- RPC-only

create or replace function watch_ad(p_ad_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_reward bigint; v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  select reward into v_reward from ads where id = p_ad_id and active = true;
  if v_reward is null then return jsonb_build_object('success', false, 'message', '광고를 찾을 수 없습니다'); end if;
  begin
    insert into ad_claims(user_id, ad_id) values (v_uid, p_ad_id);
  exception when unique_violation then
    return jsonb_build_object('success', false, 'message', '오늘은 이미 시청했어요');
  end;
  update profiles set balance = balance + v_reward where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'reward', v_reward, 'balance', v_bal);
end $$;

-- ── Goals: server verifies the condition + not-yet-claimed ──
create or replace function claim_goal(p_goal text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_reward bigint; v_ok boolean := false; v_bal bigint;
  v_owned int; v_networth bigint; v_claimed text[];
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  select claimed_goals, balance into v_claimed, v_bal from profiles where id = v_uid for update;
  if p_goal = any(v_claimed) then return jsonb_build_object('success', false, 'message', '이미 수령'); end if;
  select count(*), coalesce(sum(price), 0) into v_owned, v_networth from properties where owner_id = v_uid;
  v_networth := v_networth + v_bal;
  case p_goal
    when 'first'    then v_ok := v_owned >= 1;  v_reward := 20000;
    when 'own3'     then v_ok := v_owned >= 3;  v_reward := 60000;
    when 'own10'    then v_ok := v_owned >= 10; v_reward := 300000;
    when 'nw1m'     then v_ok := v_networth >= 1000000;   v_reward := 100000;
    when 'nw10m'    then v_ok := v_networth >= 10000000;  v_reward := 800000;
    when 'nw100m'   then v_ok := v_networth >= 100000000; v_reward := 5000000;
    when 'district' then v_ok := exists(select 1 from properties where owner_id = v_uid and kind = 'district'); v_reward := 100000;
    when 'province' then v_ok := exists(select 1 from properties where owner_id = v_uid and kind = 'province'); v_reward := 500000;
    when 'country'  then v_ok := exists(select 1 from properties where owner_id = v_uid and kind = 'country');  v_reward := 10000000;
    when 'travel'   then v_ok := true; v_reward := 30000; -- not server-tracked; allowed
    else return jsonb_build_object('success', false, 'message', '알 수 없는 목표');
  end case;
  if not v_ok then return jsonb_build_object('success', false, 'message', '아직 달성 전'); end if;
  update profiles set claimed_goals = array_append(claimed_goals, p_goal), balance = balance + v_reward
   where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'reward', v_reward, 'balance', v_bal);
end $$;

-- ── Spend (travel fare): only decreases, with a balance check ──
create or replace function spend(p_amount bigint, p_reason text default 'spend')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > 5000000000 then return jsonb_build_object('success', false, 'message', '금액 오류'); end if;
  select balance into v_bal from profiles where id = v_uid for update;
  if v_bal < p_amount then return jsonb_build_object('success', false, 'message', '잔액이 부족합니다'); end if;
  update profiles set balance = balance - p_amount where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'balance', v_bal);
end $$;

-- ── Remove the mintable add_balance ──
drop function if exists add_balance(bigint, text);

-- ── buy_property: enforce a server-side minimum price (anti "buy for ₩1") ──
create or replace function buy_property(
  p_id text, p_kind text, p_name text,
  p_price bigint, p_income bigint, p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_row properties%rowtype; v_bal bigint; v_cost bigint; v_found boolean;
  v_area double precision; v_floor_min bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;

  select * into v_row from properties where id = p_id for update;
  v_found := found;
  if v_found and v_row.owner_id = v_uid then return jsonb_build_object('success', false, 'message', '이미 소유한 자산입니다'); end if;

  if v_found and v_row.owner_id is not null then
    if not v_row.for_sale then return jsonb_build_object('success', false, 'message', '판매 중이 아닙니다'); end if;
    v_cost := v_row.list_price; -- server-set listing price (trusted)
  else
    v_cost := p_price;          -- bank price (client) → validate below
    -- geometry-based min: area(㎡) × ₩50 floor
    if p_kind in ('building', 'house', 'floor') and (p_meta ? 'geometry') then
      begin v_area := ST_Area(ST_GeomFromGeoJSON(p_meta->>'geometry')::geography); exception when others then v_area := 0; end;
      if v_area > 0 then
        v_floor_min := (v_area * 50)::bigint;
        if v_cost < v_floor_min then return jsonb_build_object('success', false, 'message', '가격이 올바르지 않습니다'); end if;
      end if;
    end if;
    -- per-kind minimums
    if p_kind = 'landmark' and v_cost < 1000000000 then return jsonb_build_object('success', false, 'message', '가격 오류'); end if;
    if p_kind = 'district' and v_cost < 50000 then v_cost := greatest(v_cost, 50000); end if;
    if v_cost < 1000 then return jsonb_build_object('success', false, 'message', '가격 오류'); end if;
  end if;

  select balance into v_bal from profiles where id = v_uid for update;
  if v_bal < v_cost then return jsonb_build_object('success', false, 'message', '잔액이 부족합니다'); end if;

  update profiles set balance = balance - v_cost where id = v_uid;
  if v_found and v_row.owner_id is not null then
    update profiles set balance = balance + v_cost where id = v_row.owner_id;
    update properties set owner_id = v_uid, for_sale = false, list_price = null, price = v_cost, purchased_at = now(), updated_at = now() where id = p_id;
    insert into property_log(property_id, type, buyer_id, seller_id, price) values (p_id, 'player_sale', v_uid, v_row.owner_id, v_cost);
  elsif v_found then
    update properties set owner_id = v_uid, price = v_cost, income_per_hour = coalesce(p_income, v_row.income_per_hour), for_sale = false, list_price = null, purchased_at = now(), updated_at = now() where id = p_id;
    insert into property_log(property_id, type, buyer_id, price) values (p_id, 'purchase', v_uid, v_cost);
  else
    insert into properties(id, kind, name, owner_id, price, income_per_hour, meta, purchased_at)
      values (p_id, p_kind, p_name, v_uid, v_cost, coalesce(p_income, 0), coalesce(p_meta, '{}'::jsonb), now());
    insert into property_log(property_id, type, buyer_id, price) values (p_id, 'purchase', v_uid, v_cost);
  end if;

  select balance into v_bal from profiles where id = v_uid;
  return jsonb_build_object('success', true, 'balance', v_bal, 'price', v_cost);
end $$;
