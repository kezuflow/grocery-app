"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CategoryNavigationView } from "@freshmarkets/contracts";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "../../../lib/utils";
import { useHorizontalDragScroll } from "./use-horizontal-drag-scroll";

type CategoryNavigationItem = CategoryNavigationView["categories"][number];

const FALLBACK_ICON_SRC = "/category-icons/all-groceries.svg";

export function CategoryStrip({
  categories,
  activeCategory = "all",
  onCategorySelect,
  className,
}: {
  categories: ReadonlyArray<CategoryNavigationItem>;
  activeCategory?: string;
  onCategorySelect?: (category: string) => void;
  className?: string;
}) {
  const railRef = useRef<HTMLElement>(null);
  const dragHandlers = useHorizontalDragScroll<HTMLElement>();
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const updateScrollState = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const maximumScroll = rail.scrollWidth - rail.clientWidth;
    setCanScrollBack(rail.scrollLeft > 1);
    setCanScrollForward(rail.scrollLeft < maximumScroll - 1);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    updateScrollState();
    rail.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(rail);
    return () => {
      rail.removeEventListener("scroll", updateScrollState);
      observer.disconnect();
    };
  }, [categories.length, updateScrollState]);

  const moveRail = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({
      left: direction * Math.max(240, rail.clientWidth * 0.72),
      behavior: "smooth",
    });
  };

  const itemClassName =
    "group flex h-[132px] w-[116px] shrink-0 snap-start flex-col items-center gap-2 py-1 text-center text-base leading-5 font-medium text-[var(--fm-text)] transition-transform hover:-translate-y-0.5";
  const selectCategory = (category: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      !onCategorySelect ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onCategorySelect(category);
  };

  return (
    <div className={cn("relative", className)}>
      <nav
        ref={railRef}
        aria-label="Grocery categories"
        data-testid="storefront-category-strip"
        className={cn(
          "fm-scrollbar-none flex touch-pan-y snap-x snap-mandatory gap-3 overflow-x-auto",
          (canScrollBack || canScrollForward) && "cursor-grab active:cursor-grabbing",
        )}
        {...dragHandlers}
      >
        <Link
          href="/"
          prefetch={false}
          aria-current={activeCategory === "all" ? "page" : undefined}
          onClick={selectCategory("all")}
          className={itemClassName}
        >
          <img
            src={FALLBACK_ICON_SRC}
            alt=""
            width={76}
            height={76}
            draggable={false}
            className="pointer-events-none size-[76px] shrink-0 select-none object-contain transition-transform group-hover:scale-105"
          />
          <span className="line-clamp-2">All groceries</span>
        </Link>
        {categories.map(({ code, name, slug, iconSrc }) => (
          <Link
            key={code}
            prefetch={false}
            href={`/?category=${slug}`}
            aria-current={slug === activeCategory ? "page" : undefined}
            onClick={selectCategory(slug)}
            className={itemClassName}
          >
            <img
              src={iconSrc ?? FALLBACK_ICON_SRC}
              alt=""
              width={76}
              height={76}
              draggable={false}
              className="pointer-events-none size-[76px] shrink-0 select-none object-contain transition-transform group-hover:scale-105"
            />
            <span className="line-clamp-2">{name}</span>
          </Link>
        ))}
      </nav>

      {canScrollBack ? (
        <button
          type="button"
          aria-label="Previous grocery categories"
          onClick={() => moveRail(-1)}
          className="absolute top-8 left-1 inline-flex size-10 items-center justify-center rounded-full border border-[var(--fm-border)] bg-white text-[var(--fm-text)] shadow-md transition-colors hover:bg-[var(--fm-hover)]"
        >
          <ChevronLeft className="size-5" strokeWidth={2.5} aria-hidden="true" />
        </button>
      ) : null}
      {canScrollForward ? (
        <button
          type="button"
          aria-label="Next grocery categories"
          onClick={() => moveRail(1)}
          className="absolute top-8 right-1 inline-flex size-10 items-center justify-center rounded-full border border-[var(--fm-border)] bg-white text-[var(--fm-text)] shadow-md transition-colors hover:bg-[var(--fm-hover)]"
        >
          <ChevronRight className="size-5" strokeWidth={2.5} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
