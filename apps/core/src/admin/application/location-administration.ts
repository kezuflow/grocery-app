import { drizzle } from "drizzle-orm/d1";
import type {
  AdminLocationView,
  AdminLocationsRequest,
  AdminLocationsView,
  AuthenticatedRequest,
  CreateAdminLocationRequest,
  UpdateAdminLocationRequest,
  TransitionAdminLocationRequest,
  RpcResult,
  AppErrorCode,
} from "@freshmarkets/contracts";
import {
  z,
  identifierSchema,
  idempotencyKeySchema,
  adminLocationDetailsSchema,
  adminLocationViewSchema,
  locationAddressSchema,
  locationCapabilitySchema,
  locationPurposeSchema,
} from "@freshmarkets/validation";
import { authenticatedRequestSchema } from "../../validation";
import { applicationContextForRequest } from "../../auth/authorization";
import { iamSchema } from "../../iam/schema";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  decodeStaffCursor,
  encodeStaffCursor,
  type StaffAdministrationDeps,
} from "./staff-administration-access";

const commandSchema = authenticatedRequestSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(1).max(500),
});
const createSchema = commandSchema.extend({
  ...adminLocationDetailsSchema.shape,
  marketId: identifierSchema,
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  purpose: locationPurposeSchema,
});
const updateSchema = commandSchema.extend({
  ...adminLocationDetailsSchema.shape,
  locationId: identifierSchema,
  expectedVersion: z.number().int().safe().positive(),
});
const transitionSchema = commandSchema.extend({
  locationId: identifierSchema,
  expectedVersion: z.number().int().safe().positive(),
  action: z.enum(["ACTIVATE", "DEACTIVATE"]),
});

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

async function access(
  deps: StaffAdministrationDeps,
  request: AuthenticatedRequest,
  capability: "locations.read" | "locations.manage",
) {
  const context = await applicationContextForRequest(
    deps.auth,
    drizzle(deps.db, { schema: iamSchema }),
    request,
    deps.accessContext,
  );
  if (!context.ok) return context;
  if (!context.value.authenticated || !context.value.principal)
    return failure("UNAUTHENTICATED", "Authentication is required", request.requestId);
  if (
    !context.value.staffIdentity ||
    !context.value.capabilities.includes(capability) ||
    !context.value.scopes.some((scope) => scope.kind === "global")
  )
    return failure("FORBIDDEN", `Global ${capability} is required`, request.requestId);
  return {
    ok: true as const,
    staffId: context.value.staffIdentity.id,
    authUserId: context.value.principal.userId,
  };
}

const locationSelect = `SELECT l.id locationId,l.market_id marketId,m.name marketName,m.currency,m.timezone,
  l.code,l.name,l.purpose,l.status,l.version,l.latitude,l.longitude,l.address_json addressJson,l.created_at createdAt,
  (SELECT json_group_array(capability) FROM location_capability WHERE location_id=l.id AND enabled=1) capabilitiesJson
  FROM fulfillment_location l JOIN market m ON m.id=l.market_id`;
type LocationRow = Omit<AdminLocationView, "address" | "capabilities"> & {
  addressJson: string | null;
  capabilitiesJson: string;
  createdAt: number;
};
function view(row: LocationRow): AdminLocationView {
  let address: unknown = null;
  try {
    address = row.addressJson === null ? null : JSON.parse(row.addressJson);
  } catch {
    address = null;
  }
  const parsed = locationAddressSchema.safeParse(address);
  const { addressJson: _address, capabilitiesJson, createdAt: _created, ...fields } = row;
  // Historical incomplete addresses are visible as requiring operator confirmation.
  return {
    ...fields,
    address: parsed.success ? parsed.data : null,
    capabilities: z.array(locationCapabilitySchema).parse(JSON.parse(capabilitiesJson)),
  };
}
async function load(database: D1Database, id: string) {
  const row = await database
    .prepare(`${locationSelect} WHERE l.id=?`)
    .bind(id)
    .first<LocationRow>();
  return row ? view(row) : null;
}

export async function listAdminLocations(
  deps: StaffAdministrationDeps,
  input: AdminLocationsRequest,
): Promise<RpcResult<AdminLocationsView>> {
  const parsed = authenticatedRequestSchema
    .extend({ cursor: z.string().max(1000).optional() })
    .safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_FAILED", "Invalid location query", input.requestId);
  const request = parsed.data;
  const permitted = await access(deps, request, "locations.read");
  if (!permitted.ok) return permitted;
  const cursor = request.cursor ? decodeStaffCursor(request.cursor) : null;
  if (request.cursor && !cursor)
    return failure("VALIDATION_FAILED", "Invalid location cursor", request.requestId);
  const [rows, markets, manage] = await Promise.all([
    deps.db
      .prepare(
        `${locationSelect} WHERE (? IS NULL OR (l.created_at,l.id)>(?,?)) ORDER BY l.created_at,l.id LIMIT 51`,
      )
      .bind(cursor?.id ?? null, cursor?.createdAt ?? 0, cursor?.id ?? "")
      .all<LocationRow>(),
    deps.db
      .prepare(
        "SELECT id marketId,name,currency,timezone FROM market WHERE status='active' ORDER BY name,id LIMIT 100",
      )
      .all<AdminLocationsView["markets"][number]>(),
    access(deps, request, "locations.manage"),
  ]);
  const page = rows.results.slice(0, 50);
  const last = page.at(-1);
  return {
    ok: true,
    requestId: request.requestId,
    value: {
      items: page.map(view),
      markets: markets.results,
      canManage: manage.ok,
      nextCursor:
        rows.results.length > 50 && last
          ? encodeStaffCursor({ createdAt: last.createdAt, id: last.locationId })
          : null,
    },
  };
}

type LocationMutation =
  | { kind: "CREATE"; request: z.infer<typeof createSchema> }
  | { kind: "UPDATE"; request: z.infer<typeof updateSchema> }
  | { kind: "TRANSITION"; request: z.infer<typeof transitionSchema> };

async function execute(
  deps: StaffAdministrationDeps,
  mutation: LocationMutation,
): Promise<RpcResult<AdminLocationView>> {
  const { request } = mutation;
  const permitted = await access(deps, request, "locations.manage");
  if (!permitted.ok) return permitted;
  const { headers: _headers, requestId: _requestId, idempotencyKey, ...intent } = request;
  const hash = await requestHash({ kind: mutation.kind, actor: permitted.authUserId, ...intent });
  const scope = "admin.locations.command";
  async function replay(): Promise<RpcResult<AdminLocationView> | null> {
    const record = await deps.db
      .prepare(
        "SELECT request_hash,status,result_reference FROM idempotency_records WHERE scope=? AND idempotency_key=?",
      )
      .bind(scope, idempotencyKey)
      .first<{ request_hash: string; status: string; result_reference: string | null }>();
    if (!record) return null;
    if (record.request_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Key belongs to a different location command",
        request.requestId,
      );
    if (record.status === "SUCCEEDED" && record.result_reference) {
      try {
        return {
          ok: true,
          requestId: request.requestId,
          value: adminLocationViewSchema.parse(JSON.parse(record.result_reference)),
        };
      } catch {
        return failure("CONFLICT", "Saved command result needs recovery", request.requestId);
      }
    }
    return failure("CONFLICT", "Location command is processing", request.requestId);
  }
  const prior = await replay();
  if (prior) return prior;
  const current =
    mutation.kind === "CREATE" ? null : await load(deps.db, mutation.request.locationId);
  if (mutation.kind !== "CREATE" && !current)
    return failure("NOT_FOUND", "Location not found", request.requestId);
  if (mutation.kind !== "CREATE" && current?.version !== mutation.request.expectedVersion)
    return failure("STALE_VERSION", "Location changed; refresh and review", request.requestId);
  const marketId = mutation.kind === "CREATE" ? mutation.request.marketId : current?.marketId;
  if (!marketId) return failure("NOT_FOUND", "Location market not found", request.requestId);
  const market = await deps.db
    .prepare("SELECT name,currency,timezone FROM market WHERE id=? AND status='active'")
    .bind(marketId)
    .first<{ name: string; currency: string; timezone: string }>();
  if (!market)
    return failure("CONFIGURATION_ERROR", "An active market is required", request.requestId);
  const locationId = current?.locationId ?? crypto.randomUUID();
  const now = Date.now();
  let next: AdminLocationView;
  if (mutation.kind === "CREATE")
    next = {
      ...mutation.request,
      locationId,
      marketId,
      marketName: market.name,
      currency: market.currency,
      timezone: market.timezone,
      status: "inactive",
      version: 1,
    };
  else {
    if (!current) return failure("NOT_FOUND", "Location not found", request.requestId);
    if (mutation.kind === "UPDATE")
      next = {
        ...current,
        name: mutation.request.name,
        address: mutation.request.address,
        latitude: mutation.request.latitude,
        longitude: mutation.request.longitude,
        capabilities: mutation.request.capabilities,
        version: current.version + 1,
      };
    else {
      const status = mutation.request.action === "ACTIVATE" ? "active" : "inactive";
      if (current.status === status)
        return failure(
          "ILLEGAL_TRANSITION",
          "Location is already in that state",
          request.requestId,
        );
      next = { ...current, status, version: current.version + 1 };
    }
  }
  // Strip transport metadata before durable result and public response.
  next = adminLocationViewSchema.parse(next);
  if (
    next.purpose === "CENTRAL_WAREHOUSE" &&
    next.capabilities.some((cap) => !["RECEIVING", "INVENTORY", "PROCUREMENT"].includes(cap))
  )
    return failure(
      "VALIDATION_FAILED",
      "A central warehouse supports receiving and storage only",
      request.requestId,
    );
  if (
    next.status === "active" &&
    (!next.address ||
      (next.purpose === "CENTRAL_WAREHOUSE"
        ? !["RECEIVING", "INVENTORY"].every((cap) =>
            next.capabilities.some((value) => value === cap),
          )
        : !["PICKING", "PACKING", "DISPATCH"].every((cap) =>
            next.capabilities.some((value) => value === cap),
          )))
  )
    return failure(
      "CONFIGURATION_ERROR",
      "Confirm the address and required operating capabilities before activation",
      request.requestId,
    );

  const statements: D1PreparedStatement[] = [
    deps.db
      .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
      SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global'
      JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id
      JOIN permission p ON p.id=rp.permission_id WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='locations.manage'
    ) OR NOT EXISTS (SELECT 1 FROM market WHERE id=? AND status='active')`)
      .bind(permitted.staffId, permitted.authUserId, marketId),
    deps.db
      .prepare(
        "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','location',?,?)",
      )
      .bind(scope, idempotencyKey, hash, now, now),
  ];
  if (
    mutation.kind === "UPDATE" &&
    current &&
    (current.latitude !== next.latitude ||
      current.longitude !== next.longitude ||
      JSON.stringify(current.address) !== JSON.stringify(next.address))
  ) {
    // Origin changes must not silently relocate a delivery or a payment already underway.
    const originInUse = `EXISTS (SELECT 1 FROM delivery_job WHERE location_id=? AND status NOT IN ('DELIVERED','CANCELED'))
      OR EXISTS (SELECT 1 FROM checkout_quote quote JOIN payment_intent payment
        ON payment.subject_type='checkout_quote' AND payment.subject_id=quote.id
        AND payment.purpose='GROCERY_CHECKOUT' AND payment.status NOT IN ('FAILED','CANCELED')
        WHERE quote.status='ACTIVE' AND json_extract(quote.cycle_snapshot_json,'$.locationId')=?)`;
    if (
      await deps.db
        .prepare(`SELECT 1 blocked WHERE ${originInUse}`)
        .bind(locationId, locationId)
        .first()
    )
      return failure(
        "CONFLICT",
        "Resolve current deliveries or started payments before changing the pickup origin",
        request.requestId,
      );
    statements.push(
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE ${originInUse}`)
        .bind(locationId, locationId),
    );
  }
  if (mutation.kind === "CREATE")
    statements.push(
      deps.db
        .prepare(`INSERT INTO fulfillment_location
    (id,market_id,code,name,type,purpose,address_json,latitude,longitude,status,version,created_at,updated_at)
    VALUES (?,?,?,?,'FULFILLMENT_CENTER',?,?,?,?,'inactive',1,?,?)`)
        .bind(
          locationId,
          marketId,
          next.code,
          next.name,
          next.purpose,
          JSON.stringify(next.address),
          next.latitude,
          next.longitude,
          now,
          now,
        ),
    );
  else if (mutation.kind === "TRANSITION") {
    if (next.status === "active")
      statements.push(
        deps.db
          .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE
      (SELECT COUNT(DISTINCT capability) FROM location_capability WHERE location_id=? AND enabled=1
        AND ((?='CENTRAL_WAREHOUSE' AND capability IN ('RECEIVING','INVENTORY'))
          OR (?='CUSTOMER_FULFILLMENT' AND capability IN ('PICKING','PACKING','DISPATCH'))))<>?`)
          .bind(
            locationId,
            next.purpose,
            next.purpose,
            next.purpose === "CENTRAL_WAREHOUSE" ? 2 : 3,
          ),
      );
    statements.push(
      deps.db
        .prepare(
          "UPDATE fulfillment_location SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .bind(next.status, now, locationId, mutation.request.expectedVersion),
      deps.db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()=0"),
    );
  } else
    statements.push(
      deps.db
        .prepare(
          `UPDATE fulfillment_location SET name=?,address_json=?,latitude=?,longitude=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?`,
        )
        .bind(
          next.name,
          JSON.stringify(next.address),
          next.latitude,
          next.longitude,
          next.status,
          now,
          locationId,
          mutation.request.expectedVersion,
        ),
      deps.db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()=0"),
    );
  if (mutation.kind !== "TRANSITION") {
    statements.push(
      deps.db.prepare("DELETE FROM location_capability WHERE location_id=?").bind(locationId),
    );
    for (const capability of next.capabilities)
      statements.push(
        deps.db
          .prepare("INSERT INTO location_capability(location_id,capability,enabled) VALUES (?,?,1)")
          .bind(locationId, capability),
      );
  }
  if (mutation.kind !== "CREATE" && next.purpose === "CUSTOMER_FULFILLMENT") {
    // A changed origin/capability or newly active nearer site requires a fresh customer quote.
    // Already-started Payments retain their accepted terms and reconciliation path.
    statements.push(
      deps.db
        .prepare(`UPDATE checkout_quote SET status='SUPERSEDED',version=version+1,updated_at=?
      WHERE status='ACTIVE' AND json_extract(cycle_snapshot_json,'$.locationId') IN
        (SELECT id FROM fulfillment_location WHERE market_id=?)
      AND NOT EXISTS (SELECT 1 FROM payment_intent payment WHERE payment.purpose='GROCERY_CHECKOUT'
        AND payment.subject_type='checkout_quote' AND payment.subject_id=checkout_quote.id)`)
        .bind(now, marketId),
    );
  }
  statements.push(
    auditEventStatement(deps.db, {
      actorUserId: permitted.authUserId,
      action: `LOCATION.${mutation.kind === "TRANSITION" ? mutation.request.action : mutation.kind}`,
      resourceType: "fulfillment_location",
      resourceId: locationId,
      marketId,
      locationId,
      reason: request.reason,
      idempotencyKey,
      correlationId: request.requestId,
      occurredAt: now,
      // Protected address details are not copied into general audit projections.
      before: current ? { status: current.status, version: current.version } : null,
      after: {
        status: next.status,
        version: next.version,
        purpose: next.purpose,
        capabilities: next.capabilities,
      },
    }),
    deps.db
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=?",
      )
      .bind(JSON.stringify(next), now, scope, idempotencyKey),
  );
  try {
    await deps.db.batch(statements);
  } catch {
    const raced = await replay();
    if (raced) return raced;
    return failure("CONFLICT", "Location or access changed; refresh and review", request.requestId);
  }
  return { ok: true, value: next, requestId: request.requestId };
}

export async function createAdminLocation(
  deps: StaffAdministrationDeps,
  input: CreateAdminLocationRequest,
): Promise<RpcResult<AdminLocationView>> {
  const parsed = createSchema.safeParse(input);
  return parsed.success
    ? execute(deps, { kind: "CREATE", request: parsed.data })
    : failure(
        "VALIDATION_FAILED",
        "Check location details, coordinates and reason",
        input.requestId,
      );
}
export async function updateAdminLocation(
  deps: StaffAdministrationDeps,
  input: UpdateAdminLocationRequest,
): Promise<RpcResult<AdminLocationView>> {
  const parsed = updateSchema.safeParse(input);
  return parsed.success
    ? execute(deps, { kind: "UPDATE", request: parsed.data })
    : failure("VALIDATION_FAILED", "Check location details, version and reason", input.requestId);
}
export async function transitionAdminLocation(
  deps: StaffAdministrationDeps,
  input: TransitionAdminLocationRequest,
): Promise<RpcResult<AdminLocationView>> {
  const parsed = transitionSchema.safeParse(input);
  return parsed.success
    ? execute(deps, { kind: "TRANSITION", request: parsed.data })
    : failure(
        "VALIDATION_FAILED",
        "Check location transition, version and reason",
        input.requestId,
      );
}
