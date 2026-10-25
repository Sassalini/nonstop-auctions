import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LotImageRow } from "@/lib/supabase/types";
export type PhotoSize = "thumb" | "display" | "original";
export const photoUrl = (id: string, size: PhotoSize) => `/api/lot-photos/${id}/${size}`;
// Stable URLs, no signed-token cache busting. Each uncached image request checks
// the caller's RLS and private Storage permissions. No object is publicised.
export const photoDeliveryUrl = (image: LotImageRow, size: PhotoSize) => photoUrl(image.id,
 size === "thumb" && image.thumbnail_path ? "thumb" : size === "display" && image.display_path ? "display" : "original");
// Legacy originals share ONE URL across all surfaces until reviewed backfill;
// separate fallback URLs would otherwise download the same original twice.
export async function resolveLotPhotos(_client: SupabaseClient<Database>, images: LotImageRow[], size: PhotoSize = "thumb") {
 return images.map(image => image.storage_path ? { ...image, image_url: photoDeliveryUrl(image, size) } : image);
}
