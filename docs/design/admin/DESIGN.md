# FreshMarkets Admin Design

## Purpose

The admin is an operational decision system. It should answer “What is happening, what is blocked, and what requires attention?” before it presents CRUD controls. The design optimizes dense scanning, safe bulk work, clear ownership, and auditable transitions.

## Primitive Foundation

Use shadcn/ui for generic primitives: Button, Input, Select, Checkbox, Switch, Dialog, Sheet, DropdownMenu, Popover, Tooltip, Tabs, Breadcrumb, Sidebar, Table, Skeleton, Alert, Badge, Calendar, Command, Form, and Toast/Sonner where installed.

Do not recreate generic primitives. Custom components are justified only when they express a domain composition such as `AdminDataTable`, `OrderStatus`, `PaymentStatus`, `ProcurementRequirement`, `DeliveryCycleSummary`, `InventoryAvailability`, `FulfillmentWorkQueue`, or `ExceptionQueue`.

## Reference Adaptation and Admin Theme

Use [Shadcn UI Kit Dashboard](https://shadcnuikit.com/dashboard/) as the visual and interaction reference for the admin shell, ecommerce/product screens, order screens, payment/transaction screens, analytics, tables, forms, dialogs, filters, empty states, settings, and responsive behavior. Adapt its patterns to FreshMarkets domain commands and read models; do not copy branding, proprietary assets, placeholder data, generic edit/delete actions, or interactions that bypass Core policy.

The reproduction is clean-room: public rendered pages may be inspected for geometry, hierarchy, density, responsive behavior, and interaction vocabulary only. FreshMarkets owns the resulting code, copy, data, icons, and assets. Reference demo values are never copied into Admin and never used as fallback data.

Admin styling is isolated beneath `.fm-admin` and must not alter marketplace/storefront tokens. Admin supports an explicit persisted light/dark appearance toggle in the header, uses a neutral operational canvas with orange as the controlled accent in both modes, and exposes a fixed five-step orange data-visualization palette through admin-scoped design tokens. This is a bounded appearance preference, not a runtime font, radius, or arbitrary theme customizer. Semantic success, warning, danger, information, and status colors retain their meanings and are not replaced with orange.

Product administration uses two deliberately different projections. Global shows catalog identity, Category, media, and Variant definitions only. A selected operational location shows exact local prices, local Variant activation, and shared Product inventory. Global must not show resolved price, pricing context, local readiness, stock, or catalog-reference labels; location views must not show a sourcing-mode selector. The fulfillment-mode control is a Global setting because exactly one business-wide mode governs new commerce.

## Information Architecture

Primary navigation is organized around operational ownership:

- Overview: Overview.
- Commerce: Products (Product List, Add Product, Categories, Add Category), Orders (Order List, Order Issues), Customers (Customer List, Privacy Requests, Memberships), and Promotions. Categories are catalog organization within Products, and Memberships is customer lifecycle administration within Customers; neither is a separate top-level workspace.
- Operations: Inventory, Delivery, and Operational Exceptions. Inventory is the primary stock workspace and presents explicit Add stock and Remove stock actions with dated immutable activity. Procurement, Receiving, and Fulfillment remain distinct Core-owned workflows and purpose-built compatibility routes, but are reached contextually from Orders or exceptions rather than occupying primary navigation.
- Finance: Payments (Overview, Transactions, Reconciliation) and Analytics.
- Administration: Staff & Access (Staff, Roles), Audit Log, and Settings (Fulfillment Mode).

Resource-specific detail and edit screens are contextual destinations, not permanent navigation items. Product, category, order, customer, membership, promotion, payment, staff, role, issue, and audit detail routes open from their owning list and preserve breadcrumbs back to the filtered list. A stable create route may appear as a nested shortcut; a route requiring a resource ID may not.

Navigation items and actions are capability-aware and selected-scope aware. Core supplies both the authorized entries and their supported scope kinds; Web only narrows that set. The Admin selector exposes Global and reachable operational locations; it deliberately hides the internal market hierarchy. Global selection shows global administration and supported aggregate read sides, but not physical Inventory. Location selection (Central Cebu for the current release) shows Overview, Orders, Products, Inventory, Delivery, Analytics, Audit, and location Settings when authorized. Its Products workspace is an operational projection of the global catalog focused on local price, selling status, sourcing, and the shared Product inventory position; it does not transfer Product identity or Category ownership to the location. Customers, Memberships, Promotions, Payments/Pricing, Staff administration, and other global-only surfaces remain hidden. Unauthorized actions remain unavailable in Core regardless of visibility.

## Global Shell

- Desktop defaults to a full-height 64px layout rail backed by a 66px fixed sidebar shell and expands to 256px. The collapsed shell uses asymmetric `12px 4px` horizontal padding so its 32px controls remain on the same icon axis as the expanded shell's `8px` container and group padding. The browser remembers that preference. Rail width and section-label visibility transition together over 200ms with linear easing; navigation control width, height, and padding settle over 150ms so icons remain visually anchored while text clips and fades. The content surface is inset by 8px only beside the collapsed rail and has a rounded outer frame with restrained shadow. At the `md` breakpoint and below the rail becomes a Sheet/drawer; the admin shell has no truncated bottom navigation.
- Section labels and nested links follow the Information Architecture above. An expandable parent's entire icon-and-title row toggles its nested destinations; it does not split navigation and disclosure across separate click targets. The most-specific matching route is active, and the active child's parent opens automatically. In the collapsed rail, every destination exposes an accessible right-side tooltip; an expandable parent additionally opens its children in a click-activated right-side menu rather than a hover flyout.
- The full-height rail begins with the compact FreshMarkets mark; the lowercase `freshmarkets` wordmark appears beside it only while the desktop rail is expanded. The rail also owns the navigation search affordance. A 56px header is inset with the content surface and begins with the rail toggle and compact current-scope switcher. The toggle uses the matching panel-open/panel-close icon for the rail state; the scope switcher uses a small accent marker, selected scope label, and visible up/down switcher indicator. Environment, marketplace, cycle context where relevant, notifications/exceptions indicator, light/dark appearance toggle, and staff identity remain utility controls rather than business authority. The appearance toggle sits between notifications and staff identity. Mobile keeps the compact mark and wordmark in the header because the rail becomes a drawer.
- Scope selection is explicit and never silently changes a command's target.
- Use URL-addressable filters/tabs for operational queues.
- Show an environment/status indicator for non-production contexts.

The main canvas uses a broad neutral background, 24px desktop page gutters, thin neutral borders, restrained shadows, and compact card headers. Card grids follow the reference geometry but their contents remain operational: no congratulatory, revenue, review, visit-source, or other demo modules appear unless an approved authoritative read model supports the exact decision.

## Overview

The overview is a prioritized operational briefing, not four generic statistic cards. It combines:

- current-cycle order and GMV/AOV context;
- failed payments and unresolved payment webhooks;
- procurement requirements, shortages, and receiving discrepancies;
- fulfillment workload and aging;
- delivery workload, capacity, and failed deliveries;
- subscription billing failures;
- attention/exceptions queue;
- recent material operations.

Visual choices follow the question: KPI trend, queue count, capacity bar, aging table, timeline, or exception list. Every summary links to the filtered workspace that can resolve it.

The overview consumes one purpose-built, scope-aware Admin overview read model. A section the caller cannot read is represented as denied rather than zero. A supported section whose authority is not implemented is explicitly unavailable. Generated time and source freshness are visible so operators can distinguish current truth from stale or partial data.

## Pricing And Fees

`/admin/commerce-configuration` is a global-scope workspace with separate Membership Price and Instant Service Fee tabs. Each tab independently enforces its existing read/manage capabilities, shows current and next effective configuration, explains customer impact and invariants, and submits only an effective-dated replacement with reason, confirmation, idempotency, and expected version. It never exposes generic history editing or rewrites existing Subscription, Quote, or Order snapshots.

## Page Archetypes

### Required screen inventory

- Catalog: Product List, Add Product, Product Detail, Edit Product, Category List, Add Category, Category Detail, and Edit Category. Product workspaces cover identity, categorization, customer-facing details, primary/ordered media, persisted SKU variants, exact base-unit consumption, prices, location availability/sourcing, status, and audit history. Category workspaces cover parent hierarchy, name/slug/code, icon, sort order, status, contained products, and audit history.
- Orders: Order List, Order Detail, and Order Issues. Detail composes items, immutable financial snapshots, Payments, fulfillment, delivery, amendments, timeline, exceptions, allowed actions, and audit history.
- Customers, Memberships, and Promotions: list/detail workspaces plus Customer Privacy Requests and the approved explicit commands for each domain.
- Payments: Payment Overview, Transactions, Payment Detail, and Reconciliation. Refund and retry/reconcile actions are contextual commands from detail or exception states, not generic row edits.
- Operations and administration: Inventory stock levels/activity, Delivery, Operational Exceptions, Analytics, Staff, Roles, Audit, and Fulfillment Mode settings. Procurement, Receiving, and Fulfillment screens remain available as contextual advanced workflows while the default operator path stays focused on stock in/out.

Products and categories referenced by committed or historical records are deactivated rather than hard-deleted. Archival is used only where the owning aggregate explicitly defines an archive transition. Admin does not provide a Create Order workflow: Orders originate from the authoritative checkout/payment commitment flow.

### Operational list/queue

- Title, scope, cycle/date context, primary action.
- Filter row with search, status, date/cycle, location/zone, and saved-view-ready URL state.
- Product list table controls use a compact Filters popover on the left and a Columns visibility popover on the right. When safe bulk selection is active, that same toolbar becomes the selection count plus Deactivate and Cancel controls instead of adding a second competing action row.
- Result count and pagination.
- Dense table with stable columns, row status, age/deadline, owner, and next action.
- Bulk actions only where domain semantics define safe bulk commands.
- Empty state explains whether no records exist, filters are too narrow, or the capability/scope has no data.

### Detail workspace

- Header identifies resource, status, human-readable number, and scope.
- Primary next action is prominent and legal; destructive/irreversible actions are separated and confirmed.
- Summary strip for deadline/cycle/location/financial context.
- Tabs or sections for items, timeline, exceptions, payments, fulfillment/delivery, and audit.
- Related entities are linked through purpose-built read models.
- State transition errors explain the blocking condition and recovery path.

### Configuration form

- Use shadcn form primitives with explicit labels, helper text, validation, and unsaved-change handling.
- Group fields by business concept, not table columns.
- Show effective dates, scope, and impact preview for prices, cycles, fees, promotions, and permissions.
- Require reason fields for material operational adjustments.

### Exception queue

- Severity, age, resource, location, owner, reason, and next action are visible without opening every item.
- Triage supports assign, acknowledge, resolve, escalate, and filter; each is a domain command.
- Resolution options are contextual: shortage, refund, retry, reschedule, alternate source, or escalation.

## Density and Visual Hierarchy

- Prefer compact but breathable tables: 12–14px supporting text, clear row height, strong status and deadline contrast.
- Use one primary action per screen/header and secondary actions in menus.
- Reserve color for status/severity and ensure labels/icons remain understandable without color.
- Keep financial totals visually distinct from operational quantities.
- Use sticky table headers and detail-page action bars for long workflows.
- Avoid dashboard decoration that does not change a decision.

## Tables and Filtering

- Tables are for comparison and repeated action, not data-dump completeness.
- Columns should answer the operator's decision; move secondary fields into row expansion/detail.
- Use server-side query/read models and keyset pagination for large lists.
- Filters include clear-all, visible active filter tokens, URL persistence, and safe defaults (current cycle/current scope).
- Table row links are keyboard accessible; action menus must not trap focus.
- Bulk operations display a preflight count and result summary, with partial failures explicit.
- Initial list data travels with the vinext Server Component response through a typed Core Service
  Binding read and crosses the client boundary as a plain DTO. Do not serialize navigation as
  `RSC route -> mounted client -> same-origin list API`; browser list APIs remain for subsequent
  cursor pages, scope changes, refreshes, and commands. Any browser-stored scope/pricing value is a
  non-authoritative hint that Core validates again.

## States

Every workspace designs:

- loading skeleton matching final layout;
- empty/no-data state;
- filtered-empty state;
- permission/scope-empty state;
- error with correlation/request reference;
- stale/conflict state with refresh/retry;
- pending asynchronous state;
- terminal success/failure state;
- cutoff/capacity/availability warnings;
- destructive-action confirmation with consequence and reason.

## Responsive Behavior

- Desktop supports dense multi-column operational work.
- Tablet collapses secondary columns and keeps filters/actions accessible.
- Mobile prioritizes queue scanning, detail, and single-resource commands; large tables become stacked rows/cards or horizontal scroll with preserved headers.
- Rider UI is optimized for mobile touch targets, offline-tolerant pending states, and one next task at a time; it is not a miniature admin table.

## Accessibility and Safety

- Keyboard navigation and visible focus for all controls.
- Semantic table headers, labels, error associations, and live updates for status changes.
- Do not rely on color alone for state/severity.
- Confirm irreversible cancellation/refund/inventory actions and display the exact scope/amount/quantity.
- Core rejects unauthorized or illegal actions even if a user manipulates the UI.

## Domain Workspace Purposes

- Orders: protect commitment truth and operational resolution.
- Catalog: manage global product identity and location availability/prices.
- Inventory: inspect location balances and record simple stock additions/removals with server-dated immutable activity.
- Procurement and Receiving: preserve committed-demand and receiving correctness behind contextual advanced workflows; do not make them the default stock-entry vocabulary.
- Fulfillment: preserve paid-order picking/packing transitions behind Orders and exception handling; do not represent fulfillment as a generic inventory edit.
- Delivery: manage capacity, batches, riders, stops, and failed delivery.
- Customers: support identity-linked customer context without editing auth records.
- Subscriptions: manage membership state and billing failures, not grocery orders.
- Payments: reconcile provider truth, attempts, refunds, and exceptions.
- Staff/Roles: manage capabilities and location scope.
- Audit: inspect immutable material operations.

## Phase-0 Proposal

The detailed admin IA, shell, table/filter standards, component inventory, responsive behavior, and approval gates live in `ADMIN_DESIGN.md`.
