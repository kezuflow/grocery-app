"use client";
import { useState } from "react";
import type { CatalogMedia } from "@freshmarkets/contracts";
import { ProductMedia } from "./product-media";

/** Shared by the full Product page and quick view; cards keep the main photo. */
export function ProductGallery({
  images,
  name,
}: {
  images: ReadonlyArray<CatalogMedia>;
  name: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const current = images.find((image) => image.src === selected) ?? images[0] ?? null;
  return (
    <div className="space-y-3" aria-label={`${name} photos`}>
      <ProductMedia media={current} name={name} className="rounded-[var(--fm-radius-surface)]" />
      {images.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <button
              key={image.src}
              type="button"
              aria-label={`Show photo ${index + 1}: ${image.alt}`}
              aria-pressed={image.src === current?.src}
              className="size-14 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-1 transition-colors hover:border-[var(--fm-primary-dark)] aria-pressed:border-[var(--fm-primary-dark)]"
              onClick={() => setSelected(image.src)}
            >
              <img src={image.src} alt="" className="size-full object-contain" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
