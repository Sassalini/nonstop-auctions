-- Additive seller submission support. Apply after 008; no existing lots/results are changed.
begin;

alter table public.lots add column submission_key uuid;
create unique index lots_seller_submission_key_idx on public.lots (seller_id, submission_key)
  where submission_key is not null;
alter table public.lots add constraint seller_submission_money_check
  check (submission_key is null or starting_bid between 0.01 and 999999999999.99);
alter table public.lot_images add column storage_path text unique;
-- New drafts are created only through the validated, idempotent RPC.
revoke insert (room_id, seller_id, title, description, condition_report, shipping_info,
  estimate_low, estimate_high, starting_bid, minimum_increment) on public.lots from authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lot-photos', 'lot-photos', false, 5242880, array['image/jpeg','image/png','image/webp']);

create function public.save_seller_draft(p_submission_key uuid, p_room_id uuid,
  p_title text, p_description text, p_starting_bid numeric)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare result public.lots%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in before submitting a listing.'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'Confirm your email before submitting a listing.';
  end if;
  if p_submission_key is null then raise exception 'Submission reference is required.'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 160
    or p_description is null or length(btrim(p_description)) not between 1 and 10000 then
    raise exception 'Enter a title (up to 160 characters) and description (up to 10000 characters).';
  end if;
  if p_starting_bid is null or not (p_starting_bid between 0.01 and 999999999999.99)
    or p_starting_bid <> round(p_starting_bid, 2) then
    raise exception 'Starting bid must be positive GBP with at most two decimal places.';
  end if;
  if not exists (select 1 from public.auction_rooms where id = p_room_id and is_active) then
    raise exception 'Choose an active auction room.';
  end if;
  -- Same key always identifies the same seller's lot, including a lost success response.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_submission_key::text, 0));
  select * into result from public.lots where seller_id = auth.uid() and submission_key = p_submission_key for update;
  if found then
    if result.status = 'DRAFT' then
      update public.lots set room_id = p_room_id, title = btrim(p_title), description = btrim(p_description),
        starting_bid = p_starting_bid where id = result.id returning * into result;
    end if;
    return result;
  end if;
  -- Defaults retain the existing £50 increment, 30/30/5-second timings and seven-day requeue.
  insert into public.lots (seller_id, submission_key, room_id, title, description, starting_bid)
    values (auth.uid(), p_submission_key, p_room_id, btrim(p_title), btrim(p_description), p_starting_bid)
    returning * into result;
  return result;
end;
$$;

create function public.prepare_seller_photo(p_lot_id uuid, p_image_id uuid, p_extension text)
returns public.lot_images language plpgsql security definer set search_path = '' as $$
declare result public.lot_images%rowtype; object_path text;
begin
  perform 1 from public.lots where id = p_lot_id and seller_id = auth.uid() and status = 'DRAFT'
    and submission_key is not null for update;
  if not found then raise exception 'Only your own unfinished submission can accept photos.'; end if;
  if p_image_id is null or p_extension is null or p_extension not in ('jpg','png','webp') then
    raise exception 'Choose a JPEG, PNG or WebP image.';
  end if;
  object_path := auth.uid()::text || '/' || p_lot_id::text || '/' || p_image_id::text || '.' || p_extension;
  select * into result from public.lot_images where id = p_image_id and lot_id = p_lot_id and storage_path = object_path;
  if found then return result; end if;
  if (select count(*) from public.lot_images where lot_id = p_lot_id) >= 10 then
    raise exception 'A listing can have up to 10 photos.';
  end if;
  -- Register before upload: even an interrupted upload has a persistent owner/lot reference.
  insert into public.lot_images (id, lot_id, image_url, storage_path, sort_order)
    values (p_image_id, p_lot_id, 'storage:lot-photos/' || object_path, object_path,
      (select coalesce(max(sort_order), -1) + 1 from public.lot_images where lot_id = p_lot_id)) returning * into result;
  return result;
end;
$$;

-- Storage permission checks do not expose drafts or seller identifiers to other users.
create function public.can_upload_lot_photo(p_path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Serialize Storage writes with submission while the Storage DB transaction runs.
  perform 1 from public.lots l join public.lot_images i on i.lot_id = l.id
    where i.storage_path = p_path and l.seller_id = auth.uid() and l.status = 'DRAFT'
      and l.submission_key is not null for update of l;
  return found;
end;
$$;
create policy "Seller uploads registered draft photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'lot-photos' and public.can_upload_lot_photo(name));
create policy "Seller removes own draft photos" on storage.objects for delete to authenticated
  using (bucket_id = 'lot-photos' and public.can_upload_lot_photo(name));
-- No UPDATE policy: finalized images cannot be replaced or overwritten.
create policy "Read visible lot photos" on storage.objects for select to anon, authenticated
  using (bucket_id = 'lot-photos' and exists (select 1 from public.lot_images i
    join public.lots l on l.id = i.lot_id where i.storage_path = name
    and (l.seller_id = (select auth.uid()) or (l.status <> 'DRAFT'
      and exists (select 1 from public.auction_rooms r where r.id = l.room_id and r.is_active)))));
-- Restrictive counterparts also protect this bucket if a project has older broad policies.
create policy "Constrain lot photo inserts" on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'lot-photos' or public.can_upload_lot_photo(name));
create policy "Constrain lot photo deletes" on storage.objects as restrictive for delete to public
  using (bucket_id <> 'lot-photos' or public.can_upload_lot_photo(name));
create policy "Prevent lot photo overwrites" on storage.objects as restrictive for update to public
  using (bucket_id <> 'lot-photos') with check (bucket_id <> 'lot-photos');
create policy "Constrain lot photo reads" on storage.objects as restrictive for select to public
  using (bucket_id <> 'lot-photos' or exists (select 1 from public.lot_images i
    join public.lots l on l.id = i.lot_id where i.storage_path = name
    and (l.seller_id = (select auth.uid()) or (l.status <> 'DRAFT'
      and exists (select 1 from public.auction_rooms r where r.id = l.room_id and r.is_active)))));

create function public.guard_seller_photo_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.storage_path is not null and exists (select 1 from storage.objects
      where bucket_id = 'lot-photos' and name = old.storage_path) then
      raise exception 'Remove the file through Storage before removing its reference.';
    end if;
    return old;
  end if;
  if old.storage_path is not null and (new.storage_path is distinct from old.storage_path
    or new.lot_id <> old.lot_id or new.image_url <> old.image_url or new.id <> old.id) then
    raise exception 'Registered photo references cannot be changed.';
  end if;
  return new;
end;
$$;
create trigger guard_seller_photo_reference before update or delete on public.lot_images
  for each row execute function public.guard_seller_photo_reference();

create function public.remove_seller_photo(p_image_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare lot uuid;
begin
  select lot_id into lot from public.lot_images where id = p_image_id;
  if not found then return; end if; -- Safe retry after a lost removal response.
  perform 1 from public.lots where id = lot and seller_id = auth.uid() and status = 'DRAFT' for update;
  if not found then raise exception 'Only your own unfinished submission can be changed.'; end if;
  delete from public.lot_images where id = p_image_id; -- guard requires Storage API removal first
end;
$$;

create function public.validate_seller_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.submission_key is distinct from old.submission_key then
    raise exception 'Submission reference cannot be changed.';
  end if;
  if new.submission_key is not null and old.status = 'DRAFT' and new.status <> 'DRAFT' then
    if new.status <> 'WAITING' or length(btrim(new.title)) not between 1 and 160
      or new.description is null or length(btrim(new.description)) not between 1 and 10000
      or not (new.starting_bid between 0.01 and 999999999999.99)
      or new.starting_bid <> round(new.starting_bid, 2) or new.minimum_increment <> 50 then
      raise exception 'Listing details are invalid.'; end if;
    if (select count(*) from public.lot_images where lot_id = new.id) not between 1 and 10
      or exists (select 1 from public.lot_images i left join storage.objects o
        on o.bucket_id = 'lot-photos' and o.name = i.storage_path where i.lot_id = new.id
        and (i.storage_path is null or o.id is null
          or coalesce(o.metadata->>'mimetype', '') not in ('image/jpeg','image/png','image/webp')
          or coalesce((o.metadata->>'size')::bigint, 0) not between 1 and 5242880)) then
      raise exception 'Upload between 1 and 10 valid photos before submitting.';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_seller_submission before update on public.lots
  for each row execute function public.validate_seller_submission();

create function public.submit_seller_lot(p_lot_id uuid)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare result public.lots%rowtype; room uuid;
begin
  select room_id into room from public.lots where id = p_lot_id and seller_id = auth.uid() and submission_key is not null;
  if not found then raise exception 'Submission not found.'; end if;
  -- Match the existing lifecycle's room-before-lot lock order.
  perform 1 from public.auction_rooms where id = room and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  select * into result from public.lots where id = p_lot_id and seller_id = auth.uid() for update;
  if result.room_id <> room then raise exception 'Room changed. Please retry.'; end if;
  if result.status = 'DRAFT' then return public.publish_lot(p_lot_id); end if;
  return result; -- Idempotent retry after a lost response; never reorders/restarts a submitted lot.
end;
$$;

create function public.discard_seller_draft(p_lot_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.lots where id = p_lot_id and seller_id = auth.uid()
    and status = 'DRAFT' and submission_key is not null for update;
  if not found then raise exception 'Only your own unfinished submission can be discarded.'; end if;
  if exists (select 1 from public.bids where lot_id = p_lot_id) then
    raise exception 'A listing with bid history cannot be discarded.';
  end if;
  -- A physical file must be removed with the Storage API, never SQL metadata deletion.
  if exists (select 1 from storage.objects o join public.lot_images i on i.storage_path = o.name
    where o.bucket_id = 'lot-photos' and i.lot_id = p_lot_id) then
    raise exception 'Remove uploaded photos before discarding this submission.';
  end if;
  delete from public.lots where id = p_lot_id;
end;
$$;

revoke all on function public.save_seller_draft(uuid,uuid,text,text,numeric),
  public.prepare_seller_photo(uuid,uuid,text), public.can_upload_lot_photo(text),
  public.remove_seller_photo(uuid), public.submit_seller_lot(uuid), public.discard_seller_draft(uuid),
  public.guard_seller_photo_reference(), public.validate_seller_submission() from public, anon, authenticated;
grant execute on function public.save_seller_draft(uuid,uuid,text,text,numeric),
  public.prepare_seller_photo(uuid,uuid,text), public.can_upload_lot_photo(text),
  public.remove_seller_photo(uuid), public.submit_seller_lot(uuid), public.discard_seller_draft(uuid) to authenticated;
-- The restrictive policies also apply to anon on unrelated buckets. PostgreSQL checks
-- helper EXECUTE privileges before evaluating the bucket predicate. With no auth.uid()
-- this helper always returns false and cannot lock another user's draft.
grant execute on function public.can_upload_lot_photo(text) to anon;
commit;
