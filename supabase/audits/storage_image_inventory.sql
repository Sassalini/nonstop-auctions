-- READ ONLY. Review/run manually in the Supabase SQL Editor; this does not
-- download, change, delete or overwrite any object. Works before migration 014.
select i.id as image_id,i.lot_id,l.status,r.slug as room,i.storage_path,
 o.metadata->>'mimetype' as mime_type,(o.metadata->>'size')::bigint as original_bytes,
 i.storage_path||'.thumb.webp' as proposed_thumbnail_path,
 i.storage_path||'.display.webp' as proposed_display_path,
 thumb.id is null as thumbnail_missing,display.id is null as display_missing,
 (thumb.metadata->>'size')::bigint as thumbnail_bytes,(display.metadata->>'size')::bigint as display_bytes
from public.lot_images i join public.lots l on l.id=i.lot_id
left join public.auction_rooms r on r.id=l.room_id
left join storage.objects o on o.bucket_id='lot-photos' and o.name=i.storage_path
left join storage.objects thumb on thumb.bucket_id='lot-photos' and thumb.name=i.storage_path||'.thumb.webp'
left join storage.objects display on display.bucket_id='lot-photos' and display.name=i.storage_path||'.display.webp'
where i.storage_path is not null
order by (o.metadata->>'size')::bigint desc nulls last,i.id;
-- In Logs Explorer (Logs source, matching billing period), use Supabase's
-- documented edge_logs grouping to find repeat GETs and cache HIT/MISS counts.
-- Logs counts alone are not byte measurements. Join exported object paths to
-- original_bytes above offline. Redact tokens/query strings from all exports.
