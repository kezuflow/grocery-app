import Link from "next/link";
import type { CategoryNavigationView } from "@freshmarkets/contracts";
import { cn } from "../../../lib/utils";

type CategoryNavigationItem = CategoryNavigationView["categories"][number];

const FALLBACK_ICON_SRC = "/category-icons/all-groceries.svg";

export function CategoryStrip({
  categories,
  activeCategory = "all",
  className,
}: {
  categories: ReadonlyArray<CategoryNavigationItem>;
  activeCategory?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Grocery categories"
      data-testid="storefront-category-strip"
      className={cn("fm-scrollbar-none flex gap-8 overflow-x-auto pb-1", className)}
    >
      <Link
        href="/"
        aria-current={activeCategory === "all" ? "page" : undefined}
        className={cn(
          "group flex h-[140px] w-24 shrink-0 flex-col items-center gap-1.5 overflow-hidden rounded-[var(--fm-radius-surface)] border-b-[3px] border-transparent py-1 text-center text-xs leading-[18px] font-semibold text-[var(--fm-text-muted)] transition-colors hover:bg-[var(--fm-hover)] hover:text-[var(--fm-text)]",
          activeCategory === "all" &&
            "border-[var(--fm-primary-lime)] bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
        )}
      >
        <img
          src={FALLBACK_ICON_SRC}
          alt=""
          width={88}
          height={88}
          className="size-[88px] shrink-0 object-contain transition-transform group-hover:scale-105"
        />
        <span className="line-clamp-2">All groceries</span>
      </Link>
      {categories.map(({ code, name, slug, iconSrc }) => {
        const active = slug === activeCategory;
        return (
          <Link
            key={code}
            href={`/?category=${slug}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-[140px] w-24 shrink-0 flex-col items-center gap-1.5 overflow-hidden rounded-[var(--fm-radius-surface)] border-b-[3px] border-transparent py-1 text-center text-xs leading-[18px] font-semibold text-[var(--fm-text-muted)] transition-colors hover:bg-[var(--fm-hover)] hover:text-[var(--fm-text)]",
              active &&
                "border-[var(--fm-primary-lime)] bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
            )}
          >
            <img
              src={iconSrc ?? FALLBACK_ICON_SRC}
              alt=""
              width={88}
              height={88}
              className="size-[88px] shrink-0 object-contain transition-transform group-hover:scale-105"
            />
            <span className="line-clamp-2">{name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
