-- ─────────────────────────────────────────────────────────────
-- someday — notifications. Run in SQL Editor (after the others).
-- "내 매물이 팔렸어요" is written server-side by a trigger, delivered live via
-- Realtime and kept for offline players in a notifications table.
-- ─────────────────────────────────────────────────────────────

create table if not exists notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  type       text not null,          -- sold | info
  message    text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on notifications(user_id, read);

alter table notifications enable row level security;
drop policy if exists notifications_select_own on notifications;
create policy notifications_select_own on notifications for select using (auth.uid() = user_id);
drop policy if exists notifications_update_own on notifications;
create policy notifications_update_own on notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- inserts happen via the SECURITY DEFINER trigger below (no direct client insert)

-- Notify the previous owner when their property is bought by another player.
create or replace function notify_property_sold()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.owner_id is not null and NEW.owner_id is not null and NEW.owner_id <> OLD.owner_id then
    insert into notifications(user_id, type, message)
      values (OLD.owner_id, 'sold', coalesce(NEW.name, '내 자산') || ' 이(가) ₩' || to_char(NEW.price, 'FM999,999,999,999') || '에 팔렸어요! 💰');
  end if;
  return NEW;
end $$;

drop trigger if exists properties_sold_notify on properties;
create trigger properties_sold_notify after update of owner_id on properties
  for each row execute function notify_property_sold();

-- Realtime: deliver notifications live + expose OLD values for nearby-trade detection.
alter table properties replica identity full;
do $$ begin alter publication supabase_realtime add table notifications; exception when others then null; end $$;

-- Mark all my notifications read.
create or replace function mark_notifications_read()
returns void language plpgsql security definer set search_path = public as $$
begin
  update notifications set read = true where user_id = auth.uid() and read = false;
end $$;
