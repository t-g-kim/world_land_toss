-- ─────────────────────────────────────────────────────────────
-- someday — realtime + scalability (no PostGIS required). Run in SQL Editor.
-- Also re-defines buy_property WITHOUT PostGIS (the security version used
-- ST_Area, which isn't available here). Run this AFTER setup-security.sql.
-- ─────────────────────────────────────────────────────────────

-- Coordinate columns for viewport queries.
alter table properties add column if not exists center_lng double precision;
alter table properties add column if not exists center_lat double precision;
create index if not exists idx_properties_center on properties(center_lng, center_lat);

-- Fill center from the 'b:lng,lat[#fN]' id, or from client-provided meta coords.
create or replace function set_property_center()
returns trigger language plpgsql set search_path = public as $$
begin
  if NEW.id ~ '^b:' then
    NEW.center_lng := split_part(substring(NEW.id from 3), ',', 1)::double precision;
    NEW.center_lat := split_part(split_part(substring(NEW.id from 3), ',', 2), '#', 1)::double precision;
  elsif (NEW.meta ? 'centerLng') and (NEW.meta ? 'centerLat') then
    NEW.center_lng := (NEW.meta->>'centerLng')::double precision;
    NEW.center_lat := (NEW.meta->>'centerLat')::double precision;
  end if;
  return NEW;
exception when others then
  return NEW; -- never block a write over a bad coord
end $$;

drop trigger if exists properties_center on properties;
create trigger properties_center before insert or update on properties
  for each row execute function set_property_center();

-- Backfill existing 'b:' rows.
update properties
  set center_lng = split_part(substring(id from 3), ',', 1)::double precision,
      center_lat = split_part(split_part(substring(id from 3), ',', 2), '#', 1)::double precision
  where id ~ '^b:' and center_lng is null;

-- Realtime change feed for live buy/sell/list updates.
do $$ begin
  alter publication supabase_realtime add table properties;
exception when others then null;
end $$;

-- Server-side leaderboard (net worth = balance + owned property value).
create or replace function get_leaderboard(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select p.id, p.username,
        p.balance + coalesce((select sum(pr.price) from properties pr where pr.owner_id = p.id), 0) as net_worth,
        (select count(*) from properties pr where pr.owner_id = p.id) as count
      from profiles p
      order by net_worth desc
      limit p_limit
    ) t
  );
end $$;

-- buy_property WITHOUT PostGIS. Cheap-buy guard = per-kind minimums (soft; no
-- server-side area since PostGIS isn't installed).
create or replace function buy_property(
  p_id text, p_kind text, p_name text,
  p_price bigint, p_income bigint, p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row properties%rowtype; v_bal bigint; v_cost bigint; v_found boolean;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;

  select * into v_row from properties where id = p_id for update;
  v_found := found;
  if v_found and v_row.owner_id = v_uid then return jsonb_build_object('success', false, 'message', '이미 소유한 자산입니다'); end if;

  if v_found and v_row.owner_id is not null then
    if not v_row.for_sale then return jsonb_build_object('success', false, 'message', '판매 중이 아닙니다'); end if;
    v_cost := v_row.list_price; -- trusted server-set listing price
  else
    v_cost := p_price;
    if v_cost is null or v_cost < 1000 then return jsonb_build_object('success', false, 'message', '가격 오류'); end if;
    if p_kind = 'landmark' and v_cost < 1000000000 then return jsonb_build_object('success', false, 'message', '가격 오류'); end if;
    if p_kind in ('building', 'house', 'floor') and v_cost < 10000 then return jsonb_build_object('success', false, 'message', '가격 오류'); end if;
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
