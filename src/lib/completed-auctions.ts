import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveLotPhotos } from "@/lib/lot-photos";

export const historyPageSize = 50;
export function parseHistoryPage(value?: string) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 1000000 ? page : 1;
}
export function parseHistoryLot(value?: string) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
}
export async function getCompletedAuctions(mode: "buyer" | "seller", page = 1, lotId?: string) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("completed_auctions_page_with_reference", {
    p_mode: mode, p_limit: historyPageSize + 1, p_offset: lotId ? 0 : (page - 1) * historyPageSize,
    ...(lotId ? { p_lot_id: lotId } : {}),
  });
  if (error) throw new Error("Could not load completed auctions. Please try again.");
  const records = (data ?? []).slice(0, historyPageSize);
  // The legacy history RPC contains original paths, not image IDs. Resolve only
  // this bounded page to stable thumbnail endpoints, without signing originals.
  const paths = records.flatMap(row => row.storage_path ? [row.storage_path] : []);
  const lookup = paths.length ? await client.from("lot_images").select("id,storage_path,thumbnail_path,display_path").in("storage_path", paths) : { data: [], error: null };
  if (lookup.error) throw new Error("Could not load auction photographs.");
  const variants = new Map((lookup.data ?? []).map(image => [image.storage_path, image]));
  const ids = new Map((lookup.data ?? []).map(image => [image.storage_path, image.id]));
  const photos = await resolveLotPhotos(client, records.map(row => ({
    id: ids.get(row.storage_path) ?? row.lot_id, lot_id: row.lot_id, image_url: row.storage_path && !ids.has(row.storage_path) ? "" : row.image_url ?? "", storage_path: ids.has(row.storage_path) ? row.storage_path : null,
    thumbnail_path: variants.get(row.storage_path)?.thumbnail_path, display_path: variants.get(row.storage_path)?.display_path,
    alt_text: row.title, sort_order: 0, created_at: row.completed_at,
  })));
  const urls = new Map(photos.map(photo => [photo.lot_id, photo.image_url]));
  return { records: records.map(record => ({ ...record, image_url: urls.get(record.lot_id) })), hasNext: (data?.length ?? 0) > historyPageSize, page, focused: Boolean(lotId) };
}
export type CompletedAuctionPage = Awaited<ReturnType<typeof getCompletedAuctions>>;
