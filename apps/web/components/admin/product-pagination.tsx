"use client";

import { Fragment, useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./shadcn/button";
import { Input } from "./shadcn/input";
import { Field, FieldGroup, FieldLabel } from "./shadcn/field";

const pathname = "/admin/catalog/products";

/** Numbered Product URLs are independent of previously visited pages. */
export function useProductPagination() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("page");
  const page = raw === null ? 1 : Number(raw);
  return {
    page,
    href(target: number) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("cursor");
      params.delete("cursorHistory");
      params.set("page", String(target));
      return `${pathname}?${params}`;
    },
    reset(params: URLSearchParams) {
      params.delete("cursor");
      params.delete("cursorHistory");
      params.delete("page");
    },
  };
}

export function ProductPagination({
  page,
  totalPages,
  pending,
  href,
}: {
  page: number;
  totalPages: number;
  pending: boolean;
  href(page: number): string;
}) {
  const [jump, setJump] = useState(String(page));
  const jumpId = useId();
  useEffect(() => setJump(String(page)), [page]);
  const pages =
    totalPages <= 5
      ? Array.from({ length: totalPages }, (_, index) => index + 1)
      : [...new Set([1, page - 1, page, page + 1, totalPages])]
          .filter((value) => value >= 1 && value <= totalPages)
          .sort((a, b) => a - b);
  function navigate(target: number) {
    window.history.pushState(null, "", href(target));
  }
  return (
    <nav
      aria-label="Products pagination"
      className="flex flex-wrap items-center justify-end gap-2 px-4 py-3"
    >
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <ul className="flex items-center gap-1">
        <li>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous page"
            disabled={pending || page <= 1}
            onClick={() => navigate(page - 1)}
          >
            <ChevronLeft />
          </Button>
        </li>
        {pages.map((target, index) => (
          <Fragment key={target}>
            {index > 0 && target - (pages[index - 1] ?? target) > 1 ? (
              <li>
                <span aria-hidden="true" className="flex size-9 items-center justify-center">
                  …
                </span>
              </li>
            ) : null}
            <li>
              <Button asChild variant={target === page ? "outline" : "ghost"} size="icon">
                <a
                  href={href(target)}
                  aria-label={`Page ${target}`}
                  aria-current={target === page ? "page" : undefined}
                  aria-disabled={pending}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    if (!pending && target !== page) navigate(target);
                  }}
                >
                  {target}
                </a>
              </Button>
            </li>
          </Fragment>
        ))}
        <li>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next page"
            disabled={pending || page >= totalPages}
            onClick={() => navigate(page + 1)}
          >
            <ChevronRight />
          </Button>
        </li>
      </ul>
      {totalPages > 5 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const target = Number(jump);
            if (!pending && Number.isSafeInteger(target) && target >= 1 && target <= totalPages)
              navigate(target);
          }}
        >
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel htmlFor={jumpId} className="sr-only">
                Go to page
              </FieldLabel>
              <Input
                id={jumpId}
                type="number"
                min={1}
                max={totalPages}
                required
                className="w-20"
                value={jump}
                onChange={(event) => setJump(event.target.value)}
                disabled={pending}
              />
              <Button type="submit" variant="outline" size="sm" disabled={pending}>
                Go
              </Button>
            </Field>
          </FieldGroup>
        </form>
      ) : null}
    </nav>
  );
}
