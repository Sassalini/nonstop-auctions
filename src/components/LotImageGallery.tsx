"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Maximize2, Volume2 } from "lucide-react";
import type { Lot } from "@/lib/auction-data";

type LotImageGalleryProps = {
  lot: Lot;
};

export function LotImageGallery({ lot }: LotImageGalleryProps) {
  const images = useMemo(() => {
    return Array.from(new Set(lot.galleryImageUrls?.length ? lot.galleryImageUrls : [lot.imageUrl]));
  }, [lot.galleryImageUrls, lot.imageUrl]);
  const [selectedImage, setSelectedImage] = useState(images[0]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black">
        <div className="relative aspect-[16/10] min-h-[330px] sm:aspect-[16/9] lg:min-h-[470px]">
          <Image
            src={selectedImage}
            alt={lot.title}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 60vw"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/10" />
        <button
          type="button"
          title="Audio"
          className="absolute bottom-4 left-4 flex size-10 items-center justify-center rounded-lg bg-black/55 text-auction-ivory backdrop-blur transition hover:bg-auction-gold hover:text-black"
        >
          <Volume2 size={22} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          title="Fullscreen"
          className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-lg bg-black/55 text-auction-ivory backdrop-blur transition hover:bg-auction-gold hover:text-black"
        >
          <Maximize2 size={20} strokeWidth={1.8} />
        </button>
      </div>

      {images.length > 1 ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {images.map((imageUrl, index) => {
            const isSelected = selectedImage === imageUrl;
            return (
              <button
                key={imageUrl}
                type="button"
                onClick={() => setSelectedImage(imageUrl)}
                className={`relative aspect-[4/3] overflow-hidden rounded-md border transition ${
                  isSelected
                    ? "border-auction-gold shadow-glow"
                    : "border-white/10 hover:border-auction-gold/50"
                }`}
              >
                <Image
                  src={imageUrl}
                  alt={`${lot.title} view ${index + 1}`}
                  fill
                  sizes="120px"
                  className="object-cover"
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
