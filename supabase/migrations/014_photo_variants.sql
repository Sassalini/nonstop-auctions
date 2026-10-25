-- Review/apply manually after 013. No original objects or auction rows are changed.
begin;
alter table public.lot_images add column thumbnail_path text unique, add column display_path text unique;
create function public.guard_photo_variants() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if exists(select 1 from storage.objects where bucket_id='lot-photos' and name in(old.thumbnail_path,old.display_path)) then raise exception 'Remove photo variants through Storage before removing their reference.'; end if;
  return old;
 end if;
 if new.thumbnail_path is not null and (new.storage_path is null or new.thumbnail_path<>new.storage_path||'.thumb.webp')
 or new.display_path is not null and (new.storage_path is null or new.display_path<>new.storage_path||'.display.webp') then raise exception 'Invalid photo variant path.'; end if;
 if tg_op='UPDATE' and ((old.thumbnail_path is not null and new.thumbnail_path is distinct from old.thumbnail_path) or (old.display_path is not null and new.display_path is distinct from old.display_path)) then raise exception 'Photo variants cannot be replaced.'; end if;
 return new;
end; $$;
create trigger guard_photo_variants before insert or update or delete on public.lot_images for each row execute function public.guard_photo_variants();
create function public.prepare_seller_photo_variants(p_lot_id uuid,p_image_id uuid,p_extension text)
returns public.lot_images language plpgsql security definer set search_path='' as $$
declare result public.lot_images;
begin
 result:=public.prepare_seller_photo(p_lot_id,p_image_id,p_extension);
 update public.lot_images set thumbnail_path=storage_path||'.thumb.webp',display_path=storage_path||'.display.webp' where id=result.id returning * into result;
 return result;
end; $$;
-- Extend the existing checks to the two registered derivatives, with the same
-- draft ownership/locking, no-overwrite and public-lot visibility requirements.
create or replace function public.can_upload_lot_photo(p_path text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 perform 1 from public.lots l join public.lot_images i on i.lot_id=l.id
 where p_path in(i.storage_path,i.thumbnail_path,i.display_path) and l.seller_id=auth.uid() and l.status='DRAFT' and l.submission_key is not null for update of l;
 return found;
end; $$;
alter policy "Read visible lot photos" on storage.objects using(bucket_id='lot-photos' and exists(
 select 1 from public.lot_images i join public.lots l on l.id=i.lot_id where name in(i.storage_path,i.thumbnail_path,i.display_path)
 and(l.seller_id=(select auth.uid()) or(l.status<>'DRAFT' and exists(select 1 from public.auction_rooms r where r.id=l.room_id and r.is_active)))));
alter policy "Constrain lot photo reads" on storage.objects using(bucket_id<>'lot-photos' or exists(
 select 1 from public.lot_images i join public.lots l on l.id=i.lot_id where name in(i.storage_path,i.thumbnail_path,i.display_path)
 and(l.seller_id=(select auth.uid()) or(l.status<>'DRAFT' and exists(select 1 from public.auction_rooms r where r.id=l.room_id and r.is_active)))));
create function public.validate_photo_variants() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='DRAFT' and new.status='WAITING' and exists(
  select 1 from public.lot_images i cross join lateral(values(i.thumbnail_path),(i.display_path)) v(path)
  left join storage.objects o on o.bucket_id='lot-photos' and o.name=v.path
  where i.lot_id=new.id and (i.thumbnail_path is not null or i.display_path is not null)
  and(v.path is null or o.id is null or coalesce(o.metadata->>'mimetype','')<>'image/webp' or coalesce((o.metadata->>'size')::bigint,0) not between 1 and 5242880)
 ) then raise exception 'Finish uploading both photo variants before submitting.'; end if;
 return new;
end; $$;
create trigger validate_photo_variants before update on public.lots for each row execute function public.validate_photo_variants();
-- RLS invoker lookup: a stable same-origin URL never grants access by itself.
create function public.lot_photo_delivery(p_image_id uuid,p_size text)
returns table(object_path text,fallback_path text,public_cache boolean)
language sql stable security invoker set search_path='' as $$
 select case p_size when 'thumb' then coalesce(i.thumbnail_path,i.storage_path) when 'display' then coalesce(i.display_path,i.storage_path) else i.storage_path end,
 i.storage_path,coalesce(l.status<>'DRAFT' and r.is_active,false)
 from public.lot_images i join public.lots l on l.id=i.lot_id left join public.auction_rooms r on r.id=l.room_id
 where i.id=p_image_id and p_size in('thumb','display','original') and i.storage_path is not null;
$$;
-- Operator-only attachment AFTER immutable derivatives have been uploaded.
create function public.register_existing_photo_variants(p_image_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare original text;
begin
 select storage_path into original from public.lot_images where id=p_image_id for update;
 if original is null then raise exception 'Stored original required.'; end if;
 if (select count(*) from storage.objects where bucket_id='lot-photos' and name in(original||'.thumb.webp',original||'.display.webp') and metadata->>'mimetype'='image/webp' and (metadata->>'size')::bigint between 1 and 5242880)<>2 then raise exception 'Upload and validate both variants first.'; end if;
 update public.lot_images set thumbnail_path=original||'.thumb.webp',display_path=original||'.display.webp' where id=p_image_id;
end; $$;
revoke all on function public.guard_photo_variants(),public.validate_photo_variants(),public.prepare_seller_photo_variants(uuid,uuid,text),public.lot_photo_delivery(uuid,text),public.register_existing_photo_variants(uuid) from public,anon,authenticated;
grant execute on function public.prepare_seller_photo_variants(uuid,uuid,text) to authenticated;
grant execute on function public.lot_photo_delivery(uuid,text) to anon,authenticated;
grant execute on function public.register_existing_photo_variants(uuid) to service_role;
grant select(thumbnail_path,display_path) on public.lot_images to anon,authenticated;
commit;
