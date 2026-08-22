-- ─────────────────────────────────────────────────────────────
-- someday — 앱인토스 전환용 서버 설정. SQL Editor에서 실행.
--
-- 1) watch_toss_ad(): 토스 인앱 광고(보상형) 시청 완료 보상.
--    클라이언트가 userEarnedReward 이벤트 후 호출한다. 보상액/일일 한도는
--    서버 상수(v_reward/v_limit)가 기준이며 src/config.js의 AD 설정과 맞출 것.
-- 2) 기존 링크형 광고 시스템(watch_ad + ads 테이블)은 앱인토스 광고 정책상
--    제거 — 광고는 토스 SDK를 통해서만 노출해야 한다.
-- ─────────────────────────────────────────────────────────────

-- ── 토스 보상형 광고: 일일 시청 횟수 서버 추적 ──
create table if not exists toss_ad_claims (
  user_id uuid not null,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table toss_ad_claims enable row level security; -- RPC 전용 (정책 없음)

create or replace function watch_toss_ad()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reward constant bigint := 500000; -- 1회 시청 보상 (₩)
  v_limit  constant int := 5;         -- 하루 최대 시청 횟수
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
  update profiles set balance = balance + v_reward where id = v_uid returning balance into v_bal;
  return jsonb_build_object('success', true, 'reward', v_reward, 'balance', v_bal, 'left', v_limit - v_count - 1);
end $$;

-- ── 기존 링크형 광고 시스템 제거 (토스 광고 정책 위반 소지) ──
drop function if exists watch_ad(uuid);
drop table if exists ad_claims;
drop table if exists ads;
