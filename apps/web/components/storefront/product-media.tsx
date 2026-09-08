"use client";
import { useState } from "react";
import { Leaf } from "lucide-react";
import type { CatalogMedia } from "@freshmarkets/contracts";
import { cn } from "@/lib/utils";

/** Render only Core's published URL; unavailable content becomes an accessible placeholder. */
export function ProductMedia({
  media,
  name,
  className,
}: {
  media: CatalogMedia | null;
  name: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (media && failedSrc !== media.src)
    return (
      <img
        src={media.src}
        alt={media.alt}
        onError={() => setFailedSrc(media.src)}
        className={cn("aspect-square w-full object-contain", className)}
      />
    );
  return (
    <div
      role="img"
      aria-label={`${name} product image`}
      className={cn(
        "flex aspect-square w-full items-center justify-center bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
        className,
      )}
    >
      <Leaf className="size-12 stroke-[1.25]" aria-hidden="true" />
    </div>
  );
}
