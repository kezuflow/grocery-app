import Link from "next/link";
import { cn } from "../../../lib/utils";
import { storefrontNavigation } from "./storefront-navigation";

const toneClasses: Record<string, string> = {
  produce: "bg-[#eff8dc] text-[#4d7b25]",
  fruits: "bg-[#fff1d7] text-[#9a5b11]",
  meat: "bg-[#fae8e6] text-[#a33f35]",
  dairy: "bg-[#eaf4fb] text-[#2b6a8e]",
  pantry: "bg-[#f7f0df] text-[#856a2f]",
  bakery: "bg-[#f9e9d9] text-[#9a5b11]",
  boxes: "bg-[#e8f1eb] text-[#2f6740]",
  deals: "bg-[#fbe7df] text-[#b34a28]",
};

export function CategoryStrip({
  activeCategory = "all",
  className,
}: {
  activeCategory?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Grocery categories"
      data-testid="storefront-category-strip"
      className={cn("fm-scrollbar-none flex gap-4 overflow-x-auto pb-1", className)}
    >
      <Link
        href="/"
        aria-current={activeCategory === "all" ? "page" : undefined}
        className={cn(
          "group flex min-w-[72px] shrink-0 flex-col items-center gap-2 rounded-[var(--fm-radius-surface)] px-2 py-2 text-center text-xs font-semibold text-[var(--fm-text-muted)] transition-colors hover:bg-[var(--fm-hover)] hover:text-[var(--fm-text)]",
          activeCategory === "all" && "bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-[var(--fm-primary-lime)] text-[var(--fm-primary-dark)] transition-transform group-hover:scale-105">
          <span className="text-lg font-bold" aria-hidden="true">
            ✓
          </span>
        </span>
        All groceries
      </Link>
      {storefrontNavigation.slice(1).map(({ label, href, icon: Icon, tone }) => {
        const category = href.split("category=")[1] ?? "";
        const active = category === activeCategory;
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-w-[72px] shrink-0 flex-col items-center gap-2 rounded-[var(--fm-radius-surface)] px-2 py-2 text-center text-xs font-semibold text-[var(--fm-text-muted)] transition-colors hover:bg-[var(--fm-hover)] hover:text-[var(--fm-text)]",
              active && "bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
            )}
          >
            <span
              className={cn(
                "flex size-12 items-center justify-center rounded-full transition-transform group-hover:scale-105",
                toneClasses[tone] ?? "bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
              )}
            >
              <Icon className="size-6" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="max-w-[88px] truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
