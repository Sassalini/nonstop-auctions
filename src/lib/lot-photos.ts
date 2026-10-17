import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LotImageRow } from "@/lib/supabase/types";
import { PHOTO_BUCKET } from "@/lib/seller-validation";

// Store permanent paths, never expiring signed URLs. Existing external/local images stay intact.
export async function resolveLotPhotos(client: SupabaseClient<Database>, images: LotImageRow[]) {
  const stored = images.filter(image => image.storage_path);
  if (!stored.length) return images;
  const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrls(stored.map(image => image.storage_path!), 3600);
  if (error) throw new Error("Could not load listing photos. Please try again.");
  const urls = new Map(data?.map(item => [item.path, item.signedUrl]));
  return images.map(image => image.storage_path ? { ...image, image_url: urls.get(image.storage_path) ?? "" } : image);
}
