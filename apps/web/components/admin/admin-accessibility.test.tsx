import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminCursorPagination } from "./admin-controls";
import { AdminDataTable, type AdminDataTableColumn } from "./admin-data-table";
import { AdminPageState, AdminLiveRegion, type AdminPageStateKind } from "./admin-page-state";
import { AdminShell, AdminShellBoundary, PageHeader, StatusBadge } from "./admin-shell";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "./shadcn/table";

const { useAdminContext } = vi.hoisted(() => ({ useAdminContext: vi.fn() }));
vi.mock("../../app/admin/admin-overview-provider", () => ({
  useAdminOverview: () => ({ result: null, refresh: vi.fn() }),
}));
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
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

describe("shared Admin accessibility contract", () => {
  it("server-renders the expanded shell with accessible controls", () => {
    useAdminContext.mockReturnValue({ state: { phase: "loading" }, retry: vi.fn() });
    const markup = renderToStaticMarkup(
      createElement(AdminShell, {
        items: [],
        scopeLabel: "Scope: Global",
        environment: "test",
        children: createElement("div", null, "Overview"),
      }),
    );

    expect(markup).toContain('aria-label="Collapse admin navigation"');
    expect(markup).toContain('aria-label="Open admin navigation"');
    expect(markup).toContain('aria-label="Search admin navigation"');
    expect(markup).toContain('aria-label="Open notifications"');
    expect(markup).toContain('src="/brand/freshmarkets-mark.webp"');
    expect(markup).toContain('aria-labelledby="admin-page-title"');
    expect(markup.indexOf("<header")).toBeLessThan(markup.indexOf("<aside"));
  });

  it("renders loading, unauthenticated, forbidden, and error states", () => {
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
    expect(forbidden).toContain("Staff access required");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Request reference: req-1");
  });

  it("renders status, table, and page-header semantics", () => {
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

    expect(markup).toContain('data-variant="outline"');
    expect(markup).not.toContain('role="status"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Order queue"');
    expect(markup).toContain('scope="col"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('id="admin-page-title"');
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
        selectedScope: { kind: "LOCATION", marketId: "market-1", locationId: "location-1" },
      },
      retry: vi.fn(),
      selectScope: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(AdminShellBoundary, { children: null }));

    expect(markup).toContain('aria-label="Active admin scope"');
    expect(markup).toContain("Location One");
    expect(markup.split("</header>")[0]).not.toContain("Open account menu for Operator");
    expect(markup.split("<aside")[1]).toContain("Open account menu for Operator");
    expect(markup.split("<aside")[1]).toContain("operator@example.com");
  });

  it("renders labelled cursor controls", () => {
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
  });

  it("renders distinct shared page states with recoverable semantics", () => {
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

  it("renders a typed data table and live command result", () => {
    type Row = { id: string; name: string; status: string };
    const columns: ReadonlyArray<AdminDataTableColumn<Row>> = [
      { key: "name", header: "Name", render: (row) => row.name },
      { key: "status", header: "Status", render: (row) => row.status },
    ];
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(AdminDataTable<Row>, {
          ariaLabel: "Typed records",
          columns,
          rows: [{ id: "1", name: "Carrots", status: "ACTIVE" }],
          rowKey: (row) => row.id,
        }),
        createElement(AdminLiveRegion, { message: "Order updated" }),
      ),
    );

    expect(markup).toContain('aria-label="Typed records"');
    expect(markup).toContain('data-label="Name"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Order updated");
  });
});
