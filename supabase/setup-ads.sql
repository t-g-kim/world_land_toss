-- ─────────────────────────────────────────────────────────────
-- someday — rewarded ads (the "돈벌기" menu). Run once in SQL Editor.
-- Ads are registered by the admin via /admin.html and shown in-game; each ad
-- can be watched once per day for a reward.
-- ⚠️ Change the admin email below to your own account before running.
-- ─────────────────────────────────────────────────────────────

create table if not exists ads (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text default '',
  image_url   text default '',
  link_url    text not null,
  reward      integer not null default 100,
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table ads enable row level security;

-- Anyone (incl. logged-out) can read active ads.
drop policy if exists ads_select_active on ads;
create policy ads_select_active on ads
  for select using (active = true);

-- Only the admin account can create/update/delete ads.
drop policy if exists ads_admin_all on ads;
create policy ads_admin_all on ads
  for all
  using ((auth.jwt() ->> 'email') = 'je23ct@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'je23ct@gmail.com');
