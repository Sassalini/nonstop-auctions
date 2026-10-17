export const PHOTO_BUCKET = "lot-photos";
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 10;
export const photoExtensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function parseStartingBid(value: string): number | null {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value);
  return amount >= 0.01 && amount <= 999999999999.99 ? amount : null;
}

export async function validatePhoto(file: File): Promise<void> {
  if (!photoExtensions[file.type]) throw new Error("Choose JPEG, PNG or WebP photographs.");
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error("Each photo must be between 1 byte and 5 MB.");
  // Decode before accepting: a renamed text file or corrupt image is not a valid photo.
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`${file.name} is not a readable image.`); });
  bitmap.close();
}
