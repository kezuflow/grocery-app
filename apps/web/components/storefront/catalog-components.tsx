import Link from "next/link";
import { ArrowRight, CircleAlert, Leaf, Search } from "lucide-react";
import type { CatalogProduct } from "@freshmarkets/contracts";
import { cn } from "../../lib/utils";

export const categoryOptions = [
  { slug: "all", label: "All groceries" },
  { slug: "produce", label: "Produce" },
  { slug: "fruits", label: "Fruits" },
  { slug: "meat-seafood", label: "Meat & Seafood" },
  { slug: "dairy-eggs", label: "Dairy & Eggs" },
  { slug: "pantry", label: "Pantry" },
  { slug: "bakery", label: "Bakery" },
  { slug: "boxes", label: "Boxes" },
  { slug: "deals", label: "Deals" },
] as const;

const imageBySlug: Record<string, string> = {
  "red-onion": "/produce/onion-red-creole-bermuda-red.webp",
};

function money(amount: number | null, currency: string | null) {
  if (amount === null || !currency) return "Unavailable";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount / 100);
}

function categoryMatches(product: CatalogProduct, category: string) {
  if (!category || category === "all") return true;
  const categoryText =
    `${product.category.name} ${product.category.slug} ${product.name}`.toLowerCase();
  const aliases: Record<string, string> = {
    produce: "produce",
    fruits: "fruit",
    "meat-seafood": "meat seafood",
    "dairy-eggs": "dairy egg",
    pantry: "pantry",
    bakery: "bakery",
    boxes: "box",
    deals: "deal",
  };
  return aliases[category]?.split(" ").some((term) => categoryText.includes(term)) ?? false;
}

export function CatalogCategoryRail({ active }: { active: string }) {
  return (
    <nav
      aria-label="Grocery categories"
      className="fm-scrollbar-none flex gap-2 overflow-x-auto pb-1"
    >
      {categoryOptions.map((category) => (
        <Link
          key={category.slug}
          href={category.slug === "all" ? "/" : `/?category=${category.slug}`}
          aria-current={active === category.slug ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-[var(--fm-radius-control)] px-3 py-2 text-sm font-medium text-[var(--fm-text-muted)] transition-colors hover:bg-[var(--fm-hover)] hover:text-[var(--fm-text)]",
            active === category.slug && "bg-[var(--fm-primary-lime)] text-[var(--fm-primary-dark)]",
          )}
        >
          {category.label}
        </Link>
      ))}
    </nav>
  );
}

export function CatalogSearchBar({ value }: { value: string }) {
  return (
    <form action="/" className="flex w-full gap-2 sm:max-w-xl">
      <label className="sr-only" htmlFor="catalog-query">
        Search groceries
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-[var(--fm-text-muted)]">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input
          id="catalog-query"
          name="q"
          defaultValue={value}
          placeholder="Search fresh groceries"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-[var(--fm-text)] outline-none placeholder:text-[var(--fm-text-muted)]"
        />
      </div>
      <button
        type="submit"
        className="inline-flex min-h-10 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 text-sm font-semibold text-white hover:bg-[#294f30]"
      >
        Search
      </button>
    </form>
  );
}

export function ProductImage({
  product,
  className,
  alt = "",
}: {
  product: CatalogProduct;
  className?: string;
  alt?: string;
}) {
  const image = imageBySlug[product.slug];
  return image ? (
    <img
      src={image}
      alt={alt}
      className={cn("aspect-square w-full object-contain mix-blend-multiply", className)}
    />
  ) : (
    <div
      className={cn(
        "flex aspect-square w-full items-center justify-center bg-[var(--fm-surface-soft)] text-[var(--fm-primary-dark)]",
        className,
      )}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      <Leaf className="size-12 stroke-[1.25]" aria-hidden="true" />
    </div>
  );
}

export function ProductCard({ product }: { product: CatalogProduct }) {
  const variant = product.variants[0];
  return (
    <article className="group min-w-0">
      <Link
        href={`/products/${product.slug}`}
        className="block rounded-[var(--fm-radius-surface)] focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
      >
        <div className="relative overflow-hidden rounded-[var(--fm-radius-surface)] bg-[var(--fm-surface-soft)]">
          <ProductImage product={product} alt={`${product.name} product image`} />
          <span className="absolute bottom-2 right-2 inline-flex min-h-9 items-center gap-1 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-xs font-semibold text-[var(--fm-primary-dark)] shadow-sm transition-colors group-hover:bg-[var(--fm-primary-lime)]">
            <span>View</span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </span>
        </div>
        <div className="pt-3">
          <p className="text-base font-bold tabular-nums">
            {variant ? money(variant.priceMinor, variant.currency) : "Unavailable"}
          </p>
          <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">{product.name}</h3>
          <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
            {variant ? variant.name : "Fixed variant unavailable"}
          </p>
          <p
            className={cn(
              "mt-2 flex items-center gap-1 text-xs font-medium",
              product.available ? "text-[var(--fm-success)]" : "text-[var(--fm-destructive)]",
            )}
          >
            {product.available ? (
              <Leaf className="size-3" aria-hidden="true" />
            ) : (
              <CircleAlert className="size-3" aria-hidden="true" />
            )}
            {product.available ? "Available for review" : "Currently unavailable"}
          </p>
        </div>
      </Link>
    </article>
  );
}

export function ProductGrid({
  products,
  query,
  category,
}: {
  products: ReadonlyArray<CatalogProduct>;
  query: string;
  category: string;
}) {
  const visible = products.filter((product) => categoryMatches(product, category));
  if (visible.length === 0) {
    return (
      <div className="border-y border-[var(--fm-border)] py-16 text-center">
        <CircleAlert className="mx-auto size-7 text-[var(--fm-text-muted)]" aria-hidden="true" />
        <h3 className="mt-3 font-semibold">No groceries found</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--fm-text-muted)]">
          {query
            ? `No products match “${query}” in this category.`
            : "This category has no products in the current catalog."}{" "}
          Availability can change with delivery context.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex text-sm font-semibold text-[var(--fm-primary-dark)] underline underline-offset-4"
        >
          Browse all groceries
        </Link>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {visible.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

export function ProductRail({
  title,
  products,
}: {
  title: string;
  products: ReadonlyArray<CatalogProduct>;
}) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby={`rail-${title}`} className="border-t border-[var(--fm-border)] pt-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id={`rail-${title}`} className="text-xl font-bold tracking-[-0.02em]">
          {title}
        </h2>
        <Link href="/" className="text-sm font-semibold text-[var(--fm-primary-dark)]">
          See all
        </Link>
      </div>
      <div className="fm-scrollbar-none grid auto-cols-[minmax(150px,190px)] grid-flow-col gap-4 overflow-x-auto pb-3 sm:auto-cols-[minmax(180px,1fr)] sm:grid-flow-col">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

export { categoryMatches };
