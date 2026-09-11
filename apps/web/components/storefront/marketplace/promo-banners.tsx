"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

import type { PublishedBanner } from "@freshmarkets/contracts";

/**
 * Image-based promotion cards sized for the marketplace's compact deals rail.
 */
export function PromoBanners({ campaigns }: { campaigns: PublishedBanner[] }) {
  const galleryRef = useRef<HTMLDivElement>(null);
  const [controlsReady, setControlsReady] = useState(false);
  const pausedRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const moveGallery = useCallback((direction: -1 | 1) => {
    const gallery = galleryRef.current;
    if (!gallery) return;
    const cards = Array.from(gallery.querySelectorAll<HTMLElement>("[data-promo-card]"));
    if (cards.length === 0) return;

    const positions = cards.map((card) => card.offsetLeft - gallery.offsetLeft);
    let currentIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    positions.forEach((position, index) => {
      const distance = Math.abs(position - gallery.scrollLeft);
      if (distance < closestDistance) {
        currentIndex = index;
        closestDistance = distance;
      }
    });

    const nextIndex = (currentIndex + direction + cards.length) % cards.length;
    gallery.scrollTo({
      left: positions[nextIndex],
      behavior: reducedMotionRef.current ? "auto" : "smooth",
    });
  }, []);

  useEffect(() => {
    setControlsReady(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = reducedMotion.matches;
    if (reducedMotion.matches) return;

    const timer = window.setInterval(() => {
      if (!pausedRef.current) moveGallery(1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [moveGallery]);

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const preventDraggedClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  if (campaigns.length === 0) return null;
  return (
    <section
      id="daily-deals"
      aria-labelledby="daily-deals-title"
      data-testid="storefront-promo-banner"
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="daily-deals-title" className="text-[32px] leading-[42px] font-semibold">
          Featured
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous banner"
            disabled={!controlsReady}
            onClick={() => moveGallery(-1)}
            className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--fm-border)] bg-white shadow-sm hover:bg-[var(--fm-hover)] disabled:cursor-wait disabled:opacity-50"
          >
            <ChevronLeft className="size-4.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next banner"
            disabled={!controlsReady}
            onClick={() => moveGallery(1)}
            className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--fm-border)] bg-white shadow-sm hover:bg-[var(--fm-hover)] disabled:cursor-wait disabled:opacity-50"
          >
            <ChevronRight className="size-4.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div>
        <div
          ref={galleryRef}
          data-testid="daily-deals-gallery"
          className="fm-scrollbar-none -mx-4 flex cursor-grab snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 active:cursor-grabbing sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
          onPointerEnter={() => {
            pausedRef.current = true;
          }}
          onPointerLeave={() => {
            pausedRef.current = false;
          }}
          onFocusCapture={() => {
            pausedRef.current = true;
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) pausedRef.current = false;
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            pausedRef.current = true;
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startScrollLeft: event.currentTarget.scrollLeft,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const distance = event.clientX - drag.startX;
            if (Math.abs(distance) > 6) drag.moved = true;
            event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onClickCapture={preventDraggedClick}
        >
          {campaigns.map((promo, index) => (
            <a
              key={promo.bannerId}
              href={promo.href ?? undefined}
              aria-label={promo.name}
              data-promo-card
              className="group block min-w-0 shrink-0 basis-[86%] snap-start overflow-hidden rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)] sm:basis-[58%] md:basis-[44%] lg:basis-[36%] xl:basis-[32%]"
            >
              <img
                src={promo.image.src}
                alt={promo.image.alt}
                width={1200}
                height={540}
                loading={index === 0 ? "eager" : "lazy"}
                draggable={false}
                className="pointer-events-none aspect-[20/9] h-auto w-full select-none object-cover transition-transform duration-200 group-hover:scale-[1.01]"
              />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
