// Browser-only encoding; no paid transforms or Worker-native image libraries.
export const PHOTO_VARIANTS = { thumb: { edge: 400, quality: 0.78 }, display: { edge: 1600, quality: 0.86 } } as const;
export async function createPhotoVariants(source: Blob) {
 const bitmap = await createImageBitmap(source);
 try {
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error("Choose a photo with at most 40 megapixels.");
  const output = {} as Record<keyof typeof PHOTO_VARIANTS, Blob>;
  for (const size of ["thumb", "display"] as const) {
   const { edge, quality } = PHOTO_VARIANTS[size];
   const ratio = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
   const canvas = document.createElement("canvas");
   canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
   const context = canvas.getContext("2d"); if (!context) throw new Error("Photo processing is unavailable in this browser.");
   context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
   const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
   canvas.width = canvas.height = 1;
   if (!blob || blob.type !== "image/webp" || blob.size > 5 * 1024 * 1024) throw new Error("Could not prepare WebP photos. Please use a current browser.");
   output[size] = blob;
  }
  return output;
 } finally { bitmap.close(); }
}
