# FreshMarkets Admin Design

## Status And Scope

This is the phase-0 admin proposal. It defines an operational dashboard language and component boundary for later implementation. It does not create admin contracts, alter authorization, or turn inline Worker behavior into a new API.

The admin shares FreshMarkets tokens with the storefront but intentionally uses shadcn dashboard patterns more directly: dense, keyboard-accessible workspaces for queues, decisions, exceptions, and auditable commands.

## Information Architecture

Capability-aware primary navigation:

1. Overview
2. Orders
3. Catalog
4. Inventory
5. Procurement
6. Fulfillment
7. Delivery
8. Customers
9. Subscriptions
10. Payments
11. Promotions (current release subset/later)
12. Staff / Roles
13. Audit Log
14. Settings

Navigation visibility and action availability are derived from Core capabilities and market/location scopes. A visible workspace may still show a scoped empty state; the browser never becomes an authorization authority.

## Dashboard Shell

Desktop uses shadcn `Sidebar` with a collapsible mobile `Sheet`. The header contains breadcrumbs, explicit market/location scope, current delivery-cycle context, command/search affordance, exception/notification indicator, and user menu. Filters and tabs are URL-addressable. Scope changes are explicit and never silently retarget a command.

The Overview is an operational briefing, not a collection of decorative KPI cards. It prioritizes current-cycle order/GMV/AOV context, failed payments, procurement shortages and receiving discrepancies, fulfillment aging, delivery workload/capacity, subscription billing failures, and an exception queue. Each summary links to the resolving workspace.

## Page Archetypes

### Queue/list

Page header -> scope/cycle context -> filter bar -> result count/pagination -> dense decision-oriented table -> safe bulk actions. Columns show identity, status, age/deadline, location/zone, owner, and next action. Secondary fields belong in detail or row expansion.

### Detail workspace

Resource/status header -> primary legal next action -> summary strip (cycle, location, deadline, financial context) -> tabs for items, timeline, exceptions, payment, fulfillment/delivery, and audit. Destructive or irreversible commands are separated and confirmed.

### Configuration form

Group fields by business concept. Show scope, effective dates, validation, unsaved-change behavior, impact preview, and required reasons for material adjustments. Core revalidates every command.

### Exception queue

Severity, age, resource, scope, owner, reason, affected quantity/amount, deadline, and legal resolution choices are visible without opening every row. Resolution uses explicit commands such as retry, refund, reschedule, alternate source, acknowledge, assign, or escalate.

## Table And Filter Standards

Use shadcn `Table` plus a typed `AdminDataTable` composition. Tables consume purpose-built read-model DTOs, support server-side cursor pagination and stable sorting, and preserve row identity when they collapse on mobile. Filter bars provide debounced search, status/date/cycle/location filters, active tokens, clear-all, safe defaults (current scope/current cycle), and URL persistence. Bulk actions show a preflight count, idempotent submission state, and partial-failure results.

Use 12-14px supporting text, compact but breathable rows, sticky headers, strong status/deadline contrast, and no decorative cards around every section. A metric card is allowed only when it changes an operational decision.

## Forms, Dialogs, And Commands

Compose shadcn `Form`, `Dialog`, `AlertDialog`, `Popover`, `Command`, `Calendar`, `Select`, `Checkbox`, `Switch`, `Badge`, `Alert`, `Skeleton`, and toast primitives. Custom compositions include `AdminShell`, `PageHeader`, `FilterBar`, `AdminDataTable`, `StatusBadge`, `Timeline`, `ExceptionQueue`, `ConfirmCommandDialog`, `ScopeSelector`, `DetailSection`, and `DetailField`.

Every mutation carries the contract's expected version and idempotency key where required. Disable duplicate submit, show pending/recovery states, and render the Core command result. Never locally set status or infer a legal transition from an arbitrary string.

## Status, Safety, And Accessibility

Domain-specific status components map stable enums to label, semantic tone/icon, accessible description, terminal/pending/blocked/exceptional state, and optional next action. Color is never the only signal. Confirm cancellation, refund, inventory adjustment, receiving discrepancy, and other irreversible actions with exact target, amount/quantity, consequence, and reason.

Each workspace defines loading skeleton, no-data, filtered-empty, permission/scope-empty, error with request reference, stale/conflict, pending asynchronous, terminal success/failure, cutoff/capacity/availability warning, and destructive-confirmation states. Use semantic table headers, labels/error associations, focus management, keyboard menus, live status announcements, and visible focus states.

## Responsive Behavior

Desktop supports dense multi-column operational work. Tablet hides secondary columns while preserving filters/actions. Mobile prioritizes queue scanning, resource detail, and one command at a time; large tables become stacked rows or horizontally scrollable tables with preserved headers. Rider UI remains a later, touch-first task surface and is not a miniature admin table.

## Component Inventory

Shared: `AdminShell`, `AdminSidebar`, `AdminHeader`, `PageHeader`, `ScopeSelector`, `CycleContext`, `FilterBar`, `AdminDataTable`, `StatusBadge`, `MetricCard`, `Timeline`, `ExceptionQueue`, `ConfirmCommandDialog`, `DetailSection`, `DetailField`, `EmptyState`, `ErrorState`, `PermissionState`, `ConflictState`, `LoadingTable`.

Domain: `OrderStatus`, `OrderTimeline`, `OrderItemsTable`, `OrderFinancialSummary`, `AmendmentPanel`, `PaymentStatus`, `PaymentAttemptList`, `RefundDialog`, `ReconciliationBanner`, `ProcurementRequirement`, `ReceivingDiscrepancy`, `SupplyExceptionResolution`, `InventoryAvailability`, `InventoryLedger`, `InventoryAdjustmentDialog`, `DeliveryCycleSummary`, `CapacityBar`, `DeliveryBatchBoard`, `RiderAssignment`, `FailedDeliveryResolution`, `FulfillmentWorkQueue`, `ShortageResolution`, `PackedSummary`, `StaffScopeEditor`, `CapabilityMatrix`, and `AuditEventList`.

## Proposed Implementation Sequence

1. Approve the operational IA, density, status vocabulary, and scope behavior.
2. Establish shared theme variables and shadcn primitive styling without changing primitive behavior.
3. Build `AdminShell`, scope/cycle context, breadcrumbs, command affordance, and responsive navigation.
4. Build `FilterBar`, `AdminDataTable`, status components, loading/empty/error/conflict states, and URL filter persistence.
5. Implement Overview and Orders workspaces against typed read models and legal command results.
6. Add Payments, Inventory, Procurement, Fulfillment, and Delivery queues/detail workspaces as their Core contracts/read models become complete.
7. Add Customers, Subscriptions, Staff/Roles, Audit, and later Promotions/Analytics surfaces according to current release sequencing.
8. Validate keyboard/accessibility, location/capability enforcement, idempotency/conflict behavior, responsive tables, and representative Playwright operational flows.

## Approved Decisions

Initial admin personas are Operations Admin, Inventory / Procurement, Fulfillment / Delivery, and Finance / Payments. Overview priority is: operational exceptions requiring action; current delivery-cycle/today's order state; inventory and procurement risks; fulfillment and delivery state; then payment exceptions. Promotions stays secondary/feature-gated until its read models and commands are ready. The command palette is deferred until the primary information architecture is proven.
