-- ─────────────────────────────────────────────────────────────
-- 건물주(앱인토스) — 서버 전체 설정. 웹 게임(someday)과 같은 Supabase
-- 프로젝트를 쓰되, 테이블·RPC를 전부 `_toss` 접미사로 분리해 데이터가
-- 섞이지 않게 한다. SQL Editor에 통째로 붙여넣고 실행 (재실행 안전).
--
-- 전제: 웹 게임 설정(setup-auth.sql 등)이 이미 실행된 프로젝트.
-- 토스 유저는 toss-login Edge Function이 만드는 @toss.someday.land 계정.
-- ─────────────────────────────────────────────────────────────

-- ══ 0. 웹 게임 트리거 보정 ═══════════════════════════════════
-- 토스 유저가 웹 게임의 profiles(리더보드)에 섞이지 않게 건너뛴다.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_base text; v_username text; v_suffix int := 0;
begin
  if new.email like '%@toss.someday.land' then return new; end if; -- 토스 유저 제외
  v_base := coalesce(
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(split_part(new.email, '@', 1), ''),
    'player'
  );
  v_username := v_base;
  while exists (select 1 from public.profiles where username = v_username) loop
    v_suffix := v_suffix + 1;
    v_username := v_base || v_suffix::text;
  end loop;
  insert into public.profiles (id, username) values (new.id, v_username);
  return new;
end $$;

-- ══ 1. 프로필 ════════════════════════════════════════════════
create table if not exists profiles_toss (
  id                  uuid primary key references auth.users(id) on delete cascade,
  username            text not null,
  balance             bigint not null default 50000,     -- 시작 시드 ₩50,000
  game_state          jsonb not null default '{}'::jsonb,
  claimed_goals       text[] not null default '{}',
  clicks_today        int not null default 0,
  clicks_day          date,
  income_collected_at timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 토스 유저 가입 시 profiles_toss 자동 생성 (이메일 앞부분을 임시 닉네임으로;
-- 실제 닉네임은 온보딩에서 profiles_toss.username 업데이트).
create or replace function handle_new_user_toss()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email not like '%@toss.someday.land' then return new; end if;
  insert into public.profiles_toss (id, username)
    values (new.id, 'player_' || left(split_part(new.email, '@', 1), 8))
    on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_toss on auth.users;
create trigger on_auth_user_created_toss
  after insert on auth.users
  for each row execute function handle_new_user_toss();

create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists profiles_toss_updated_at on profiles_toss;
create trigger profiles_toss_updated_at
  before update on profiles_toss
  for each row execute function update_updated_at();

alter table profiles_toss enable row level security;
drop policy if exists profiles_toss_select on profiles_toss;
create policy profiles_toss_select on profiles_toss for select using (true);
drop policy if exists profiles_toss_update_own on profiles_toss;
create policy profiles_toss_update_own on profiles_toss
  for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists profiles_toss_insert_own on profiles_toss;
create policy profiles_toss_insert_own on profiles_toss
  for insert with check (auth.uid() = id);

-- ══ 2. 부동산 (공유 세계 마켓) ═══════════════════════════════
create table if not exists properties_toss (
  id              text primary key,
  kind            text not null,
  name            text not null default '',
  owner_id        uuid references profiles_toss(id) on delete set null,
  price           bigint not null default 0,
  income_per_hour bigint not null default 0,
  for_sale        boolean not null default false,
  list_price      bigint,
  meta            jsonb not null default '{}'::jsonb,
  center_lng      double precision,
  center_lat      double precision,
  purchased_at    timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists idx_properties_toss_owner on properties_toss(owner_id);
create index if not exists idx_properties_toss_forsale on properties_toss(for_sale) where for_sale = true;
create index if not exists idx_properties_toss_center on properties_toss(center_lng, center_lat);

create table if not exists property_log_toss (
  id          bigint generated always as identity primary key,
  property_id text not null,
  type        text not null,
  buyer_id    uuid,
  seller_id   uuid,
  price       bigint,
  created_at  timestamptz not null default now()
);

alter table properties_toss enable row level security;
alter table property_log_toss enable row level security;
drop policy if exists properties_toss_select on properties_toss;
create policy properties_toss_select on properties_toss for select using (true);
drop policy if exists property_log_toss_select on property_log_toss;
create policy property_log_toss_select on property_log_toss for select using (true);
-- 쓰기는 전부 SECURITY DEFINER RPC 경유

-- 'b:lng,lat[#fN]' id 또는 meta 좌표에서 center 채우기
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
  return NEW;
end $$;

drop trigger if exists properties_toss_center on properties_toss;
create trigger properties_toss_center before insert or update on properties_toss
  for each row execute function set_property_center();

-- Realtime (지도 실시간 반영 + 알림)
alter table properties_toss replica identity full;
do $$ begin alter publication supabase_realtime add table properties_toss; exception when others then null; end $$;

-- ══ 3. 마켓 RPC ══════════════════════════════════════════════
-- 은행 구매/매물 구매 (종류별 최소가로 헐값 구매 차단)
create or replace function buy_property_toss(
  p_id text, p_kind text, p_name text,
  p_price bigint, p_income bigint, p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row properties_toss%rowtype; v_bal bigint; v_cost bigint; v_found boolean;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;

  select * into v_row from properties_toss where id = p_id for update;
  v_found := found;
  if v_found and v_row.owner_id = v_uid then return jsonb_build_object('success', false, 'message', '이미 소유한 자산입니다'); end if;

  if v_found and v_row.owner_id is not null then
    if not v_row.for_sale then return jsonb_build_object('success', false, 'message', '판매 중이 아닙니다'); end if;
    v_cost := v_row.list_price; -- 서버가 정한 매물가 (신뢰)
  else
    v_cost := p_price;
    if v_cost is null or v_cost < 1000 then return jsonb_build_object('success', false, 'message', '가격 오류'); end if;
    if p_kind = 'landmark' and v_cost < 1000000000 then return jsonb_build_object('success', false, 'message', '가격 오류'); end if;
    if p_kind in ('building', 'house', 'floor') and v_cost < 10000 then return jsonb_build_object('success', false, 'message', '가격 오류'); end if;
  end if;

  select balance into v_bal from profiles_toss where id = v_uid for update;
  if v_bal < v_cost then return jsonb_build_object('success', false, 'message', '잔액이 부족합니다'); end if;

  update profiles_toss set balance = balance - v_cost where id = v_uid;
  if v_found and v_row.owner_id is not null then
    update profiles_toss set balance = balance + v_cost where id = v_row.owner_id;
    update properties_toss set owner_id = v_uid, for_sale = false, list_price = null, price = v_cost, purchased_at = now(), updated_at = now() where id = p_id;
    insert into property_log_toss(property_id, type, buyer_id, seller_id, price) values (p_id, 'player_sale', v_uid, v_row.owner_id, v_cost);
  elsif v_found then
    update properties_toss set owner_id = v_uid, price = v_cost, income_per_hour = coalesce(p_income, v_row.income_per_hour), for_sale = false, list_price = null, purchased_at = now(), updated_at = now() where id = p_id;
    insert into property_log_toss(property_id, type, buyer_id, price) values (p_id, 'purchase', v_uid, v_cost);
  else
    insert into properties_toss(id, kind, name, owner_id, price, income_per_hour, meta, purchased_at)
      values (p_id, p_kind, p_name, v_uid, v_cost, coalesce(p_income, 0), coalesce(p_meta, '{}'::jsonb), now());
    insert into property_log_toss(property_id, type, buyer_id, price) values (p_id, 'purchase', v_uid, v_cost);
  end if;

  select balance into v_bal from profiles_toss where id = v_uid;
  return jsonb_build_object('success', true, 'balance', v_bal, 'price', v_cost);
end $$;

create or replace function list_property_toss(p_id text, p_list_price bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  if p_list_price is null or p_list_price <= 0 then return jsonb_build_object('success', false, 'message', '가격이 올바르지 않습니다'); end if;
  update properties_toss set for_sale = true, list_price = p_list_price, updated_at = now()
    where id = p_id and owner_id = v_uid;
  if not found then return jsonb_build_object('success', false, 'message', '소유한 자산이 아닙니다'); end if;
  insert into property_log_toss(property_id, type, seller_id, price) values (p_id, 'list', v_uid, p_list_price);
  return jsonb_build_object('success', true);
end $$;

create or replace function unlist_property_toss(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  update properties_toss set for_sale = false, list_price = null, updated_at = now()
    where id = p_id and owner_id = v_uid;
  if not found then return jsonb_build_object('success', false, 'message', '소유한 자산이 아닙니다'); end if;
  insert into property_log_toss(property_id, type, seller_id) values (p_id, 'unlist', v_uid);
  return jsonb_build_object('success', true);
end $$;

create or replace function sell_to_bank_toss(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row properties_toss%rowtype; v_refund bigint; v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  select * into v_row from properties_toss where id = p_id for update;
  if not found or v_row.owner_id is distinct from v_uid then
    return jsonb_build_object('success', false, 'message', '소유한 자산이 아닙니다');
  end if;
  v_refund := round(v_row.price * 0.70);
  update profiles_toss set balance = balance + v_refund where id = v_uid returning balance into v_bal;
  update properties_toss set owner_id = null, for_sale = false, list_price = null,
         price = round(v_row.price * 0.85), purchased_at = null, updated_at = now() where id = p_id;
  insert into property_log_toss(property_id, type, seller_id, price) values (p_id, 'sell_bank', v_uid, v_refund);
  return jsonb_build_object('success', true, 'refund', v_refund, 'balance', v_bal);
end $$;

-- ══ 4. 보상/지출 RPC (서버 권위 — 클라 민팅 차단) ═════════════
create or replace function click_reward_toss(p_clicks int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
  v_reward constant bigint := 10000; v_limit constant int := 400;
  v_day date; v_used int; v_grant int; v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  if p_clicks is null or p_clicks < 1 then return jsonb_build_object('success', false); end if;
  p_clicks := least(p_clicks, v_limit);
  select clicks_today, clicks_day into v_used, v_day from profiles_toss where id = v_uid for update;
  if v_day is distinct from current_date then v_used := 0; end if;
  v_grant := least(p_clicks, greatest(0, v_limit - v_used));
  update profiles_toss set clicks_today = v_used + v_grant, clicks_day = current_date,
         balance = balance + v_grant::bigint * v_reward
   where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'granted', v_grant, 'balance', v_bal, 'left', v_limit - (v_used + v_grant));
end $$;

-- 토스 인앱 광고(보상형) 시청 완료 보상 — 일일 한도 서버 관리
create table if not exists toss_ad_claims (
  user_id uuid not null,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table toss_ad_claims enable row level security; -- RPC 전용

create or replace function watch_toss_ad()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
  v_reward constant bigint := 500000; v_limit constant int := 5;
  v_count int; v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  insert into toss_ad_claims(user_id, day, count) values (v_uid, current_date, 0)
    on conflict (user_id, day) do nothing;
  select count into v_count from toss_ad_claims
    where user_id = v_uid and day = current_date for update;
  if v_count >= v_limit then
    return jsonb_build_object('success', false, 'message', '오늘 광고 보상을 모두 받았어요. 내일 다시!');
  end if;
  update toss_ad_claims set count = count + 1 where user_id = v_uid and day = current_date;
  update profiles_toss set balance = balance + v_reward where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'reward', v_reward, 'balance', v_bal, 'left', v_limit - v_count - 1);
end $$;

create or replace function claim_goal_toss(p_goal text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_reward bigint; v_ok boolean := false; v_bal bigint;
  v_owned int; v_networth bigint; v_claimed text[];
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  select claimed_goals, balance into v_claimed, v_bal from profiles_toss where id = v_uid for update;
  if p_goal = any(v_claimed) then return jsonb_build_object('success', false, 'message', '이미 수령'); end if;
  select count(*), coalesce(sum(price), 0) into v_owned, v_networth from properties_toss where owner_id = v_uid;
  v_networth := v_networth + v_bal;
  case p_goal
    when 'first'    then v_ok := v_owned >= 1;  v_reward := 20000;
    when 'own3'     then v_ok := v_owned >= 3;  v_reward := 60000;
    when 'own10'    then v_ok := v_owned >= 10; v_reward := 300000;
    when 'nw1m'     then v_ok := v_networth >= 1000000;   v_reward := 100000;
    when 'nw10m'    then v_ok := v_networth >= 10000000;  v_reward := 800000;
    when 'nw100m'   then v_ok := v_networth >= 100000000; v_reward := 5000000;
    when 'district' then v_ok := exists(select 1 from properties_toss where owner_id = v_uid and kind = 'district'); v_reward := 100000;
    when 'province' then v_ok := exists(select 1 from properties_toss where owner_id = v_uid and kind = 'province'); v_reward := 500000;
    when 'country'  then v_ok := exists(select 1 from properties_toss where owner_id = v_uid and kind = 'country');  v_reward := 10000000;
    when 'travel'   then v_ok := true; v_reward := 30000;
    else return jsonb_build_object('success', false, 'message', '알 수 없는 목표');
  end case;
  if not v_ok then return jsonb_build_object('success', false, 'message', '아직 달성 전'); end if;
  update profiles_toss set claimed_goals = array_append(claimed_goals, p_goal), balance = balance + v_reward
   where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'reward', v_reward, 'balance', v_bal);
end $$;

create or replace function spend_toss(p_amount bigint, p_reason text default 'spend')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  if p_amount is null or p_amount <= 0 or p_amount > 5000000000 then return jsonb_build_object('success', false, 'message', '금액 오류'); end if;
  select balance into v_bal from profiles_toss where id = v_uid for update;
  if v_bal < p_amount then return jsonb_build_object('success', false, 'message', '잔액이 부족합니다'); end if;
  update profiles_toss set balance = balance - p_amount where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'balance', v_bal);
end $$;

-- 수입 정산 (공동소유 지분 반영, 최대 8시간 적립)
create or replace function collect_income_toss()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rate numeric; v_last timestamptz; v_secs numeric; v_earned bigint; v_bal bigint;
  v_cap constant int := 8 * 3600;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  select
    coalesce((select sum(p.income_per_hour) from properties_toss p where p.owner_id = v_uid and not exists (select 1 from property_shares_toss s where s.property_id = p.id)), 0)
    + coalesce((select sum(p.income_per_hour * ps.share_pct / 100.0) from property_shares_toss ps join properties_toss p on p.id = ps.property_id where ps.user_id = v_uid), 0)
    into v_rate;
  select income_collected_at into v_last from profiles_toss where id = v_uid for update;
  v_secs := least(extract(epoch from (now() - v_last)), v_cap);
  v_earned := floor(v_rate * v_secs / 3600.0);
  update profiles_toss set balance = balance + v_earned, income_collected_at = now() where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'earned', v_earned, 'balance', v_bal, 'rate_per_hour', floor(v_rate));
end $$;

-- 리더보드 (순자산 = 잔액 + 자산가치)
create or replace function get_leaderboard_toss(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select p.id, p.username,
        p.balance + coalesce((select sum(pr.price) from properties_toss pr where pr.owner_id = p.id), 0) as net_worth,
        (select count(*) from properties_toss pr where pr.owner_id = p.id) as count
      from profiles_toss p
      order by net_worth desc
      limit p_limit
    ) t
  );
end $$;

-- ══ 5. 알림 ══════════════════════════════════════════════════
create table if not exists notifications_toss (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  type       text not null,
  message    text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_toss_user on notifications_toss(user_id, read);

alter table notifications_toss enable row level security;
drop policy if exists notifications_toss_select_own on notifications_toss;
create policy notifications_toss_select_own on notifications_toss for select using (auth.uid() = user_id);
drop policy if exists notifications_toss_update_own on notifications_toss;
create policy notifications_toss_update_own on notifications_toss for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function notify_property_sold_toss()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.owner_id is not null and NEW.owner_id is not null and NEW.owner_id <> OLD.owner_id then
    insert into notifications_toss(user_id, type, message)
      values (OLD.owner_id, 'sold', coalesce(NEW.name, '내 자산') || ' 이(가) ₩' || to_char(NEW.price, 'FM999,999,999,999') || '에 팔렸어요! 💰');
  end if;
  return NEW;
end $$;

drop trigger if exists properties_toss_sold_notify on properties_toss;
create trigger properties_toss_sold_notify after update of owner_id on properties_toss
  for each row execute function notify_property_sold_toss();

do $$ begin alter publication supabase_realtime add table notifications_toss; exception when others then null; end $$;

create or replace function mark_notifications_read_toss()
returns void language plpgsql security definer set search_path = public as $$
begin
  update notifications_toss set read = true where user_id = auth.uid() and read = false;
end $$;

-- ══ 6. 친구 + 공동구매 ═══════════════════════════════════════
create table if not exists friendships_toss (
  id bigint generated always as identity primary key,
  requester uuid not null,
  addressee uuid not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (requester, addressee)
);
create index if not exists idx_friend_toss_addr on friendships_toss(addressee, status);
create index if not exists idx_friend_toss_req  on friendships_toss(requester, status);
alter table friendships_toss enable row level security;
drop policy if exists friendships_toss_sel on friendships_toss;
create policy friendships_toss_sel on friendships_toss for select using (auth.uid() in (requester, addressee));

create or replace function find_user_toss(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((select to_jsonb(t) from (select id, username from profiles_toss where lower(username) = lower(p_name) limit 1) t), 'null'::jsonb);
end $$;

create or replace function send_friend_request_toss(p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  if p_target = v_uid then return jsonb_build_object('success', false, 'message', '자기 자신은 안 돼요'); end if;
  if not exists (select 1 from profiles_toss where id = p_target) then return jsonb_build_object('success', false, 'message', '유저를 찾을 수 없어요'); end if;
  if exists (select 1 from friendships_toss where (requester = v_uid and addressee = p_target) or (requester = p_target and addressee = v_uid)) then
    return jsonb_build_object('success', false, 'message', '이미 친구이거나 요청 대기중');
  end if;
  insert into friendships_toss(requester, addressee) values (v_uid, p_target);
  insert into notifications_toss(user_id, type, message)
    values (p_target, 'friend', (select username from profiles_toss where id = v_uid) || '님이 친구 요청을 보냈어요 👋');
  return jsonb_build_object('success', true);
end $$;

create or replace function respond_friend_request_toss(p_requester uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('success', false); end if;
  if p_accept then
    update friendships_toss set status = 'accepted' where requester = p_requester and addressee = v_uid and status = 'pending';
    insert into notifications_toss(user_id, type, message)
      values (p_requester, 'friend', (select username from profiles_toss where id = v_uid) || '님과 친구가 되었어요 🤝');
  else
    delete from friendships_toss where requester = p_requester and addressee = v_uid and status = 'pending';
  end if;
  return jsonb_build_object('success', true);
end $$;

create or replace function list_friends_toss()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  return (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select p.id, p.username, 'friend' as kind
      from friendships_toss f join profiles_toss p on p.id = case when f.requester = v_uid then f.addressee else f.requester end
      where f.status = 'accepted' and v_uid in (f.requester, f.addressee)
    union all
    select p.id, p.username, 'incoming' as kind
      from friendships_toss f join profiles_toss p on p.id = f.requester
      where f.status = 'pending' and f.addressee = v_uid
    union all
    select p.id, p.username, 'outgoing' as kind
      from friendships_toss f join profiles_toss p on p.id = f.addressee
      where f.status = 'pending' and f.requester = v_uid
  ) t);
end $$;

create table if not exists co_purchases_toss (
  id bigint generated always as identity primary key,
  property_id text not null, prop_kind text not null, prop_name text not null,
  price bigint not null, income bigint not null default 0, meta jsonb not null default '{}'::jsonb,
  initiator uuid not null, status text not null default 'open',
  created_at timestamptz not null default now()
);
create table if not exists co_purchase_shares_toss (
  co_id bigint not null references co_purchases_toss(id) on delete cascade,
  user_id uuid not null, amount bigint not null, paid boolean not null default false,
  primary key (co_id, user_id)
);
create table if not exists property_shares_toss (
  property_id text not null, user_id uuid not null, share_pct numeric not null,
  primary key (property_id, user_id)
);
create index if not exists idx_pshares_toss_user on property_shares_toss(user_id);
alter table co_purchases_toss enable row level security;
alter table co_purchase_shares_toss enable row level security;
alter table property_shares_toss enable row level security;
drop policy if exists co_toss_sel on co_purchases_toss;
create policy co_toss_sel on co_purchases_toss for select using (true);
drop policy if exists cos_toss_sel on co_purchase_shares_toss;
create policy cos_toss_sel on co_purchase_shares_toss for select using (true);
drop policy if exists ps_toss_sel on property_shares_toss;
create policy ps_toss_sel on property_shares_toss for select using (true);
do $$ begin alter publication supabase_realtime add table co_purchases_toss; exception when others then null; end $$;

create or replace function propose_co_purchase_toss(
  p_id text, p_kind text, p_name text, p_price bigint, p_income bigint, p_meta jsonb, p_participants jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_co bigint; v_sum bigint := 0; v_init bigint := 0; v_bal bigint; r jsonb; v_pid uuid; v_amt bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  if exists (select 1 from properties_toss where id = p_id and owner_id is not null) then return jsonb_build_object('success', false, 'message', '이미 소유된 자산이에요'); end if;
  for r in select * from jsonb_array_elements(p_participants) loop
    v_pid := (r->>'user_id')::uuid; v_amt := (r->>'amount')::bigint;
    if v_amt <= 0 then return jsonb_build_object('success', false, 'message', '금액 오류'); end if;
    v_sum := v_sum + v_amt;
    if v_pid = v_uid then v_init := v_amt;
    elsif not exists (select 1 from friendships_toss where status = 'accepted' and ((requester = v_uid and addressee = v_pid) or (requester = v_pid and addressee = v_uid))) then
      return jsonb_build_object('success', false, 'message', '친구만 참여할 수 있어요');
    end if;
  end loop;
  if v_sum <> p_price then return jsonb_build_object('success', false, 'message', '지분 합계가 가격과 달라요'); end if;
  if v_init <= 0 then return jsonb_build_object('success', false, 'message', '본인 지분이 필요해요'); end if;
  select balance into v_bal from profiles_toss where id = v_uid for update;
  if v_bal < v_init then return jsonb_build_object('success', false, 'message', '내 지분만큼의 잔액이 부족해요'); end if;

  update profiles_toss set balance = balance - v_init where id = v_uid;
  insert into co_purchases_toss(property_id, prop_kind, prop_name, price, income, meta, initiator)
    values (p_id, p_kind, p_name, p_price, coalesce(p_income, 0), coalesce(p_meta, '{}'::jsonb), v_uid) returning id into v_co;
  for r in select * from jsonb_array_elements(p_participants) loop
    v_pid := (r->>'user_id')::uuid; v_amt := (r->>'amount')::bigint;
    insert into co_purchase_shares_toss(co_id, user_id, amount, paid) values (v_co, v_pid, v_amt, v_pid = v_uid);
    if v_pid <> v_uid then
      insert into notifications_toss(user_id, type, message)
        values (v_pid, 'co_purchase', (select username from profiles_toss where id = v_uid) || '님의 공동구매 제안: ' || p_name || ' (내 지분 ₩' || to_char(v_amt, 'FM999,999,999,999') || ') 👥');
    end if;
  end loop;
  return jsonb_build_object('success', true, 'co_id', v_co);
end $$;

create or replace function accept_co_purchase_toss(p_co bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_amt bigint; v_bal bigint; v_co co_purchases_toss%rowtype; v_unpaid int; v_total bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  select * into v_co from co_purchases_toss where id = p_co for update;
  if not found or v_co.status <> 'open' then return jsonb_build_object('success', false, 'message', '유효하지 않은 제안'); end if;
  select amount into v_amt from co_purchase_shares_toss where co_id = p_co and user_id = v_uid and not paid;
  if v_amt is null then return jsonb_build_object('success', false, 'message', '참여 대상이 아니거나 이미 결제됨'); end if;
  select balance into v_bal from profiles_toss where id = v_uid for update;
  if v_bal < v_amt then return jsonb_build_object('success', false, 'message', '잔액이 부족해요'); end if;
  update profiles_toss set balance = balance - v_amt where id = v_uid returning balance into v_bal;
  update co_purchase_shares_toss set paid = true where co_id = p_co and user_id = v_uid;

  select count(*) into v_unpaid from co_purchase_shares_toss where co_id = p_co and not paid;
  if v_unpaid > 0 then return jsonb_build_object('success', true, 'done', false, 'balance', v_bal); end if;

  if exists (select 1 from properties_toss where id = v_co.property_id and owner_id is not null) then
    update profiles_toss p set balance = balance + s.amount from co_purchase_shares_toss s where s.co_id = p_co and s.paid and p.id = s.user_id;
    update co_purchases_toss set status = 'cancelled' where id = p_co;
    insert into notifications_toss(user_id, type, message) select user_id, 'co_purchase', v_co.prop_name || ' 공동구매 무산 — 환불되었어요' from co_purchase_shares_toss where co_id = p_co;
    return jsonb_build_object('success', false, 'message', '이미 판매된 자산 — 환불되었어요', 'balance', v_bal);
  end if;

  select sum(amount) into v_total from co_purchase_shares_toss where co_id = p_co;
  insert into properties_toss(id, kind, name, owner_id, price, income_per_hour, meta, purchased_at)
    values (v_co.property_id, v_co.prop_kind, v_co.prop_name, v_co.initiator, v_co.price, v_co.income, v_co.meta, now())
    on conflict (id) do update set owner_id = excluded.owner_id, price = excluded.price, income_per_hour = excluded.income_per_hour, for_sale = false, list_price = null, purchased_at = now(), updated_at = now();
  insert into property_shares_toss(property_id, user_id, share_pct)
    select v_co.property_id, user_id, round(amount * 100.0 / v_total, 2) from co_purchase_shares_toss where co_id = p_co
    on conflict (property_id, user_id) do update set share_pct = excluded.share_pct;
  insert into property_log_toss(property_id, type, buyer_id, price) values (v_co.property_id, 'co_purchase', v_co.initiator, v_co.price);
  update co_purchases_toss set status = 'done' where id = p_co;
  insert into notifications_toss(user_id, type, message) select user_id, 'co_purchase', '공동구매 완료: ' || v_co.prop_name || ' 🎉' from co_purchase_shares_toss where co_id = p_co;
  return jsonb_build_object('success', true, 'done', true, 'balance', v_bal);
end $$;

create or replace function decline_co_purchase_toss(p_co bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_co co_purchases_toss%rowtype;
begin
  if v_uid is null then return jsonb_build_object('success', false); end if;
  select * into v_co from co_purchases_toss where id = p_co for update;
  if not found or v_co.status <> 'open' then return jsonb_build_object('success', false, 'message', '유효하지 않은 제안'); end if;
  if v_co.initiator <> v_uid and not exists (select 1 from co_purchase_shares_toss where co_id = p_co and user_id = v_uid) then
    return jsonb_build_object('success', false, 'message', '권한 없음');
  end if;
  update profiles_toss p set balance = balance + s.amount from co_purchase_shares_toss s where s.co_id = p_co and s.paid and p.id = s.user_id;
  update co_purchases_toss set status = 'cancelled' where id = p_co;
  insert into notifications_toss(user_id, type, message)
    select user_id, 'co_purchase', v_co.prop_name || ' 공동구매가 취소됐어요 (환불됨)' from co_purchase_shares_toss where co_id = p_co and user_id <> v_uid;
  return jsonb_build_object('success', true);
end $$;

create or replace function list_co_purchases_toss()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  return (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select c.id, c.prop_name, c.price, c.initiator = v_uid as mine, pi.username as initiator_name,
      s.amount as my_amount, s.paid as my_paid,
      (select count(*) from co_purchase_shares_toss x where x.co_id = c.id and x.paid) as paid_count,
      (select count(*) from co_purchase_shares_toss x where x.co_id = c.id) as total_count
    from co_purchases_toss c
    join co_purchase_shares_toss s on s.co_id = c.id and s.user_id = v_uid
    join profiles_toss pi on pi.id = c.initiator
    where c.status = 'open'
    order by c.created_at desc
  ) t);
end $$;
