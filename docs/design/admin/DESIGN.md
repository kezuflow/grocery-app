# FreshMarkets Admin Design

## Purpose

The admin is an operational decision system. It should answer “What is happening, what is blocked, and what requires attention?” before it presents CRUD controls. The design optimizes dense scanning, safe bulk work, clear ownership, and auditable transitions.

## Primitive Foundation

Use shadcn/ui for generic primitives: Button, Input, Select, Checkbox, Switch, Dialog, Sheet, DropdownMenu, Popover, Tooltip, Tabs, Breadcrumb, Sidebar, Table, Skeleton, Alert, Badge, Calendar, Command, Form, and Toast/Sonner where installed.

Do not recreate generic primitives. Custom components are justified only when they express a domain composition such as `AdminDataTable`, `OrderStatus`, `PaymentStatus`, `ProcurementRequirement`, `DeliveryCycleSummary`, `InventoryAvailability`, `FulfillmentWorkQueue`, or `ExceptionQueue`.

## Information Architecture

Primary navigation is organized around operational ownership:

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
11. Promotions (later/MVP subset)
12. Analytics (later)
13. Staff / Roles
14. Audit Log
15. Settings

Navigation items and actions are capability-aware. A user may see a workspace but receive a scoped empty state if they have no records in the permitted market/location; unauthorized actions remain unavailable in Core.

## Global Shell

- Persistent sidebar on desktop; collapsible sheet/drawer on narrower screens.
- Header includes breadcrumb, current market/location scope, cycle context where relevant, search/command affordance, notifications/exceptions indicator, and user menu.
- Scope selection is explicit and never silently changes a command's target.
- Use URL-addressable filters/tabs for operational queues.
- Show an environment/status indicator for non-production contexts.

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

## Page Archetypes

### Operational list/queue

- Title, scope, cycle/date context, primary action.
- Filter row with search, status, date/cycle, location/zone, and saved-view-ready URL state.
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
- Inventory: inspect location balances, reservations, ledger, and adjustments.
- Procurement: turn committed demand into requirements and receiving decisions.
- Fulfillment: progress work and resolve shortages.
- Delivery: manage capacity, batches, riders, stops, and failed delivery.
- Customers: support identity-linked customer context without editing auth records.
- Subscriptions: manage membership state and billing failures, not grocery orders.
- Payments: reconcile provider truth, attempts, refunds, and exceptions.
- Staff/Roles: manage capabilities and location scope.
- Audit: inspect immutable material operations.

## Phase-0 Proposal

The detailed admin IA, shell, table/filter standards, component inventory, responsive behavior, and approval gates live in `ADMIN_DESIGN.md`.
