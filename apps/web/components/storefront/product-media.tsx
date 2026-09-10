"use client";
import { useEffect, useRef, useState } from "react";
import { Leaf } from "lucide-react";
import type { CatalogMedia } from "@freshmarkets/contracts";
import { cn } from "@/lib/utils";

/** Render only Core's published URL; unavailable content becomes an accessible placeholder. */
export function ProductMedia({
  media,
  name,
  className,
  priority = false,
}: {
  media: CatalogMedia | null;
  name: string;
  className?: string;
  priority?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (priority || visible || !imageRef.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    // Native lazy-loading distances encompass most of our compact rails.
    // Delay the source too, including images far along a horizontal rail.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(imageRef.current);
    return () => observer.disconnect();
  }, [priority, visible, media?.src]);
  if (media && failedSrc !== media.src)
    return (
      <img
        ref={imageRef}
        src={priority || visible ? media.src : undefined}
        alt={media.alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        width={320}
        height={320}
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
