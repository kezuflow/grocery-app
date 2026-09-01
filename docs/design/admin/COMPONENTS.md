# FreshMarkets Admin Component Guidance

## Component Layers

### Layer 1: shadcn/ui primitives

Use the existing shadcn/ui implementations for Button, Input, Textarea, Select, Checkbox, RadioGroup, Switch, Dialog, AlertDialog, Sheet, DropdownMenu, Popover, Tooltip, Tabs, Breadcrumb, Sidebar, Table, Badge, Skeleton, Alert, Calendar, Command, Form, and toast/notification primitives.

Primitive styling may be themed, but behavior, accessibility, and composition should not be independently recreated.

### Layer 2: shared admin compositions

Build these only once they appear across multiple workspaces:

- `AdminShell`: sidebar, header, scope/cycle context, responsive navigation.
- `AdminNavigation`: Core-provided section/parent/child links narrowed by Core-declared selected-scope applicability, expanded and icon-rail modes, mobile Sheet, route-aware expansion, tooltips, and keyboard navigation.
- `PageHeader`: title, description, breadcrumbs, scope, primary/secondary actions.
- `FilterBar`: debounced search, select/date/status filters, clear-all, URL state.
- `AdminDataTable`: server-side data, keyset pagination, row selection, responsive fallback, loading/empty/error states.
- `AdminDashboardGrid`: responsive reference-aligned grid for operational cards, charts, queues, and recent activity.
- `StatusBadge` / domain status components: stable label, tone, icon, accessible text.
- `MetricCard` only for decision-relevant metrics; never as default dashboard filler.
- `AdminChartCard`: accessible Recharts composition with an explicit title, definition/freshness context, non-visual summary, and unavailable state.
- `Timeline`: ordered domain/audit/delivery events.
- `ExceptionQueue`: severity, age, owner, reason, legal resolution actions.
- `ConfirmCommandDialog`: consequence, target, reason, idempotent submit, result state.
- `ScopeSelector`: explicit market/location context with permission-aware options.
- `DetailSection` / `DetailField`: consistent read-only domain presentation.
- `EditorLayout`: sticky summary/action rail plus grouped fields for product and configuration authoring.
- `DetailWorkspace`: resource header, summary strip, legal actions, tabs/sections, timeline, and audit context.
- `SettingsTabs`, `StepIndicator`, and `CommandBanner`: shared configuration navigation, bounded workflow progress, and pending/conflict/success feedback.

### Layer 3: domain compositions

- `OrderStatus`, `OrderTimeline`, `OrderItemsTable`, `OrderFinancialSummary`, `AmendmentPanel`.
- `PaymentStatus`, `PaymentAttemptList`, `RefundDialog`, `ReconciliationBanner`.
- `ProcurementRequirement`, `ReceivingDiscrepancy`, `SupplyExceptionResolution`.
- `InventoryAvailability`, `InventoryLedger`, `InventoryAdjustmentDialog`.
- `DeliveryCycleSummary`, `CapacityBar`, `DeliveryBatchBoard`, `RiderAssignment`, `FailedDeliveryResolution`.
- `FulfillmentWorkQueue`, `ShortageResolution`, `PackedSummary`.
- `StaffScopeEditor`, `CapabilityMatrix`, `AuditEventList`.
- `ProductListTable`, `ProductEditor`, `ProductMediaManager`, `SkuVariantEditor`, `SkuPricePanel`, and `SkuAvailabilityPanel`.
- `CategoryListTable`, `CategoryEditor`, `CategoryTree`, and `CategoryProductList`.
- `CommerceConfigurationTabs`, `MembershipPriceEditor`, and `ServiceFeeEditor`.

Domain compositions must consume purpose-built DTOs and call explicit Core commands. They must not infer legal transitions from arbitrary strings or modify data locally as if the mutation succeeded.

## Tables

`AdminDataTable` conventions:

- Accept a typed read-model row, not a database entity.
- Define columns around the operator's decision.
- Support server-side cursor pagination, stable sorting, filter tokens, row links, and selection only when safe.
- Keep filter and column-visibility controls in one table toolbar; replace them with the applicable bulk-command controls while rows are selected.
- Expose loading skeleton, empty, filtered-empty, error, stale/conflict, and partial-action-result states.
- Put secondary fields in responsive expansion/detail rather than making desktop columns unreadable.

## Forms and Commands

- Form validation mirrors contract schemas for immediate feedback but Core revalidates authoritatively.
- Submit explicit command input with idempotency key and expected version.
- Disable duplicate submission while preserving retry/recovery behavior.
- Show command result returned by Core; never optimistically show a committed state that has not been acknowledged.
- Destructive commands use `ConfirmCommandDialog` and require a reason where domain policy requires one.

## Status Components

Every status component maps a stable domain enum to:

- human label;
- semantic tone/icon;
- accessible description;
- optional next-action hint;
- whether the status is terminal, pending, blocked, or exceptional.

Do not use a generic “active” badge for unrelated order, payment, procurement, or delivery states.

## Exception Components

Exception components must make resolution explicit:

- source/resource and scope;
- affected quantity/amount;
- deadline/age;
- current owner;
- permitted resolution choices;
- required reason/notes;
- audit/result state.

Do not turn exception resolution into an arbitrary edit form.

## Responsive and Accessibility Rules

- Keep interactive targets at least touch-friendly on mobile.
- Preserve row identity and action access when tables collapse.
- Use semantic headings, labels, table structures, focus management, keyboard menus, and live status announcements.
- Ensure color tones meet contrast and have text/icon alternatives.
- Recharts visualizations include an accessible label/description and a textual value summary; charts are never the only way to obtain an operational value.

## Testing Expectations

Component tests cover loading/empty/error/permission/disabled/conflict states and command success/failure. Playwright tests cover representative admin flows: order cancellation/refund, inventory adjustment, receiving discrepancy, packing, batch assignment, rider delivery failure, role scope enforcement, and audit visibility.
