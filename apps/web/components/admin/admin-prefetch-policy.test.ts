import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canLinkIntentPrefetch, canLinkPrefetch } from "vinext/shims/link-prefetch";

const adminSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const denseLinkSources = [
  "../../app/admin/audit/page.tsx",
  "../../app/admin/catalog/categories/categories-page-client.tsx",
  "../../app/admin/catalog/categories/[category-id]/page.tsx",
  "../../app/admin/catalog/page.tsx",
  "../../app/admin/catalog/products/products-page-client.tsx",
  "../../app/admin/customers/page.tsx",
  "../../app/admin/customers/privacy/page.tsx",
  "../../app/admin/orders/page.tsx",
  "../../app/admin/payments/reconciliation/page.tsx",
  "../../app/admin/payments/transactions/page.tsx",
  "../../app/admin/promotions/page.tsx",
  "../../app/admin/staff/page.tsx",
  "../../app/admin/staff/roles/page.tsx",
];

describe("Admin prefetch policy", () => {
  it("is honored by the installed vinext App Router implementation", () => {
    expect(canLinkPrefetch({ nodeEnv: "production", prefetch: false, isDangerous: false })).toBe(
      false,
    );
    expect(
      canLinkIntentPrefetch({
        nodeEnv: "production",
        prefetch: false,
        isDangerous: false,
        routerMode: "app",
      }),
    ).toBe(false);
  });

  it("disables automatic prefetch at the Admin-to-Marketplace boundary", () => {
    const shell = adminSource("./admin-shell.tsx");
    expect(shell).toMatch(/href="\/"[\s\S]{0,120}prefetch=\{false\}/u);
  });

  it("disables automatic prefetch for Core-authorized shell navigation", () => {
    const shell = adminSource("./admin-shell.tsx");
    expect(shell.match(/<Link/g)).toHaveLength(shell.match(/prefetch=\{false\}/g)?.length ?? 0);
  });

  it("disables automatic prefetch for workspace tabs", () => {
    expect(adminSource("./admin-compositions.tsx")).toContain("prefetch={false}");
  });

  it.each(denseLinkSources)("disables automatic prefetch for dense links in %s", (path) => {
    expect(adminSource(path)).toContain("prefetch={false}");
  });

  it("keeps dense Product rows as ordinary non-prefetching links", () => {
    const products = adminSource("./product-list-view.tsx");
    expect(products).toContain("<a");
    expect(products).toContain("/admin/catalog/products/${product.productId}");
    expect(products).not.toContain('from "next/link"');
  });
});
