import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AdminShell, AdminShellBoundary, PageHeader, StatusBadge } from "./admin-shell";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../ui/table";
import { AdminCursorPagination } from "./admin-controls";
import { AdminDataTable, type AdminDataTableColumn } from "./admin-data-table";
import { AdminPageState, AdminLiveRegion, type AdminPageStateKind } from "./admin-page-state";
import { AdminBreadcrumbs } from "./admin-breadcrumbs";

const { useAdminContext } = vi.hoisted(() => ({ useAdminContext: vi.fn() }));
vi.mock("../../app/admin/admin-context-provider", () => ({
  useAdminContext,
  adminSelectableScopes: (
    _context: unknown,
    options: ReadonlyArray<{ kind: string; marketId: string; locationId?: string }>,
  ) =>
    options.map((option) =>
      option.kind === "location"
        ? { kind: "LOCATION", marketId: option.marketId, locationId: option.locationId }
        : { kind: "MARKET", marketId: option.marketId },
    ),
}));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

const shell = readFileSync(new URL("./admin-shell.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../ui/sheet.tsx", import.meta.url), "utf8");
const table = readFileSync(new URL("../ui/table.tsx", import.meta.url), "utf8");
const alertDialog = readFileSync(new URL("../ui/alert-dialog.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("./admin-controls.tsx", import.meta.url), "utf8");
const productDetail = readFileSync(
  new URL("../../app/admin/catalog/products/[product-id]/page.tsx", import.meta.url),
  "utf8",
);
const inventoryPage = readFileSync(
  new URL("../../app/admin/inventory/page.tsx", import.meta.url),
  "utf8",
);
const auditPage = readFileSync(new URL("../../app/admin/audit/page.tsx", import.meta.url), "utf8");
const newProductPage = readFileSync(
  new URL("../../app/admin/catalog/products/new/page.tsx", import.meta.url),
  "utf8",
);
const newCategoryPage = readFileSync(
  new URL("../../app/admin/catalog/categories/new/page.tsx", import.meta.url),
  "utf8",
);
const issuesPage = readFileSync(
  new URL("../../app/admin/issues/page.tsx", import.meta.url),
  "utf8",
);
const privacyPage = readFileSync(
  new URL("../../app/admin/customers/privacy/page.tsx", import.meta.url),
  "utf8",
);
const locationOnlyPages = [
  "../../app/admin/procurement/page.tsx",
  "../../app/admin/receiving/page.tsx",
  "../../app/admin/fulfillment/page.tsx",
  "../../app/admin/issues/operational-exceptions/page.tsx",
  "../../app/admin/settings/fulfillment-mode/page.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
const dynamicAdminPages = [
  "../../app/admin/promotions/[promotion-id]/page.tsx",
  "../../app/admin/customers/[customer-id]/page.tsx",
  "../../app/admin/staff/[staff-id]/page.tsx",
  "../../app/admin/staff/roles/[role-id]/page.tsx",
  "../../app/admin/audit/audit-detail-view.tsx",
  "../../app/admin/catalog/products/[product-id]/page.tsx",
  "../../app/admin/catalog/products/[product-id]/edit/page.tsx",
  "../../app/admin/catalog/categories/[category-id]/page.tsx",
  "../../app/admin/catalog/categories/[category-id]/edit/page.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

describe("shared Admin accessibility contract", () => {
  it("exposes labelled main content, active navigation, and a focusable mobile menu", () => {
    expect(shell).toMatch(/<main[^>]+aria-labelledby=/);
    expect(shell).toMatch(/aria-current=/);
    expect(shell).toMatch(/focus-visible:ring-2/);
    expect(shell).toMatch(/onCloseAutoFocus/);
    expect(shell).not.toMatch(/Mobile admin navigation/);
    expect(shell).toMatch(/fm-admin-sidebar-collapsed/);
  });

  it("keeps the Admin visual scope on the Admin layout boundary", () => {
    const layout = readFileSync(new URL("../../app/admin/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/className="fm-admin/);
    expect(layout).toContain('import "@fontsource-variable/dm-sans/wght.css"');
    expect(globals).toMatch(
      /\.fm-admin \{[\s\S]*font-family: "DM Sans Variable", "DM Sans", ui-sans-serif, system-ui, sans-serif;/,
    );
    expect(shell).toContain('className="text-2xl font-bold tracking-[-0.025em]"');
  });

  it("server-renders a first-time desktop visit with the 72px icon rail", () => {
    useAdminContext.mockReturnValue({ state: { phase: "loading" }, retry: vi.fn() });
    const markup = renderToStaticMarkup(
      createElement(AdminShell, {
        items: [],
        scopeLabel: "Scope: Global",
        environment: "test",
        children: createElement("div", null, "Overview"),
      }),
    );

    expect(markup).toContain("w-[var(--fm-admin-sidebar-collapsed)]");
    expect(markup).toContain('aria-label="Expand admin navigation"');
    expect(shell).toContain('aria-label="freshmarkets admin home"');
    expect(markup).toContain("lucide-sprout");
    expect(markup).not.toContain(">freshmarkets</span>");
    expect(shell).not.toContain("overflow-y-auto");
    expect(shell).toContain("h-9 items-center justify-center");
    expect(shell).toContain("text-sm font-normal hover:bg-[var(--fm-hover)]");
    expect(shell).toContain('activeCode === child.code && "font-medium');
    expect(shell).toContain('className="hidden size-8 rounded-lg lg:inline-flex"');
    expect(shell).toContain("PanelLeftOpen");
    expect(shell).toContain("PanelLeftClose");
    expect(shell).toContain("ChevronsUpDown");
    expect(shell).toContain(
      'className="border-[var(--fm-border)] bg-white text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)]"',
    );
    expect(shell.slice(shell.indexOf("function AdminHeader"))).toContain(
      'aria-label={collapsed ? "Expand admin navigation" : "Collapse admin navigation"}',
    );
    const headerSource = shell.slice(
      shell.indexOf("function AdminHeader"),
      shell.indexOf("function AdminScopeSelector"),
    );
    const sidebarSource = shell.slice(shell.indexOf("function AdminSidebar"));
    expect(headerSource).toContain('aria-label="freshmarkets admin home"');
    expect(headerSource).toContain("<Sprout");
    expect(sidebarSource).not.toContain('aria-label="freshmarkets admin home"');
    expect(sidebarSource).not.toContain(
      'aria-label={collapsed ? "Expand admin navigation" : "Collapse admin navigation"}',
    );
    expect(headerSource).toMatch(/<span[^>]*>\s*freshmarkets\s*<\/span>/);
  });

  it("gives shell states headings and status semantics", () => {
    expect(shell).toMatch(/<h1[^>]*>[\s\S]*Sign in required/);
    expect(shell).toMatch(/<h1[^>]*>[\s\S]*Staff access required/);
    expect(shell).toMatch(/role="status"/);
    expect(shell).toMatch(/aria-live="polite"/);
  });

  it("renders production loading, unauthenticated, forbidden, and error states", () => {
    useAdminContext.mockReturnValue({ state: { phase: "loading" }, retry: vi.fn() });
    const loading = renderToStaticMarkup(createElement(AdminShellBoundary, { children: null }));
    useAdminContext.mockReturnValue({ state: { phase: "unauthenticated" }, retry: vi.fn() });
    const unauthenticated = renderToStaticMarkup(
      createElement(AdminShellBoundary, { children: null }),
    );
    useAdminContext.mockReturnValue({ state: { phase: "forbidden" }, retry: vi.fn() });
    const forbidden = renderToStaticMarkup(createElement(AdminShellBoundary, { children: null }));
    useAdminContext.mockReturnValue({
      state: { phase: "error", message: "Core unavailable", requestId: "req-1" },
      retry: vi.fn(),
    });
    const error = renderToStaticMarkup(createElement(AdminShellBoundary, { children: null }));
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Loading admin shell");
    expect(unauthenticated).toContain('id="admin-page-title"');
    expect(unauthenticated).toContain("Sign in required");
    expect(shell).toContain('href="/auth/login?redirectTo=/admin"');
    expect(forbidden).toContain("Staff access required");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Request reference: req-1");
  });

  it("keeps shared table content keyboard discoverable and headers scoped", () => {
    expect(table).toMatch(/tabIndex=\{0\}/);
    expect(table).toMatch(/aria-label=/);
    expect(table).toMatch(/scope="col"/);
  });

  it("renders production status, table, and page-header output", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(StatusBadge, { tone: "warning", children: "SHORTAGE" }),
        createElement(
          Table,
          { "aria-label": "Order queue" },
          createElement(
            TableHeader,
            null,
            createElement(TableRow, null, createElement(TableHead, null, "Status")),
          ),
          createElement(TableBody, null),
        ),
        createElement(PageHeader, { title: "Orders", description: "Committed orders." }),
      ),
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Order queue"');
    expect(markup).toContain('scope="col"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('id="admin-page-title"');
    expect(markup).not.toContain("FreshMarkets Admin");
  });

  it("keeps permanent route context singular and hides unavailable queue actions", () => {
    expect(auditPage).not.toContain("<Breadcrumb>");
    expect(newProductPage).not.toContain("<nav");
    expect(newCategoryPage).not.toContain("<nav");
    for (const page of dynamicAdminPages) {
      expect(page).not.toContain("<Breadcrumb>");
      expect(page).not.toContain("<nav");
    }
    expect(issuesPage).toContain("page.items.length > 0");
    expect(privacyPage).toContain("state.page.items.length > 0");
    for (const page of locationOnlyPages) {
      expect(page).toContain('state="permission-empty"');
      expect(page).toContain("Select a permitted location");
    }
  });

  it("names the mobile dialog close action", () => {
    expect(sheet).toMatch(/aria-label="Close admin navigation"/);
  });

  it("renders an explicit selector when multiple Admin scopes are assigned", () => {
    useAdminContext.mockReturnValue({
      state: {
        phase: "ready",
        context: {
          staffId: "staff-1",
          displayName: "Operator",
          email: "operator@example.com",
          capabilities: ["analytics.read"],
          scopes: [
            { kind: "location", locationId: "location-1" },
            { kind: "location", locationId: "location-2" },
          ],
          navigation: [],
          environment: "test",
        },
        scopes: [
          {
            kind: "location",
            marketId: "market-1",
            marketCode: "M1",
            locationId: "location-1",
            locationCode: "L1",
            locationName: "Location One",
            currency: "PHP",
            timezone: "Asia/Manila",
          },
          {
            kind: "location",
            marketId: "market-1",
            marketCode: "M1",
            locationId: "location-2",
            locationCode: "L2",
            locationName: "Location Two",
            currency: "PHP",
            timezone: "Asia/Manila",
          },
        ],
        selectedScope: {
          kind: "LOCATION",
          marketId: "market-1",
          locationId: "location-1",
        },
      },
      retry: vi.fn(),
      selectScope: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(AdminShellBoundary, { children: null }));
    expect(markup).toContain('aria-label="Active admin scope"');
    expect(markup).toContain("Location One");
    expect(shell).toContain("<SelectItem");
  });

  it("renders labelled cursor controls and uses a focus-managed reason confirmation", () => {
    const pagination = renderToStaticMarkup(
      createElement(AdminCursorPagination, {
        pageNumber: 2,
        nextCursor: "next-page",
        onPrevious: vi.fn(),
        onNext: vi.fn(),
      }),
    );
    expect(pagination).toContain('aria-label="Results pagination"');
    expect(pagination).toContain("Page 2");
    expect(alertDialog).toContain("@radix-ui/react-dialog");
    expect(alertDialog).toContain("AlertDialogPrimitive.Content");
    expect(controls).toContain('role="alertdialog"');
    expect(controls).toContain('aria-label="Confirmation reason"');
    expect(controls).toContain("reasonRequired && reason.trim()");
  });

  it("renders all distinct shared page states with recoverable semantics", () => {
    const variants = [
      "loading",
      "empty",
      "filtered-empty",
      "permission-empty",
      "unavailable",
      "pending",
      "conflict",
      "success",
      "error",
    ] as ReadonlyArray<AdminPageStateKind>;
    const markup = variants
      .map((state) =>
        renderToStaticMarkup(
          createElement(AdminPageState, {
            state,
            title: `${state} title`,
            message: `${state} message`,
            requestId: state === "error" ? "request-1" : undefined,
            onRetry: state === "error" ? vi.fn() : undefined,
          }),
        ),
      )
      .join("");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("No data is available yet");
    expect(markup).toContain("No results match the active filters");
    expect(markup).toContain("The selected scope or your permissions do not expose data");
    expect(markup).toContain("Authoritative data for this section is not available");
    expect(markup).toContain("The command is still pending authoritative confirmation");
    expect(markup).toContain("The record changed since this page was loaded");
    expect(markup).toContain("The authoritative command completed successfully");
    expect(markup).toContain("Request reference: request-1");
    expect(markup).toContain("Retry");
  });

  it("renders a responsive typed data table, breadcrumbs, and live command result", () => {
    type Row = { id: string; name: string; status: string };
    const columns: ReadonlyArray<AdminDataTableColumn<Row>> = [
      { key: "name", header: "Name", render: (row) => row.name },
      { key: "status", header: "Status", render: (row) => row.status },
    ];
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(AdminBreadcrumbs, {
          items: [{ label: "Admin", href: "/admin" }, { label: "Orders" }],
        }),
        createElement(AdminDataTable<Row>, {
          ariaLabel: "Typed records",
          columns,
          rows: [{ id: "1", name: "Carrots", status: "ACTIVE" }],
          rowKey: (row) => row.id,
        }),
        createElement(AdminLiveRegion, { message: "Order updated" }),
      ),
    );
    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Typed records"');
    expect(markup).toContain('data-label="Name"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Order updated");
  });

  it("rejects stale scoped responses and renders target currencies dynamically", () => {
    expect(productDetail).toContain("loadRequest.current !== requestNumber");
    expect(productDetail).toContain("currency: sku.currency");
    expect(productDetail).not.toContain("`₱${(sku.priceMinor");
    expect(inventoryPage).toContain("loadRequest.current !== requestNumber");
    expect(inventoryPage).toContain("ledgerRequest.current === requestNumber");
    expect(inventoryPage).toContain('phase: "error"');
    expect(inventoryPage).toContain("ledgerState.key === ledgerKey");
    expect(inventoryPage).toContain("Network error loading the inventory ledger.");
    expect(inventoryPage).toContain("useAdminPagination(locationId)");
  });
});
