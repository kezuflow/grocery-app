import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AdminShellBoundary, PageHeader, StatusBadge } from "./admin-shell";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../ui/table";
import { AdminConfirmationDialog, AdminCursorPagination } from "./admin-controls";
import { AdminDataTable, type AdminDataTableColumn } from "./admin-data-table";
import { AdminPageState, AdminLiveRegion } from "./admin-page-state";
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
const sheet = readFileSync(new URL("../ui/sheet.tsx", import.meta.url), "utf8");
const table = readFileSync(new URL("../ui/table.tsx", import.meta.url), "utf8");

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
        selectedScope: null,
      },
      retry: vi.fn(),
      selectScope: vi.fn(),
    });
    const markup = renderToStaticMarkup(createElement(AdminShellBoundary, { children: null }));
    expect(markup).toContain('aria-label="Active admin scope"');
    expect(markup).toContain("Select scope");
    expect(markup).toContain("Location One");
    expect(markup).toContain("Location Two");
  });

  it("renders labelled cursor controls and requires a reason for destructive confirmation", () => {
    const pagination = renderToStaticMarkup(
      createElement(AdminCursorPagination, {
        pageNumber: 2,
        nextCursor: "next-page",
        onPrevious: vi.fn(),
        onNext: vi.fn(),
      }),
    );
    const confirmation = renderToStaticMarkup(
      createElement(AdminConfirmationDialog, {
        open: true,
        title: "Confirm inventory adjustment",
        resource: "Tomatoes · -10 GRAM",
        scope: "Cebu Central",
        consequence: "This writes an immutable inventory ledger movement.",
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );
    expect(pagination).toContain('aria-label="Results pagination"');
    expect(pagination).toContain("Page 2");
    expect(confirmation).toContain('role="alertdialog"');
    expect(confirmation).toContain('aria-label="Confirmation reason"');
    expect(confirmation).toContain("disabled");
    expect(confirmation).toContain("Tomatoes · -10 GRAM");
    expect(confirmation).toContain("Cebu Central");
  });

  it("renders all distinct shared page states with recoverable semantics", () => {
    const variants = ["loading", "empty", "filtered-empty", "permission-empty", "error"] as const;
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
});
