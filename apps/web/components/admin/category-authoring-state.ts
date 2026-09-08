"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z, adminCategoryPageSchema, adminCategoryDetailSchema } from "@freshmarkets/validation";
import type { AdminCategorySummary } from "@freshmarkets/contracts";
import { catalogErrorSchema } from "./catalog-command-state";
export const categoryDetailResultSchema = z.union([
  z.object({ ok: z.literal(true), value: adminCategoryDetailSchema, requestId: z.string() }),
  catalogErrorSchema,
]);
const pageSchema = z.union([
  z.object({ ok: z.literal(true), value: adminCategoryPageSchema }),
  catalogErrorSchema,
]);
export function useCategoryOptions(excludedId?: string) {
  const [items, setItems] = useState<AdminCategorySummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const load = useCallback(
    async (next?: string) => {
      if (active.current) return;
      const current = ++generation.current;
      active.current = true;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/admin/catalog/categories?limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
        );
        const result = pageSchema.parse(await response.json());
        if (current !== generation.current) return;
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setItems((previous) =>
          (next ? [...previous, ...result.value.items] : result.value.items).filter(
            (item, index, all) =>
              item.categoryId !== excludedId &&
              all.findIndex((other) => other.categoryId === item.categoryId) === index,
          ),
        );
        setCursor(result.value.nextCursor);
      } catch {
        if (current === generation.current)
          setError("Categories could not be loaded. Retry to review available categories.");
      } finally {
        if (current === generation.current) {
          active.current = false;
          setLoading(false);
        }
      }
    },
    [excludedId],
  );
  useEffect(() => {
    active.current = false;
    setItems([]);
    setCursor(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  return {
    items,
    loading,
    error,
    hasMore: cursor !== null,
    loadMore: () => load(cursor ?? undefined),
  };
}
