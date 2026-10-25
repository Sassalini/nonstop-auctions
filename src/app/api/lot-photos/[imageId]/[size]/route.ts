import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PHOTO_BUCKET } from "@/lib/seller-validation";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ imageId: string; size: string }> }) {
 const { imageId, size } = await params;
 const fail = (status: number) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId) || !["thumb", "display", "original"].includes(size)) return fail(404);
 try {
  const client = await createSupabaseServerClient();
  const result = await client.rpc("lot_photo_delivery", { p_image_id: imageId, p_size: size });
  if (result.error) return fail(503);
  const row = result.data?.[0]; if (!row) return fail(404);
  const bytes = new TextEncoder().encode(row.object_path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const etag = `"${Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("")}"`;
  const headers = new Headers({ "Cache-Control": row.public_cache ? "private, max-age=300, must-revalidate" : "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (!row.public_cache) headers.set("Vary", "Cookie");
  // Public-lot bytes are identical across sessions; drafts are no-store.
  // Authorization is rechecked even for conditional revalidation. Draft/private
  // responses are never retained or shared across accounts or at the CDN.
  if (row.public_cache && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: new Headers([...headers, ["ETag", etag]]) });
  let photo = await client.storage.from(PHOTO_BUCKET).download(row.object_path);
  let fallback = false;
  if (photo.error && row.fallback_path !== row.object_path) { photo = await client.storage.from(PHOTO_BUCKET).download(row.fallback_path); fallback = true; }
  if (photo.error || !photo.data) return fail(404);
  if (!/^image\/(jpeg|png|webp)$/.test(photo.data.type)) return fail(415);
  headers.set("Content-Type", photo.data.type); headers.set("Content-Length", String(photo.data.size));
  if (fallback) headers.set("Cache-Control", "private, no-store");
  else if (row.public_cache) headers.set("ETag", etag);
  return new Response(photo.data, { headers });
 } catch { return fail(503); }
}
