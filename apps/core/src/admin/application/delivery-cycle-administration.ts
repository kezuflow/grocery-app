import type {
  AdminDeliveryCyclePage,
  AdminCycleDestinations,
  AdminDeliveryCycleView,
  AppErrorCode,
  AuthenticatedRequest,
  RpcResult,
  SaveAdminDeliveryCycleRequest,
  ScheduleAdminDeliveryCycleRequest,
  CancelAdminDeliveryCycleRequest,
} from "@freshmarkets/contracts";
import {
  z,
  adminDeliveryCycleViewSchema,
  deliveryCycleDraftSchema,
  identifierSchema,
  idempotencyKeySchema,
} from "@freshmarkets/validation";
import { authenticatedRequestSchema } from "../../validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { validateDeliveryCycleSchedule } from "../../commerce/delivery-cycle-schedule";
import {
  resolveGlobalFulfillmentAdministrationAccess as access,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";

type Deps = OperationsAdministrationDeps & { now?: () => number };
const saveSchema = authenticatedRequestSchema.extend({
  ...deliveryCycleDraftSchema.shape,
  idempotencyKey: idempotencyKeySchema,
});
const scheduleSchema = authenticatedRequestSchema.extend({
  cycleId: identifierSchema,
  expectedVersion: z.number().int().safe().positive(),
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(1).max(500),
});
const failure = (code: AppErrorCode, message: string, requestId: string) => ({
  ok: false as const,
  error: { code, message, requestId },
});
const required = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
const cancellationBlocker = `CASE
  WHEN c.status NOT IN ('DRAFT','SCHEDULED','OPEN') THEN 'This cycle no longer permits unpaid cancellation'
  WHEN EXISTS (SELECT 1 FROM grocery_order o WHERE o.cycle_id=c.id) THEN 'Orders require coordinated operational and financial resolution'
  WHEN EXISTS (SELECT 1 FROM checkout_quote q JOIN payment_intent p ON p.subject_type='checkout_quote' AND p.subject_id=q.id
    WHERE q.delivery_cycle_id=c.id AND p.status NOT IN ('FAILED','CANCELED')) THEN 'Resolve started payments before canceling this cycle'
  WHEN EXISTS (SELECT 1 FROM capacity_allocations a WHERE a.cycle_id=c.id AND a.status='HELD')
    OR EXISTS (SELECT 1 FROM checkout_inventory_holds h WHERE h.status='HELD' AND h.checkout_attempt_id IN (
      SELECT id FROM checkout_quote WHERE delivery_cycle_id=c.id UNION SELECT id FROM checkout_attempts WHERE cycle_id=c.id))
    THEN 'Resolve retained checkout holds before canceling this cycle'
  ELSE NULL END`;
const selection = `SELECT c.id cycleId,c.market_id marketId,m.name marketName,c.name,c.status,c.version,
  ${cancellationBlocker} cancellationUnavailableReason,
  COALESCE(s.timezone,m.timezone) timezone,c.order_opens_at orderOpensAt,c.cutoff_at cutoffAt,
  s.procurement_at procurementAt,s.preparation_at preparationAt,s.pickup_at pickupAt,
  (SELECT json_group_array(json_object('windowId',id,'name',name,'startsAt',starts_at,'endsAt',ends_at)) FROM
    (SELECT * FROM delivery_cycle_window WHERE cycle_id=c.id ORDER BY starts_at,id)) windowsJson,
  (SELECT json_group_array(json_object('zoneId',z.id,'zoneName',z.name,'locationId',l.id,'locationName',l.name))
    FROM delivery_cycle_zone p JOIN delivery_zone z ON z.id=p.zone_id JOIN fulfillment_location l ON l.id=p.location_id
    WHERE p.cycle_id=c.id AND p.status='ACTIVE') participationJson
  FROM delivery_cycle c JOIN market m ON m.id=c.market_id LEFT JOIN delivery_cycle_schedule s ON s.cycle_id=c.id`;
type Row = Omit<
  AdminDeliveryCycleView,
  | "orderOpensAt"
  | "cutoffAt"
  | "procurementAt"
  | "preparationAt"
  | "pickupAt"
  | "windows"
  | "participation"
> & {
  orderOpensAt: number;
  cutoffAt: number;
  procurementAt: number | null;
  preparationAt: number | null;
  pickupAt: number | null;
  windowsJson: string;
  participationJson: string;
};
const storedWindowsSchema = z.array(
  z.object({ windowId: z.string(), name: z.string(), startsAt: z.number(), endsAt: z.number() }),
);
function view(row: Row): AdminDeliveryCycleView {
  const { windowsJson, participationJson, ...fields } = row;
  return adminDeliveryCycleViewSchema.parse({
    ...fields,
    orderOpensAt: new Date(row.orderOpensAt).toISOString(),
    cutoffAt: new Date(row.cutoffAt).toISOString(),
    procurementAt: row.procurementAt === null ? null : new Date(row.procurementAt).toISOString(),
    preparationAt: row.preparationAt === null ? null : new Date(row.preparationAt).toISOString(),
    pickupAt: row.pickupAt === null ? null : new Date(row.pickupAt).toISOString(),
    windows: storedWindowsSchema.parse(JSON.parse(windowsJson)).map((window) => ({
      ...window,
      startsAt: new Date(window.startsAt).toISOString(),
      endsAt: new Date(window.endsAt).toISOString(),
    })),
    participation: JSON.parse(participationJson),
  });
}
async function load(db: D1Database, cycleId: string) {
  const row = await db.prepare(`${selection} WHERE c.id=?`).bind(cycleId).first<Row>();
  return row ? view(row) : null;
}

export async function listAdminDeliveryCycles(
  deps: Deps,
  input: AuthenticatedRequest & { cursor?: string },
): Promise<RpcResult<AdminDeliveryCyclePage>> {
  const parsed = authenticatedRequestSchema
    .extend({ cursor: identifierSchema.optional() })
    .safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid cycle query", input.requestId);
  const permitted = await access(deps, parsed.data, "fulfillment.read");
  if (!permitted.ok) return permitted;
  const [rows, manage, markets] = await Promise.all([
    deps.db
      .prepare(`${selection} WHERE (? IS NULL OR c.id>?) ORDER BY c.id LIMIT 21`)
      .bind(parsed.data.cursor ?? null, parsed.data.cursor ?? "")
      .all<Row>(),
    access(deps, parsed.data, "fulfillment.manage"),
    deps.db
      .prepare(
        "SELECT id marketId,name,timezone FROM market WHERE status='active' ORDER BY name,id LIMIT 100",
      )
      .all<AdminDeliveryCyclePage["markets"][number]>(),
  ]);
  const page = rows.results.slice(0, 20);
  return {
    ok: true,
    requestId: input.requestId,
    value: {
      items: page.map(view),
      markets: markets.results,
      nextCursor: rows.results.length > 20 ? (page.at(-1)?.cycleId ?? null) : null,
      canManage: manage.ok,
    },
  };
}

export async function listAdminCycleDestinations(
  deps: Deps,
  input: AuthenticatedRequest & { marketId: string; cursor?: string },
): Promise<RpcResult<AdminCycleDestinations>> {
  const parsed = authenticatedRequestSchema
    .extend({ marketId: identifierSchema, cursor: z.string().max(2000).optional() })
    .safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_FAILED", "Invalid destination query", input.requestId);
  const permitted = await access(deps, parsed.data, "fulfillment.read");
  if (!permitted.ok) return permitted;
  let cursor: [string, string, string] | null = null;
  if (parsed.data.cursor) {
    try {
      cursor = z
        .tuple([identifierSchema, identifierSchema, identifierSchema])
        .parse(JSON.parse(decodeURIComponent(parsed.data.cursor)));
    } catch {
      return failure("VALIDATION_FAILED", "Invalid destination cursor", input.requestId);
    }
    if (cursor[0] !== input.marketId)
      return failure("VALIDATION_FAILED", "Cursor belongs to another market", input.requestId);
  }
  const now = deps.now?.() ?? Date.now();
  const rows = await deps.db
    .prepare(`SELECT DISTINCT z.id zoneId,z.name zoneName,l.id locationId,l.name locationName
    FROM delivery_zone z JOIN service_area a ON a.id=z.service_area_id
    JOIN location_serviceability link ON link.zone_id=z.id AND link.eligible=1
    JOIN fulfillment_location l ON l.id=link.location_id JOIN market m ON m.id=a.market_id
    WHERE m.id=? AND m.status='active' AND l.market_id=m.id AND a.status='active' AND z.status='active'
      AND l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT'
      AND a.active_from<=? AND (a.active_to IS NULL OR a.active_to>?) AND link.valid_from<=? AND (link.valid_to IS NULL OR link.valid_to>?)
      AND (SELECT COUNT(DISTINCT capability) FROM location_capability WHERE location_id=l.id AND enabled=1 AND capability IN ('PICKING','PACKING','DISPATCH'))=3
      AND (? IS NULL OR (z.id,l.id)>(?,?)) ORDER BY z.id,l.id LIMIT 51`)
    .bind(
      input.marketId,
      now,
      now,
      now,
      now,
      cursor?.[1] ?? null,
      cursor?.[1] ?? "",
      cursor?.[2] ?? "",
    )
    .all<AdminCycleDestinations["items"][number]>();
  const items = rows.results.slice(0, 50),
    last = items.at(-1);
  return {
    ok: true,
    requestId: input.requestId,
    value: {
      items,
      nextCursor:
        rows.results.length > 50 && last
          ? encodeURIComponent(JSON.stringify([input.marketId, last.zoneId, last.locationId]))
          : null,
    },
  };
}

/** Every selected destination is reread within the same transaction as publication. */
function participationGuard(
  db: D1Database,
  marketId: string,
  participation:
    | AdminDeliveryCycleView["participation"]
    | SaveAdminDeliveryCycleRequest["participation"],
  now: number,
) {
  return db
    .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (
    SELECT 1 FROM json_each(?) requested WHERE NOT EXISTS (
      SELECT 1 FROM delivery_zone z JOIN service_area a ON a.id=z.service_area_id
      JOIN location_serviceability link ON link.zone_id=z.id AND link.eligible=1
      JOIN fulfillment_location l ON l.id=link.location_id
      WHERE z.id=json_extract(requested.value,'$.zoneId') AND l.id=json_extract(requested.value,'$.locationId')
        AND a.market_id=? AND l.market_id=a.market_id AND a.status='active' AND z.status='active'
        AND l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT'
        AND a.active_from<=? AND (a.active_to IS NULL OR a.active_to>?)
        AND link.valid_from<=? AND (link.valid_to IS NULL OR link.valid_to>?)
        AND (SELECT COUNT(DISTINCT capability) FROM location_capability WHERE location_id=l.id AND enabled=1 AND capability IN ('PICKING','PACKING','DISPATCH'))=3
    ))`)
    .bind(JSON.stringify(participation), marketId, now, now, now, now);
}

type Mutation =
  | { kind: "SAVE"; request: z.infer<typeof saveSchema> }
  | { kind: "SCHEDULE" | "CANCEL"; request: z.infer<typeof scheduleSchema> };
async function execute(deps: Deps, mutation: Mutation): Promise<RpcResult<AdminDeliveryCycleView>> {
  const { request } = mutation;
  const permitted = await access(deps, request, "fulfillment.manage");
  if (!permitted.ok) return permitted;
  const { headers: _headers, requestId: _requestId, idempotencyKey, ...intent } = request;
  const hash = await requestHash({
    action: mutation.kind,
    actor: permitted.value.authUserId,
    ...intent,
  });
  const scope = "admin.delivery-cycles.command";
  async function replay(): Promise<RpcResult<AdminDeliveryCycleView> | null> {
    const saved = await deps.db
      .prepare(
        "SELECT request_hash,status,result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
      )
      .bind(scope, idempotencyKey)
      .first<{ request_hash: string; status: string; result_reference: string | null }>();
    if (!saved) return null;
    if (saved.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Key belongs to another cycle command",
        request.requestId,
      );
    if (saved.status === "SUCCEEDED" && saved.result_reference) {
      try {
        return {
          ok: true,
          requestId: request.requestId,
          value: adminDeliveryCycleViewSchema.parse(JSON.parse(saved.result_reference)),
        };
      } catch {
        return failure("CONFLICT", "Saved cycle result needs recovery", request.requestId);
      }
    }
    return failure("CONFLICT", "Cycle command is processing", request.requestId);
  }
  const prior = await replay();
  if (prior) return prior;
  const current = request.cycleId ? await load(deps.db, request.cycleId) : null;
  if (request.cycleId && !current)
    return failure("NOT_FOUND", "Cycle not found", request.requestId);
  if (current && current.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Cycle changed; refresh and review", request.requestId);
  if (current && mutation.kind !== "CANCEL" && current.status !== "DRAFT")
    return failure(
      "ILLEGAL_TRANSITION",
      "Only a draft cycle can be edited or scheduled",
      request.requestId,
    );
  if (!current && request.expectedVersion !== 0)
    return failure("STALE_VERSION", "A new cycle starts at version zero", request.requestId);
  const marketId = mutation.kind === "SAVE" ? mutation.request.marketId : current?.marketId;
  if (!marketId || (current && current.marketId !== marketId))
    return failure("VALIDATION_FAILED", "The cycle market cannot change", request.requestId);
  const market = await deps.db
    .prepare("SELECT name,timezone FROM market WHERE id=? AND (?=1 OR status='active')")
    .bind(marketId, mutation.kind === "CANCEL" ? 1 : 0)
    .first<{ name: string; timezone: string }>();
  if (!market)
    return failure("CONFIGURATION_ERROR", "An active market is required", request.requestId);
  const now = deps.now?.() ?? Date.now();
  let next: AdminDeliveryCycleView;
  if (mutation.kind === "CANCEL") {
    if (!current) return failure("NOT_FOUND", "Cycle not found", request.requestId);
    if (current.cancellationUnavailableReason)
      return failure("CONFLICT", current.cancellationUnavailableReason, request.requestId);
    next = {
      ...current,
      status: "CANCELED",
      version: current.version + 1,
      cancellationUnavailableReason: "This cycle no longer permits unpaid cancellation",
    };
  } else if (mutation.kind === "SAVE") {
    const draft = mutation.request;
    const invalid = validateDeliveryCycleSchedule(draft, now);
    if (invalid) return failure("VALIDATION_FAILED", invalid, request.requestId);
    const destinations = await deps.db
      .prepare(`SELECT z.id zoneId,z.name zoneName,l.id locationId,l.name locationName
      FROM json_each(?) selected JOIN delivery_zone z ON z.id=json_extract(selected.value,'$.zoneId')
      JOIN fulfillment_location l ON l.id=json_extract(selected.value,'$.locationId')`)
      .bind(JSON.stringify(draft.participation))
      .all<AdminDeliveryCycleView["participation"][number]>();
    if (destinations.results.length !== draft.participation.length)
      return failure(
        "VALIDATION_FAILED",
        "Select valid participating destinations",
        request.requestId,
      );
    next = {
      cycleId: current?.cycleId ?? crypto.randomUUID(),
      marketId,
      marketName: market.name,
      timezone: market.timezone,
      name: draft.name,
      status: "DRAFT",
      cancellationUnavailableReason: null,
      version: (current?.version ?? 0) + 1,
      orderOpensAt: new Date(draft.orderOpensAt).toISOString(),
      cutoffAt: new Date(draft.cutoffAt).toISOString(),
      procurementAt: new Date(draft.procurementAt).toISOString(),
      preparationAt: new Date(draft.preparationAt).toISOString(),
      pickupAt: new Date(draft.pickupAt).toISOString(),
      windows: draft.windows.map((window) => ({
        windowId: crypto.randomUUID(),
        name: window.name,
        startsAt: new Date(window.startsAt).toISOString(),
        endsAt: new Date(window.endsAt).toISOString(),
      })),
      participation: destinations.results,
    };
  } else {
    if (!current || !current.procurementAt || !current.preparationAt || !current.pickupAt)
      return failure(
        "CONFIGURATION_ERROR",
        "Configure the complete cycle schedule first",
        request.requestId,
      );
    const invalid = validateDeliveryCycleSchedule(
      {
        ...current,
        procurementAt: current.procurementAt,
        preparationAt: current.preparationAt,
        pickupAt: current.pickupAt,
      },
      now,
    );
    if (invalid) return failure("VALIDATION_FAILED", invalid, request.requestId);
    next = { ...current, status: "SCHEDULED", version: current.version + 1 };
  }
  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
      SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global'
      JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
      WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='fulfillment.manage')
      OR NOT EXISTS (SELECT 1 FROM market WHERE id=? AND (?=1 OR status='active') AND name=? AND timezone=?)`)
      .bind(
        permitted.value.staffId,
        permitted.value.authUserId,
        marketId,
        mutation.kind === "CANCEL" ? 1 : 0,
        market.name,
        market.timezone,
      ),
    ...(mutation.kind === "CANCEL"
      ? []
      : [participationGuard(deps.db, marketId, next.participation, now)]),
    deps.db
      .prepare(
        "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','delivery_cycle',?,?)",
      )
      .bind(scope, idempotencyKey, hash, now, now),
    required(deps.db),
  ];
  if (mutation.kind === "SAVE") {
    const earliest = Math.min(...next.windows.map((window) => Date.parse(window.startsAt)));
    if (current)
      statements.push(
        deps.db
          .prepare(
            "UPDATE delivery_cycle SET name=?,order_opens_at=?,cutoff_at=?,delivery_date=?,version=version+1 WHERE id=? AND market_id=? AND status='DRAFT' AND version=?",
          )
          .bind(
            next.name,
            Date.parse(next.orderOpensAt),
            Date.parse(next.cutoffAt),
            earliest,
            next.cycleId,
            marketId,
            request.expectedVersion,
          ),
        required(deps.db),
      );
    else
      statements.push(
        deps.db
          .prepare(
            "INSERT INTO delivery_cycle(id,market_id,name,order_opens_at,cutoff_at,delivery_date,status,capacity,allocated,version) VALUES (?,?,?,?,?,?,'DRAFT',0,0,1)",
          )
          .bind(
            next.cycleId,
            marketId,
            next.name,
            Date.parse(next.orderOpensAt),
            Date.parse(next.cutoffAt),
            earliest,
          ),
        required(deps.db),
      );
    // Validated above; use the parsed draft to keep optional historical fields out of writes.
    const draft = mutation.request;
    statements.push(
      deps.db
        .prepare(`INSERT INTO delivery_cycle_schedule(cycle_id,timezone,procurement_at,preparation_at,pickup_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(cycle_id) DO UPDATE SET timezone=excluded.timezone,procurement_at=excluded.procurement_at,preparation_at=excluded.preparation_at,pickup_at=excluded.pickup_at,updated_at=excluded.updated_at`)
        .bind(
          next.cycleId,
          next.timezone,
          Date.parse(draft.procurementAt),
          Date.parse(draft.preparationAt),
          Date.parse(draft.pickupAt),
          now,
          now,
        ),
      required(deps.db),
      deps.db.prepare("DELETE FROM delivery_cycle_window WHERE cycle_id=?").bind(next.cycleId),
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM delivery_cycle_window WHERE cycle_id=?)",
        )
        .bind(next.cycleId),
      deps.db.prepare("DELETE FROM delivery_cycle_zone WHERE cycle_id=?").bind(next.cycleId),
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM delivery_cycle_zone WHERE cycle_id=?)",
        )
        .bind(next.cycleId),
    );
    for (const window of next.windows)
      statements.push(
        deps.db
          .prepare(
            "INSERT INTO delivery_cycle_window(id,cycle_id,name,starts_at,ends_at,created_at) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            window.windowId,
            next.cycleId,
            window.name,
            Date.parse(window.startsAt),
            Date.parse(window.endsAt),
            now,
          ),
        required(deps.db),
      );
    for (const item of next.participation)
      statements.push(
        deps.db
          .prepare(
            "INSERT INTO delivery_cycle_zone(cycle_id,zone_id,location_id,status,version,created_at,updated_at) VALUES (?,?,?,'ACTIVE',1,?,?)",
          )
          .bind(next.cycleId, item.zoneId, item.locationId, now, now),
        required(deps.db),
      );
  } else if (mutation.kind === "SCHEDULE") {
    // Fence the exact schedule and relation sets, not only the earlier aggregate read.
    statements.push(
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
      SELECT 1 FROM delivery_cycle c JOIN delivery_cycle_schedule s ON s.cycle_id=c.id
      WHERE c.id=? AND c.order_opens_at=? AND c.cutoff_at=? AND s.timezone=? AND s.procurement_at=? AND s.preparation_at=? AND s.pickup_at=?)
      OR (SELECT COUNT(*) FROM delivery_cycle_window WHERE cycle_id=?)<>?
      OR EXISTS (SELECT 1 FROM delivery_cycle_window w WHERE w.cycle_id=? AND NOT EXISTS (SELECT 1 FROM json_each(?) expected WHERE
        json_extract(expected.value,'$.windowId')=w.id AND json_extract(expected.value,'$.name')=w.name AND json_extract(expected.value,'$.startsAt')=w.starts_at AND json_extract(expected.value,'$.endsAt')=w.ends_at))
      OR (SELECT COUNT(*) FROM delivery_cycle_zone WHERE cycle_id=? AND status='ACTIVE')<>?
      OR EXISTS (SELECT 1 FROM delivery_cycle_zone p WHERE p.cycle_id=? AND p.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM json_each(?) expected WHERE json_extract(expected.value,'$.zoneId')=p.zone_id AND json_extract(expected.value,'$.locationId')=p.location_id))`)
        .bind(
          next.cycleId,
          Date.parse(next.orderOpensAt),
          Date.parse(next.cutoffAt),
          next.timezone,
          Date.parse(next.procurementAt ?? ""),
          Date.parse(next.preparationAt ?? ""),
          Date.parse(next.pickupAt ?? ""),
          next.cycleId,
          next.windows.length,
          next.cycleId,
          JSON.stringify(
            next.windows.map((window) => ({
              ...window,
              startsAt: Date.parse(window.startsAt),
              endsAt: Date.parse(window.endsAt),
            })),
          ),
          next.cycleId,
          next.participation.length,
          next.cycleId,
          JSON.stringify(next.participation),
        ),
      deps.db
        .prepare(
          "UPDATE delivery_cycle SET status='SCHEDULED',version=version+1 WHERE id=? AND market_id=? AND status='DRAFT' AND version=? AND cutoff_at>?",
        )
        .bind(next.cycleId, marketId, request.expectedVersion, now),
      required(deps.db),
    );
  }
  if (mutation.kind === "CANCEL") {
    statements.push(
      deps.db
        .prepare(
          `INSERT INTO admin_command_abort(id) SELECT -1 FROM delivery_cycle c WHERE c.id=? AND (${cancellationBlocker}) IS NOT NULL`,
        )
        .bind(next.cycleId),
      deps.db
        .prepare(
          "UPDATE delivery_cycle SET status='CANCELED',version=version+1 WHERE id=? AND version=? AND status IN ('DRAFT','SCHEDULED','OPEN')",
        )
        .bind(next.cycleId, request.expectedVersion),
      required(deps.db),
      deps.db
        .prepare(
          "UPDATE checkout_quote SET status='SUPERSEDED',version=version+1,updated_at=? WHERE delivery_cycle_id=? AND status='ACTIVE'",
        )
        .bind(now, next.cycleId),
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM checkout_quote WHERE delivery_cycle_id=? AND status='ACTIVE')",
        )
        .bind(next.cycleId),
      deps.db
        .prepare(
          "UPDATE checkout_attempts SET status='EXPIRED',version=version+1,updated_at=? WHERE cycle_id=? AND status='PROCESSING'",
        )
        .bind(now, next.cycleId),
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM checkout_attempts WHERE cycle_id=? AND status='PROCESSING')",
        )
        .bind(next.cycleId),
    );
  }
  statements.push(
    auditEventStatement(deps.db, {
      actorUserId: permitted.value.authUserId,
      action:
        mutation.kind === "SAVE"
          ? "delivery_cycle.draft_saved"
          : mutation.kind === "SCHEDULE"
            ? "delivery_cycle.scheduled"
            : "delivery_cycle.canceled",
      resourceType: "delivery_cycle",
      resourceId: next.cycleId,
      marketId,
      reason: request.reason,
      correlationId: request.requestId,
      idempotencyKey,
      occurredAt: now,
      before: current ? { version: current.version, status: current.status } : null,
      after: { version: next.version, status: next.status },
    }),
    required(deps.db),
    deps.db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(JSON.stringify(next), now, scope, idempotencyKey, hash),
    required(deps.db),
  );
  try {
    await deps.db.batch(statements);
  } catch {
    return (
      (await replay()) ??
      failure(
        "CONFLICT",
        "Cycle, destination or access changed; refresh and review",
        request.requestId,
      )
    );
  }
  return { ok: true, requestId: request.requestId, value: next };
}

export async function saveAdminDeliveryCycleDraft(
  deps: Deps,
  input: SaveAdminDeliveryCycleRequest,
): Promise<RpcResult<AdminDeliveryCycleView>> {
  const parsed = saveSchema.safeParse(input);
  return parsed.success
    ? execute(deps, { kind: "SAVE", request: parsed.data })
    : failure("VALIDATION_FAILED", "Check cycle details and schedule", input.requestId);
}
export async function scheduleAdminDeliveryCycle(
  deps: Deps,
  input: ScheduleAdminDeliveryCycleRequest,
): Promise<RpcResult<AdminDeliveryCycleView>> {
  const parsed = scheduleSchema.safeParse(input);
  return parsed.success
    ? execute(deps, { kind: "SCHEDULE", request: parsed.data })
    : failure("VALIDATION_FAILED", "Check cycle version and reason", input.requestId);
}
export async function cancelAdminDeliveryCycle(
  deps: Deps,
  input: CancelAdminDeliveryCycleRequest,
): Promise<RpcResult<AdminDeliveryCycleView>> {
  const parsed = scheduleSchema.safeParse(input);
  return parsed.success
    ? execute(deps, { kind: "CANCEL", request: parsed.data })
    : failure("VALIDATION_FAILED", "Check cycle version and cancellation reason", input.requestId);
}
