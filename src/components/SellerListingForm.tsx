"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createPhotoVariants } from "@/lib/photo-variants";
import { RelistingControls } from "@/components/RelistingControls";
import { parseRelistingLimit, MAX_PHOTOS, PHOTO_BUCKET, parseStartingBid, photoExtensions, validatePhoto } from "@/lib/seller-validation";
import type { AuctionRoomRow, LotImageRow, LotRow } from "@/lib/supabase/types";

type Photo = { id: string; url: string; file?: File; path?: string; thumbnailPath?: string; displayPath?: string; variants?: { thumb: Blob; display: Blob }; uploaded: boolean };
const fieldClass = "w-full rounded-md border border-white/10 bg-black/35 px-3 text-sm text-auction-ivory outline-none transition focus:border-auction-gold disabled:opacity-50";

export function SellerListingForm({ rooms, userId, draft, initialPhotos, loadError }: {
  rooms: AuctionRoomRow[]; userId: string | null; draft: LotRow | null; initialPhotos: LotImageRow[]; loadError: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(draft?.title ?? "");
  const [roomId, setRoomId] = useState(draft?.room_id ?? "");
  const [startingBid, setStartingBid] = useState(draft ? String(draft.starting_bid) : "");
  const [relistingLimit, setRelistingLimit] = useState(String(draft?.max_auto_relistings ?? 5));
  const [unlimited, setUnlimited] = useState(draft?.relist_unlimited ?? false);
  const [description, setDescription] = useState(draft?.description ?? "");
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos.map(photo => ({ id: photo.id, url: photo.image_url, path: photo.storage_path ?? undefined, thumbnailPath: photo.thumbnail_path ?? undefined, displayPath: photo.display_path ?? undefined, uploaded: Boolean(photo.image_url) })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [photoError, setPhotoError] = useState("");
  const working = useRef(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const lotRef = useRef(draft);
  const keyRef = useRef(draft?.submission_key ?? null);
  useEffect(() => () => { photosRef.current.forEach(photo => { if (photo.url.startsWith("blob:")) URL.revokeObjectURL(photo.url); }); }, []);

  async function addPhotos(files: File[]) {
    if (working.current) return;
    working.current = true; setBusy(true); setPhotoError("");
    try {
      if (photos.length + files.length > MAX_PHOTOS) throw new Error("Choose up to 10 photos per item.");
      const prepared: Photo[] = [];
      for (const file of files) {
        await validatePhoto(file);
        const variants = await createPhotoVariants(file);
        prepared.push({ id: crypto.randomUUID(), url: "", file, variants, uploaded: false });
      }
      setPhotos(current => [...current, ...prepared.map(photo => ({ ...photo, url: URL.createObjectURL(photo.variants!.thumb) }))]);
    } catch (error) { setPhotoError(error instanceof Error ? error.message : "Could not read these photos."); }
    finally { working.current = false; setBusy(false); }
  }

  async function removePhoto(photo: Photo) {
    if (working.current) return;
    working.current = true; setBusy(true); setPhotoError("");
    try {
      if (photo.path) {
        const client = createSupabaseBrowserClient();
        const { error } = await client.storage.from(PHOTO_BUCKET).remove([photo.path, photo.thumbnailPath, photo.displayPath].filter((path): path is string => Boolean(path)));
        if (error) throw error;
        const removed = await client.rpc("remove_seller_photo", { p_image_id: photo.id });
        if (removed.error) throw removed.error;
      }
      if (photo.url.startsWith("blob:")) URL.revokeObjectURL(photo.url);
      setPhotos(current => current.filter(item => item.id !== photo.id));
    } catch { setPhotoError("Could not remove this photo. Please retry; your draft has been kept."); }
    finally { working.current = false; setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (working.current) return;
    const amount = parseStartingBid(startingBid);
    const retries = unlimited ? parseRelistingLimit(relistingLimit) ?? 5 : parseRelistingLimit(relistingLimit);
    if (retries === null) { setMessage("Automatic relistings must be a whole number from 0 to 100."); return; }
    if (!userId) { setMessage("Sign in before submitting a listing."); return; }
    if (!title.trim() || !description.trim() || !rooms.some(room => room.id === roomId)) { setMessage("Enter a title, item description and active auction room."); return; }
    if (amount === null) { setMessage("Enter a positive starting bid in GBP with no more than two decimal places."); return; }
    if (!photos.length || photos.some(photo => !photo.uploaded && !photo.file)) { setMessage("Add at least one photo. Remove and reselect any interrupted uploads."); return; }
    working.current = true; setBusy(true); setMessage("Saving your listing…");
    try {
      const client = createSupabaseBrowserClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user || user.id !== userId) throw new Error("Your session changed. Sign in and reopen your draft from My Auctions.");
      const cacheKey = `nonstop-seller-submission:${userId}`;
      keyRef.current ??= sessionStorage.getItem(cacheKey) ?? crypto.randomUUID();
      sessionStorage.setItem(cacheKey, keyRef.current);
      const saved = await client.rpc("save_seller_draft_with_relisting", { p_submission_key: keyRef.current, p_room_id: roomId,
        p_title: title.trim(), p_description: description.trim(), p_starting_bid: amount, p_relist_unlimited: unlimited, p_max_auto_relistings: retries });
      if (saved.error) throw saved.error;
      lotRef.current = saved.data;
      if (saved.data.status === "DRAFT") {
        for (const photo of photos) {
          const extension = photo.file ? photoExtensions[photo.file.type] : photo.path?.split(".").at(-1);
          if (!extension) throw new Error("Remove and reselect the interrupted photo.");
          const prepared = await client.rpc("prepare_seller_photo_variants", { p_lot_id: saved.data.id, p_image_id: photo.id, p_extension: extension });
          if (prepared.error) throw prepared.error;
          photo.path = prepared.data.storage_path!;
          photo.thumbnailPath = prepared.data.thumbnail_path!; photo.displayPath = prepared.data.display_path!;
          const paths = [photo.path, photo.thumbnailPath, photo.displayPath];
          const present = await Promise.all(paths.map(path => client.storage.from(PHOTO_BUCKET).info(path)));
          if (present.some(result => !result.data)) {
            let original: Blob | undefined = photo.file;
            if (!original && !present[0].error) {
              const existing = await client.storage.from(PHOTO_BUCKET).download(photo.path);
              if (existing.error) throw existing.error; original = existing.data;
            }
            if (!original) throw new Error("Remove and reselect the interrupted photo.");
            const variants = photo.variants ?? await createPhotoVariants(original);
            const objects = [original, variants.thumb, variants.display];
            const createdVariants: string[] = [];
            try {
              for (let index = 0; index < paths.length; index++) {
                if (present[index].data) continue;
                // Immutable paths, no overwrite. A retry recognises completed objects.
                const uploaded = await client.storage.from(PHOTO_BUCKET).upload(paths[index], objects[index], { contentType: objects[index].type, cacheControl: "3600", upsert: false });
                if (uploaded.error) throw uploaded.error;
                if (index > 0) createdVariants.push(paths[index]);
              }
            } catch (error) {
              // Remove only derivatives confirmed created by this attempt. Keep
              // originals, pre-existing variants and every persistent reference.
              // A lost response is ambiguous: retry/discard reconciles it safely.
              if (createdVariants.length) {
                const cleanup = await client.storage.from(PHOTO_BUCKET).remove(createdVariants);
                if (cleanup.error) throw new Error("Photo upload interrupted and cleanup could not finish. Resume or discard the saved draft to reconcile its registered files.");
              }
              throw error;
            }
          }
          photo.uploaded = true;
          setPhotos([...photos]);
        }
        const submitted = await client.rpc("submit_seller_lot", { p_lot_id: saved.data.id });
        if (submitted.error) throw submitted.error;
      }
      sessionStorage.removeItem(cacheKey);
      setMessage("Listing submitted to the auction room queue.");
      router.push("/my-auctions?submitted=1"); router.refresh();
    } catch (error) {
      const detail = error && typeof error === "object" && "message" in error ? String(error.message) : "Please check your connection and retry.";
      setPhotos([...photos]);
      setMessage(`${detail}${lotRef.current ? " Your unfinished submission is saved in My Auctions. Retry here or resume it there." : ""}`);
    } finally { working.current = false; setBusy(false); }
  }

  return <form onSubmit={submit} className="min-w-0 rounded-lg border border-white/10 bg-auction-panel/90 p-5 shadow-glow sm:p-6">
    {!userId ? <p className="mb-5 text-sm text-auction-gold"><Link href="/login?next=/sell" className="underline">Sign in</Link> to submit an item.</p> : null}
    {loadError ? <p role="alert" className="mb-5 text-sm text-auction-ember">{loadError}</p> : null}
    {!loadError && !rooms.length ? <p role="status" className="mb-5 text-sm text-auction-muted">No auction rooms are currently accepting listings.</p> : null}
    <fieldset disabled={busy || Boolean(loadError)} className="min-w-0">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2"><span className="text-sm font-medium text-auction-ivory">Item title</span><input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} className={`${fieldClass} h-11`} /></label>
        <label className="space-y-2"><span id="seller-room-label" className="text-sm font-medium text-auction-ivory">Auction room</span><select aria-labelledby="seller-room-label" required value={roomId} onChange={event => setRoomId(event.target.value)} className={`${fieldClass} h-11`}>
          <option value="">Choose an auction room</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select></label>
        <label className="space-y-2"><span className="text-sm font-medium text-auction-ivory">Starting bid (GBP)</span><input required inputMode="decimal" value={startingBid} onChange={event => setStartingBid(event.target.value)} className={`${fieldClass} h-11`} aria-describedby="starting-bid-help" /></label>
        <p id="starting-bid-help" className="self-center text-xs leading-5 text-auction-muted">Enter pounds and pence, for example 25.50. Auctions have no reserve. Later bids use the existing £50 minimum increment.</p>
      </div>
      <RelistingControls prefix="seller-new" limit={relistingLimit} unlimited={unlimited} onLimit={setRelistingLimit} onUnlimited={setUnlimited} />
      <label className="mt-5 block space-y-2"><span id="seller-description-label" className="text-sm font-medium text-auction-ivory">Item Description</span><span id="item-description-help" className="block text-xs leading-5 text-auction-muted">Please add in as much detail all relevant details about the item including: Condition, Age, History, Dimensions and measurements, Maker information, Known repairs.</span>
        <textarea aria-labelledby="seller-description-label" required maxLength={10000} rows={5} value={description} onChange={event => setDescription(event.target.value)} aria-describedby="item-description-help" className={`${fieldClass} resize-y py-3`} />
      </label>
      <div className="mt-5 rounded-lg border border-dashed border-auction-gold/40 bg-black/25 p-5">
        <Upload className="mx-auto text-auction-gold" size={24} />
        <label className="mt-3 block text-sm font-medium text-auction-ivory">Item photographs<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addPhotos(files); }} className="mt-3 block w-full min-w-0 text-xs text-auction-muted file:mr-3 file:rounded file:border-0 file:bg-auction-gold file:px-3 file:py-2 file:text-black" /></label>
        <p className="mt-2 text-xs text-auction-muted">1–10 JPEG, PNG or WebP photos, up to 5 MB each.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => <div key={photo.id} className="relative overflow-hidden rounded-md border border-white/10 bg-black/30">
            {photo.url ? <Image src={photo.url} unoptimized width={200} height={150} alt={`Item photograph ${index + 1}`} className="aspect-[4/3] w-full object-cover" /> : <p className="p-3 text-xs text-auction-muted">Upload interrupted. Remove and reselect this photo.</p>}
            <button type="button" aria-label={`Remove photograph ${index + 1}`} onClick={() => void removePhoto(photo)} className="absolute right-1 top-1 flex size-9 items-center justify-center rounded bg-black/85 text-auction-ivory"><X size={18} /></button>
          </div>)}
        </div>
        {photoError ? <p role="alert" className="mt-3 text-sm text-auction-ember">{photoError}</p> : null}
      </div>
    </fieldset>
    {message ? <p role="status" className="mt-4 text-sm text-auction-gold">{message}</p> : null}
    <button type="submit" disabled={busy || !userId || !rooms.length || Boolean(loadError)} className="mt-5 flex min-h-11 w-full items-center justify-center rounded-md bg-auction-gold px-4 text-sm font-semibold text-black hover:bg-auction-goldSoft disabled:opacity-50">{busy ? "Saving…" : "Submit listing"}</button>
    {lotRef.current ? <Link href="/my-auctions" className="mt-3 inline-block text-sm text-auction-gold underline">View your saved submissions</Link> : null}
  </form>;
}
