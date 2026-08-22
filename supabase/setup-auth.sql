-- ─────────────────────────────────────────────────────────────
-- someday — minimal setup for Google login + cloud-saved state.
-- Paste this whole file into the Supabase dashboard → SQL Editor → Run.
-- Idempotent: safe to run more than once.
-- (The client only needs the `profiles` table; territories/RPC from the
--  numbered migrations are NOT required for login to work.)
-- ─────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";

-- Player profile, one row per auth user. game_state holds the whole save blob.
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text not null,
  balance         bigint not null default 10000000,
  territory_count integer not null default 0,
  total_income    bigint not null default 0,
  total_spent     bigint not null default 0,
  game_state      jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- If profiles already existed from an older migration, make sure game_state is there.
alter table profiles add column if not exists game_state jsonb not null default '{}'::jsonb;

-- Auto-create a profile when a user signs up (derives a unique username from
-- Google metadata / email prefix).
-- NOTE: security-definer triggers on auth.users MUST set search_path and
-- schema-qualify tables, or Postgres can't find `profiles` → signup fails with
-- "Database error saving new user".
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_username text;
  v_suffix int := 0;
begin
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
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Keep updated_at fresh.
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();

-- Row level security: anyone can read (leaderboard), users edit only their own row.
alter table profiles enable row level security;

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles
  for select using (true);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert with check (auth.uid() = id);
