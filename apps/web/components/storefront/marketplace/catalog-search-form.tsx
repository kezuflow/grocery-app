"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { catalogHref, normalizeCatalogSelection } from "../../../lib/query/catalog";
import { cn } from "../../../lib/utils";

/** Header integration point for same-path catalog search without an RSC navigation. */
export function CatalogSearchForm({
  id,
  className,
  mobile = false,
}: {
  id: string;
  className?: string;
  mobile?: boolean;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const selection = normalizeCatalogSelection(searchParams);
  const [value, setValue] = useState(selection.query);
  useEffect(() => setValue(selection.query), [selection.query]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const href = catalogHref({
      query: value.trim(),
      category: pathname === "/" ? selection.category : "all",
    });
    if (pathname === "/") window.history.pushState(null, "", href);
    else router.push(href);
  };

  return (
    <form onSubmit={submit} action="/" className={className}>
      <label className="sr-only" htmlFor={id}>
        Search groceries
      </label>
      <div
        className={cn(
          "flex h-10 items-center gap-2 rounded-full border border-[var(--fm-border)] bg-[var(--fm-surface-soft)] px-3 text-[var(--fm-text-muted)] focus-within:border-[var(--fm-primary-dark)]",
          !mobile && "transition-colors",
        )}
      >
        <Search className="size-4" aria-hidden="true" />
        <input
          id={id}
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search fresh groceries"
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--fm-text)] outline-none placeholder:text-[var(--fm-text-muted)]"
        />
      </div>
    </form>
  );
}
