"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  AdminCategoryPage,
  AdminProductPage,
  AdminUnitSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { PageHeader, ListPageSection, StatusBadge } from "../../../components/admin/admin-shell";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

export default function CatalogPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [products, setProducts] = useState<AdminProductPage | null>(null);
  const [categories, setCategories] = useState<AdminCategoryPage | null>(null);
  const [units, setUnits] = useState<AdminUnitSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [newCategory, setNewCategory] = useState({ code: "", name: "", slug: "" });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((search: string) => {
    setState({ phase: "loading" });
    void (async () => {
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search.trim() !== "") params.set("query", search.trim());
        const [productsResponse, categoriesResponse, unitsResponse] = await Promise.all([
          fetch(`/api/admin/catalog/products?${params}`),
          fetch("/api/admin/catalog/categories"),
          fetch("/api/admin/catalog/units"),
        ]);
        const productsPayload = (await productsResponse.json()) as RpcResult<AdminProductPage>;
        if (!productsPayload.ok) {
          setState({
            phase: "error",
            message:
              productsPayload.error.code === "FORBIDDEN"
                ? "Catalog administration requires the catalog.read capability with a global scope."
                : productsPayload.error.message,
            requestId: productsPayload.error.requestId,
          });
          return;
        }
        const categoriesPayload = (await categoriesResponse.json()) as RpcResult<AdminCategoryPage>;
        const unitsPayload = (await unitsResponse.json()) as RpcResult<AdminUnitSummary[]>;
        setProducts(productsPayload.value);
        setCategories(categoriesPayload.ok ? categoriesPayload.value : null);
        setUnits(unitsPayload.ok ? unitsPayload.value : null);
        setState({ phase: "ready" });
      } catch {
        setState({
          phase: "error",
          message: "Network error loading the catalog.",
          requestId: null,
        });
      }
    })();
  }, []);

  useEffect(() => load(""), [load]);

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    if (
      newCategory.code.trim() === "" ||
      newCategory.name.trim() === "" ||
      newCategory.slug.trim() === ""
    ) {
      setNotice("Code, name, and slug are required.");
      return;
    }
    const response = await fetch("/api/admin/catalog/categories", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        code: newCategory.code.trim().toUpperCase(),
        name: newCategory.name.trim(),
        slug: newCategory.slug.trim(),
      }),
    });
    const payload = (await response.json()) as RpcResult<unknown> & {
      error?: { message?: string };
    };
    setNotice(payload.ok ? "Category created." : (payload.error?.message ?? "Creation failed."));
    if (payload.ok) {
      setNewCategory({ code: "", name: "", slug: "" });
      load(query);
    }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Catalog"
        description="Global products, categories, units, and SKU definitions. Prices are versioned; availability is location-specific."
      />

      {state.phase === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Loading catalog">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}

      {state.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>The catalog could not be loaded</AlertTitle>
          <AlertDescription>
            {state.message}
            {state.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {state.requestId}</span>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {state.phase === "ready" ? (
        <>
          {notice ? (
            <p
              role="status"
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-3 text-sm"
            >
              {notice}
            </p>
          ) : null}

          <ListPageSection title="Create a category">
            <form
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
              onSubmit={createCategory}
            >
              <Input
                aria-label="Category code"
                placeholder="CODE"
                value={newCategory.code}
                onChange={(event) => setNewCategory({ ...newCategory, code: event.target.value })}
                className="sm:w-44"
              />
              <Input
                aria-label="Category name"
                placeholder="name"
                value={newCategory.name}
                onChange={(event) => setNewCategory({ ...newCategory, name: event.target.value })}
                className="sm:w-56"
              />
              <Input
                aria-label="Category slug"
                placeholder="kebab-slug"
                value={newCategory.slug}
                onChange={(event) => setNewCategory({ ...newCategory, slug: event.target.value })}
                className="sm:w-56"
              />
              <Button type="submit" size="sm">
                Create
              </Button>
            </form>
            {categories && categories.items.length > 0 ? (
              <p className="px-4 pb-3 text-xs text-[var(--fm-text-muted)]">
                {categories.items.length} categories:{" "}
                {categories.items.map((category) => category.code).join(", ")}
              </p>
            ) : null}
          </ListPageSection>

          <ListPageSection title="Controlled units" description="The closed sell-unit registry.">
            {units === null || units.length === 0 ? (
              <p className="p-5 text-sm text-[var(--fm-text-muted)]">No units defined.</p>
            ) : (
              <p className="p-4 text-xs text-[var(--fm-text-muted)]">
                {units.map((unit) => `${unit.code} (${unit.dimension})`).join(" · ")}
              </p>
            )}
          </ListPageSection>

          <ListPageSection title="Products">
            <form
              className="flex gap-2 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                load(query);
              }}
            >
              <Input
                aria-label="Search products"
                placeholder="search by name or slug"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="sm:w-72"
              />
              <Button type="submit" size="sm" variant="outline">
                Search
              </Button>
            </form>
            {products === null || products.items.length === 0 ? (
              <p className="p-5 pt-0 text-sm text-[var(--fm-text-muted)]" role="status">
                {query !== "" ? "No products match the search." : "No products defined."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>SKUs</TableHead>
                    <TableHead>
                      <span className="sr-only">Detail link</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.items.map((product) => (
                    <TableRow key={product.productId}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell className="text-xs">{product.categoryCode}</TableCell>
                      <TableCell>
                        <StatusBadge tone={product.status === "active" ? "success" : "neutral"}>
                          {product.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-xs">{product.skuCount}</TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/catalog/products/${product.productId}`}
                          className="text-xs font-medium text-[var(--fm-info)] underline"
                        >
                          Manage
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
