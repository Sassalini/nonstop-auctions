-- Authoritative status transitions generate private account notifications.
-- No backfill and no writes to lots, bids, results, timings or queues.
begin;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lot_id uuid not null references public.lots(id) on delete cascade,
  kind text not null check (kind in (
    'WATCHED_LIVE', 'WATCHED_SOLD', 'WATCHED_UNSOLD', 'WON', 'SELLER_LIVE', 'SELLER_SOLD'
  )),
  lot_title text not null,
  auction_run timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique (user_id, lot_id, kind, auction_run)
);
create index notifications_user_created_idx on public.notifications(user_id, created_at desc, id desc);
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index notifications_lot_id_idx on public.notifications(lot_id);

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "Users can read their own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can mark their own notifications read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function public.notify_lot_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  run_at timestamptz := coalesce(new.preview_starts_at, new.bidding_starts_at, new.created_at);
  watcher_kind text;
begin
  if old.status = new.status then return new; end if;
  -- "Live" means bidding has opened, not the non-bidding preview or first bid.
  if new.status in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
    and old.status not in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING') then
    watcher_kind := 'WATCHED_LIVE';
    insert into public.notifications(user_id, lot_id, kind, lot_title, auction_run)
      values (new.seller_id, new.id, 'SELLER_LIVE', new.title, run_at)
      on conflict (user_id, lot_id, kind, auction_run) do nothing;
  elsif new.status = 'SOLD' then
    watcher_kind := 'WATCHED_SOLD';
    insert into public.notifications(user_id, lot_id, kind, lot_title, auction_run)
      values (new.seller_id, new.id, 'SELLER_SOLD', new.title, run_at)
      on conflict (user_id, lot_id, kind, auction_run) do nothing;
    if new.highest_bidder_id is not null then
      insert into public.notifications(user_id, lot_id, kind, lot_title, auction_run)
        values (new.highest_bidder_id, new.id, 'WON', new.title, run_at)
        on conflict (user_id, lot_id, kind, auction_run) do nothing;
    end if;
  elsif new.status = 'UNSOLD' then
    watcher_kind := 'WATCHED_UNSOLD';
  end if;
  if watcher_kind is not null then
    insert into public.notifications(user_id, lot_id, kind, lot_title, auction_run)
      select w.user_id, new.id, watcher_kind, new.title, run_at
      from public.watchlist w where w.lot_id = new.id
      on conflict (user_id, lot_id, kind, auction_run) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_lot_transition() from public, anon, authenticated;
create trigger notify_lot_transition after update of status on public.lots
  for each row when (old.status is distinct from new.status)
  execute function public.notify_lot_transition();

-- Postgres Changes delivers only rows the subscriber can SELECT under RLS.
do $$
declare table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['notifications', 'auction_rooms'] loop
      if not exists (select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
commit;
