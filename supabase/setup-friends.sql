-- ─────────────────────────────────────────────────────────────
-- someday — friends + co-purchase (shared ownership). Run in SQL Editor
-- (after setup-notifications.sql). Requires: profiles, properties, notifications.
-- ─────────────────────────────────────────────────────────────

-- ══ Friends ══════════════════════════════════════════════════
create table if not exists friendships (
  id bigint generated always as identity primary key,
  requester uuid not null,
  addressee uuid not null,
  status text not null default 'pending',  -- pending | accepted
  created_at timestamptz not null default now(),
  unique (requester, addressee)
);
create index if not exists idx_friend_addr on friendships(addressee, status);
create index if not exists idx_friend_req  on friendships(requester, status);
alter table friendships enable row level security;
drop policy if exists friendships_sel on friendships;
create policy friendships_sel on friendships for select using (auth.uid() in (requester, addressee));

create or replace function find_user(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((select to_jsonb(t) from (select id, username from profiles where lower(username) = lower(p_name) limit 1) t), 'null'::jsonb);
end $$;

create or replace function send_friend_request(p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  if p_target = v_uid then return jsonb_build_object('success', false, 'message', '자기 자신은 안 돼요'); end if;
  if not exists (select 1 from profiles where id = p_target) then return jsonb_build_object('success', false, 'message', '유저를 찾을 수 없어요'); end if;
  if exists (select 1 from friendships where (requester = v_uid and addressee = p_target) or (requester = p_target and addressee = v_uid)) then
    return jsonb_build_object('success', false, 'message', '이미 친구이거나 요청 대기중');
  end if;
  insert into friendships(requester, addressee) values (v_uid, p_target);
  insert into notifications(user_id, type, message)
    values (p_target, 'friend', (select username from profiles where id = v_uid) || '님이 친구 요청을 보냈어요 👋');
  return jsonb_build_object('success', true);
end $$;

create or replace function respond_friend_request(p_requester uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('success', false); end if;
  if p_accept then
    update friendships set status = 'accepted' where requester = p_requester and addressee = v_uid and status = 'pending';
    insert into notifications(user_id, type, message)
      values (p_requester, 'friend', (select username from profiles where id = v_uid) || '님과 친구가 되었어요 🤝');
  else
    delete from friendships where requester = p_requester and addressee = v_uid and status = 'pending';
  end if;
  return jsonb_build_object('success', true);
end $$;

create or replace function list_friends()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  return (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select p.id, p.username, 'friend' as kind
      from friendships f join profiles p on p.id = case when f.requester = v_uid then f.addressee else f.requester end
      where f.status = 'accepted' and v_uid in (f.requester, f.addressee)
    union all
    select p.id, p.username, 'incoming' as kind
      from friendships f join profiles p on p.id = f.requester
      where f.status = 'pending' and f.addressee = v_uid
    union all
    select p.id, p.username, 'outgoing' as kind
      from friendships f join profiles p on p.id = f.addressee
      where f.status = 'pending' and f.requester = v_uid
  ) t);
end $$;

-- ══ Co-purchase (shared ownership) ═══════════════════════════
create table if not exists co_purchases (
  id bigint generated always as identity primary key,
  property_id text not null, prop_kind text not null, prop_name text not null,
  price bigint not null, income bigint not null default 0, meta jsonb not null default '{}'::jsonb,
  initiator uuid not null, status text not null default 'open',  -- open | done | cancelled
  created_at timestamptz not null default now()
);
create table if not exists co_purchase_shares (
  co_id bigint not null references co_purchases(id) on delete cascade,
  user_id uuid not null, amount bigint not null, paid boolean not null default false,
  primary key (co_id, user_id)
);
create table if not exists property_shares (
  property_id text not null, user_id uuid not null, share_pct numeric not null,
  primary key (property_id, user_id)
);
create index if not exists idx_pshares_user on property_shares(user_id);
alter table co_purchases enable row level security;
alter table co_purchase_shares enable row level security;
alter table property_shares enable row level security;
drop policy if exists co_sel on co_purchases;
create policy co_sel on co_purchases for select using (true);
drop policy if exists cos_sel on co_purchase_shares;
create policy cos_sel on co_purchase_shares for select using (true);
drop policy if exists ps_sel on property_shares;
create policy ps_sel on property_shares for select using (true);
do $$ begin alter publication supabase_realtime add table co_purchases; exception when others then null; end $$;

-- Propose: initiator pays their share immediately (escrow); friends invited.
create or replace function propose_co_purchase(
  p_id text, p_kind text, p_name text, p_price bigint, p_income bigint, p_meta jsonb, p_participants jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_co bigint; v_sum bigint := 0; v_init bigint := 0; v_bal bigint; r jsonb; v_pid uuid; v_amt bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  if exists (select 1 from properties where id = p_id and owner_id is not null) then return jsonb_build_object('success', false, 'message', '이미 소유된 자산이에요'); end if;
  for r in select * from jsonb_array_elements(p_participants) loop
    v_pid := (r->>'user_id')::uuid; v_amt := (r->>'amount')::bigint;
    if v_amt <= 0 then return jsonb_build_object('success', false, 'message', '금액 오류'); end if;
    v_sum := v_sum + v_amt;
    if v_pid = v_uid then v_init := v_amt;
    elsif not exists (select 1 from friendships where status = 'accepted' and ((requester = v_uid and addressee = v_pid) or (requester = v_pid and addressee = v_uid))) then
      return jsonb_build_object('success', false, 'message', '친구만 참여할 수 있어요');
    end if;
  end loop;
  if v_sum <> p_price then return jsonb_build_object('success', false, 'message', '지분 합계가 가격과 달라요'); end if;
  if v_init <= 0 then return jsonb_build_object('success', false, 'message', '본인 지분이 필요해요'); end if;
  select balance into v_bal from profiles where id = v_uid for update;
  if v_bal < v_init then return jsonb_build_object('success', false, 'message', '내 지분만큼의 잔액이 부족해요'); end if;

  update profiles set balance = balance - v_init where id = v_uid;
  insert into co_purchases(property_id, prop_kind, prop_name, price, income, meta, initiator)
    values (p_id, p_kind, p_name, p_price, coalesce(p_income, 0), coalesce(p_meta, '{}'::jsonb), v_uid) returning id into v_co;
  for r in select * from jsonb_array_elements(p_participants) loop
    v_pid := (r->>'user_id')::uuid; v_amt := (r->>'amount')::bigint;
    insert into co_purchase_shares(co_id, user_id, amount, paid) values (v_co, v_pid, v_amt, v_pid = v_uid);
    if v_pid <> v_uid then
      insert into notifications(user_id, type, message)
        values (v_pid, 'co_purchase', (select username from profiles where id = v_uid) || '님의 공동구매 제안: ' || p_name || ' (내 지분 ₩' || to_char(v_amt, 'FM999,999,999,999') || ') 👥');
    end if;
  end loop;
  return jsonb_build_object('success', true, 'co_id', v_co);
end $$;

-- Accept: pay my share; when everyone has paid, execute the purchase + shares.
create or replace function accept_co_purchase(p_co bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_amt bigint; v_bal bigint; v_co co_purchases%rowtype; v_unpaid int; v_total bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인 필요'); end if;
  select * into v_co from co_purchases where id = p_co for update;
  if not found or v_co.status <> 'open' then return jsonb_build_object('success', false, 'message', '유효하지 않은 제안'); end if;
  select amount into v_amt from co_purchase_shares where co_id = p_co and user_id = v_uid and not paid;
  if v_amt is null then return jsonb_build_object('success', false, 'message', '참여 대상이 아니거나 이미 결제됨'); end if;
  select balance into v_bal from profiles where id = v_uid for update;
  if v_bal < v_amt then return jsonb_build_object('success', false, 'message', '잔액이 부족해요'); end if;
  update profiles set balance = balance - v_amt where id = v_uid returning balance into v_bal;
  update co_purchase_shares set paid = true where co_id = p_co and user_id = v_uid;

  select count(*) into v_unpaid from co_purchase_shares where co_id = p_co and not paid;
  if v_unpaid > 0 then return jsonb_build_object('success', true, 'done', false, 'balance', v_bal); end if;

  -- All paid. If someone already bought it, refund everyone and cancel.
  if exists (select 1 from properties where id = v_co.property_id and owner_id is not null) then
    update profiles p set balance = balance + s.amount from co_purchase_shares s where s.co_id = p_co and s.paid and p.id = s.user_id;
    update co_purchases set status = 'cancelled' where id = p_co;
    insert into notifications(user_id, type, message) select user_id, 'co_purchase', v_co.prop_name || ' 공동구매 무산 — 환불되었어요' from co_purchase_shares where co_id = p_co;
    return jsonb_build_object('success', false, 'message', '이미 판매된 자산 — 환불되었어요', 'balance', v_bal);
  end if;

  select sum(amount) into v_total from co_purchase_shares where co_id = p_co;
  insert into properties(id, kind, name, owner_id, price, income_per_hour, meta, purchased_at)
    values (v_co.property_id, v_co.prop_kind, v_co.prop_name, v_co.initiator, v_co.price, v_co.income, v_co.meta, now())
    on conflict (id) do update set owner_id = excluded.owner_id, price = excluded.price, income_per_hour = excluded.income_per_hour, for_sale = false, list_price = null, purchased_at = now(), updated_at = now();
  insert into property_shares(property_id, user_id, share_pct)
    select v_co.property_id, user_id, round(amount * 100.0 / v_total, 2) from co_purchase_shares where co_id = p_co
    on conflict (property_id, user_id) do update set share_pct = excluded.share_pct;
  insert into property_log(property_id, type, buyer_id, price) values (v_co.property_id, 'co_purchase', v_co.initiator, v_co.price);
  update co_purchases set status = 'done' where id = p_co;
  insert into notifications(user_id, type, message) select user_id, 'co_purchase', '공동구매 완료: ' || v_co.prop_name || ' 🎉' from co_purchase_shares where co_id = p_co;
  return jsonb_build_object('success', true, 'done', true, 'balance', v_bal);
end $$;

-- Decline / cancel: refund everyone who paid, cancel the proposal.
create or replace function decline_co_purchase(p_co bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_co co_purchases%rowtype;
begin
  if v_uid is null then return jsonb_build_object('success', false); end if;
  select * into v_co from co_purchases where id = p_co for update;
  if not found or v_co.status <> 'open' then return jsonb_build_object('success', false, 'message', '유효하지 않은 제안'); end if;
  if v_co.initiator <> v_uid and not exists (select 1 from co_purchase_shares where co_id = p_co and user_id = v_uid) then
    return jsonb_build_object('success', false, 'message', '권한 없음');
  end if;
  update profiles p set balance = balance + s.amount from co_purchase_shares s where s.co_id = p_co and s.paid and p.id = s.user_id;
  update co_purchases set status = 'cancelled' where id = p_co;
  insert into notifications(user_id, type, message)
    select user_id, 'co_purchase', v_co.prop_name || ' 공동구매가 취소됐어요 (환불됨)' from co_purchase_shares where co_id = p_co and user_id <> v_uid;
  return jsonb_build_object('success', true);
end $$;

-- My open proposals (invited or initiated), with payment progress.
create or replace function list_co_purchases()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  return (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select c.id, c.prop_name, c.price, c.initiator = v_uid as mine, pi.username as initiator_name,
      s.amount as my_amount, s.paid as my_paid,
      (select count(*) from co_purchase_shares x where x.co_id = c.id and x.paid) as paid_count,
      (select count(*) from co_purchase_shares x where x.co_id = c.id) as total_count
    from co_purchases c
    join co_purchase_shares s on s.co_id = c.id and s.user_id = v_uid
    join profiles pi on pi.id = c.initiator
    where c.status = 'open'
    order by c.created_at desc
  ) t);
end $$;

-- ══ Income now splits by share ═══════════════════════════════
create or replace function collect_income()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rate numeric; v_last timestamptz; v_secs numeric; v_earned bigint; v_bal bigint;
  v_cap constant int := 8 * 3600;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'message', '로그인이 필요합니다'); end if;
  -- solo-owned (no shares) full + shared × my pct
  select
    coalesce((select sum(p.income_per_hour) from properties p where p.owner_id = v_uid and not exists (select 1 from property_shares s where s.property_id = p.id)), 0)
    + coalesce((select sum(p.income_per_hour * ps.share_pct / 100.0) from property_shares ps join properties p on p.id = ps.property_id where ps.user_id = v_uid), 0)
    into v_rate;
  select income_collected_at into v_last from profiles where id = v_uid for update;
  v_secs := least(extract(epoch from (now() - v_last)), v_cap);
  v_earned := floor(v_rate * v_secs / 3600.0);
  update profiles set balance = balance + v_earned, income_collected_at = now() where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'earned', v_earned, 'balance', v_bal, 'rate_per_hour', floor(v_rate));
end $$;
