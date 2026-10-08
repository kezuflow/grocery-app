import type {
  AppErrorCode,
  ConfirmSharedDeliveryRequest,
  PrepareSharedDeliveryRequest,
  RpcResult,
  SharedDeliveryBookingView,
} from "@freshmarkets/contracts";
import { requestHash } from "../../idempotency";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "../../admin/application/operations-administration-access";
import {
  firstDispatchEligibility,
  dispatchUnavailableMessage,
} from "../domain/dispatch-eligibility";
import type {
  DeliveryProvider,
  DeliveryRouteRequest,
  DeliveryRouteQuote,
} from "../ports/delivery-provider";
import type { ProviderEvent } from "../ports/provider-event";
import { deliveryRetryReadySql, scheduledDeliveryDeadlineSql } from "./delivery-retry-readiness";
import {
  parseObject,
  nullableString,
  destinationComponents,
  deliveryInstructions,
  formattedDestination,
} from "./book-order-delivery";

export type SharedBookingDeps = OperationsAdministrationDeps & {
  provider: DeliveryProvider;
  configuredServiceType: string;
  now: () => number;
};
type Source = {
  job_id: string;
  order_id: string;
  order_number: string | null;
  job_version: number;
  order_version: number;
  fulfillment_version: number;
  stop_version: number;
  job_status: string;
  order_status: string;
  fulfillment_status: string;
  deadline: number | null;
  cycle_id: string | null;
  location_version: number;
  location_status: string;
  profile_version: number;
  latest_status: string | null;
  retry_ready: number;
  pending_cancel: number;
  latitude: number | null;
  longitude: number | null;
  address_snapshot_json: string;
  contact_snapshot_json: string;
  instructions_snapshot: string | null;
  sender_name: string;
  phone_e164: string;
  email: string | null;
  formatted_address: string;
  address_line1: string;
  address_line2: string | null;
  barangay: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  origin_latitude: number;
  origin_longitude: number;
  pickup_instructions: string | null;
  currency: string;
};
export type SharedBookingSnapshot = {
  rows: Source[];
  route: DeliveryRouteRequest;
  pickup: PrepareSharedDeliveryRequest["pickup"];
  lateDispatchReason: string | null;
};
export type SharedBookingRow = {
  id: string;
  location_id: string;
  merchant_order_id: string;
  prepare_hash: string;
  prepare_result_json: string | null;
  confirm_key: string | null;
  confirm_hash: string | null;
  confirm_result_json: string | null;
  request_snapshot_json: string;
  quotation_snapshot_json: string;
  status: SharedDeliveryBookingView["status"];
  version: number;
  provider_delivery_id: string | null;
  provider_status: string | null;
  provider_observed_at: number | null;
  driver_id: string | null;
  driver_observed_at: number | null;
  tracking_url: string | null;
  quote_amount_minor: number;
  final_payable_minor: number | null;
  cost_observed_at: number | null;
  expires_at: number;
  cancel_pending: number;
  last_error_code: string | null;
  route_review_required: number;
  custody_review_required: number;
  replacement_pending: number;
};
function failure(code: AppErrorCode, message: string, requestId: string): RpcResult<never> {
  return { ok: false, error: { code, message, requestId } };
}
export function sharedAccessGuard(db: D1Database, actorId: string, locationId: string) {
  return db
    .prepare(`INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (
    SELECT 1 FROM staff_identity staff JOIN staff_role sr ON sr.staff_id=staff.id
    JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
    JOIN staff_scope scope ON scope.staff_id=staff.id JOIN fulfillment_location location ON location.id=?
    WHERE staff.auth_user_id=? AND staff.status='active' AND p.code='delivery.manage'
      AND (scope.scope_kind='global' OR (scope.scope_kind='market' AND scope.market_id=location.market_id)
        OR (scope.scope_kind='location' AND scope.location_id=location.id)))`)
    .bind(locationId, actorId);
}
export function sharedConflict(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("CHECK constraint failed: id = 0") ||
      error.message.includes("UNIQUE constraint failed"))
  );
}
async function sources(db: D1Database, locationId: string, jobIds: readonly string[]) {
  return (
    await db
      .prepare(`SELECT job.id AS job_id,job.order_id,orders.order_number,job.version AS job_version,
    orders.version AS order_version,fulfillment.version AS fulfillment_version,stop.version AS stop_version,
    job.status AS job_status,orders.status AS order_status,fulfillment.status AS fulfillment_status,
    ${scheduledDeliveryDeadlineSql} AS deadline,job.cycle_id,location.version AS location_version,
    location.status AS location_status,profile.version AS profile_version,latest.status AS latest_status,
    CASE WHEN ${deliveryRetryReadySql} THEN 1 ELSE 0 END AS retry_ready,
    EXISTS (SELECT 1 FROM delivery_provider_command command JOIN delivery_provider_dispatch attempt ON attempt.id=command.dispatch_id
      WHERE attempt.delivery_job_id=job.id AND command.operation='CANCEL' AND command.status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED')) AS pending_cancel,
    stop.latitude,stop.longitude,stop.address_snapshot_json,stop.contact_snapshot_json,stop.instructions_snapshot,
    profile.sender_name,profile.phone_e164,profile.email,profile.formatted_address,profile.address_line1,profile.address_line2,
    profile.barangay,profile.city,profile.region,profile.postal_code,profile.country_code,
    location.latitude AS origin_latitude,location.longitude AS origin_longitude,profile.pickup_instructions,orders.currency
    FROM delivery_job job JOIN grocery_order orders ON orders.id=job.order_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=job.order_id AND fulfillment.location_id=job.location_id
    JOIN delivery_stop stop ON stop.delivery_job_id=job.id
    JOIN fulfillment_location location ON location.id=job.location_id
    JOIN fulfillment_location_delivery_profile profile ON profile.location_id=location.id
    LEFT JOIN delivery_provider_dispatch latest ON latest.id=(SELECT id FROM delivery_provider_dispatch WHERE delivery_job_id=job.id ORDER BY attempt_sequence DESC LIMIT 1)
    WHERE job.location_id=? AND job.fulfillment_mode='SCHEDULED' AND job.batch_id IS NULL AND job.rider_id IS NULL
      AND job.id IN (${jobIds.map(() => "?").join(",")}) ORDER BY job.id`)
      .bind(locationId, ...jobIds)
      .all<Source>()
  ).results;
}
function snapshot(
  rows: Source[],
  input: Pick<PrepareSharedDeliveryRequest, "pickup" | "optimize" | "lateDispatchReason">,
  serviceType: string,
): SharedBookingSnapshot | null {
  const first = rows[0];
  if (
    !first ||
    rows.some(
      (row) =>
        row.currency !== "PHP" ||
        !row.sender_name ||
        !row.phone_e164 ||
        !row.formatted_address ||
        !row.address_line1 ||
        !row.city ||
        !row.country_code ||
        row.location_status !== "active",
    )
  )
    return null;
  const destinations: DeliveryRouteRequest["destinations"][number][] = [];
  for (const row of rows) {
    const rawAddress = parseObject(row.address_snapshot_json);
    const address = rawAddress ? destinationComponents(rawAddress) : null;
    const rawContact = parseObject(row.contact_snapshot_json);
    const name = nullableString(rawContact, "recipient");
    const phoneE164 = nullableString(rawContact, "phone");
    const instructions = deliveryInstructions(row.instructions_snapshot);
    if (
      !address ||
      !name ||
      !phoneE164 ||
      !instructions ||
      row.latitude === null ||
      row.longitude === null
    )
      return null;
    destinations.push({
      reference: row.job_id,
      address: {
        formattedAddress: formattedDestination(address),
        coordinate: { latitude: row.latitude, longitude: row.longitude },
        components: address,
        instructions,
      },
      recipient: { name, phoneE164, email: null, smsEnabled: false },
    });
  }
  const pickupAt = input.pickup.kind === "SCHEDULED" ? Date.parse(input.pickup.pickupAt) : null;
  return {
    rows,
    pickup: input.pickup,
    lateDispatchReason: input.lateDispatchReason?.trim() || null,
    route: {
      serviceType,
      currencyCode: "PHP",
      currencyExponent: 2,
      optimize: input.optimize,
      packages: [
        {
          kind: "BOX",
          name: "FreshMarkets packed orders",
          description: "Combined Motorcycle load",
          quantity: 1,
          weightGrams: 20000,
          priceMinor: null,
        },
      ],
      sender: {
        name: first.sender_name,
        phoneE164: first.phone_e164,
        email: first.email,
        smsEnabled: false,
      },
      origin: {
        formattedAddress: first.formatted_address,
        coordinate: { latitude: first.origin_latitude, longitude: first.origin_longitude },
        components: {
          addressLine1: first.address_line1,
          addressLine2: first.address_line2,
          barangay: first.barangay,
          city: first.city,
          region: first.region,
          postalCode: first.postal_code,
          countryCode: first.country_code,
        },
        instructions: { deliveryInstructions: first.pickup_instructions },
      },
      destinations,
      schedule:
        pickupAt === null
          ? null
          : {
              pickupFrom: new Date(pickupAt).toISOString(),
              pickupTo: new Date(pickupAt + 1800000).toISOString(),
            },
    },
  };
}
function unavailable(
  rows: Source[],
  input: { pickup: PrepareSharedDeliveryRequest["pickup"]; lateDispatchReason?: string | null },
  now: number,
): string | null {
  const pickupAt = input.pickup.kind === "SCHEDULED" ? Date.parse(input.pickup.pickupAt) : null;
  if (pickupAt !== null && (!Number.isFinite(pickupAt) || pickupAt <= now))
    return "Choose a future rider pickup time.";
  for (const row of rows) {
    const eligible = firstDispatchEligibility({
      canManage: true,
      fulfillmentMode: "SCHEDULED",
      jobStatus: row.job_status,
      orderStatus: row.order_status,
      fulfillmentStatus: row.fulfillment_status,
      pendingCancellation: !!row.pending_cancel,
      latestAttempt: row.latest_status ? { status: row.latest_status } : null,
      retryReady: !!row.retry_ready,
      deliveryDeadline: row.deadline,
      now,
    });
    if (!eligible.eligible) return dispatchUnavailableMessage(eligible);
    if (
      row.deadline !== null &&
      (now >= row.deadline || (pickupAt !== null && pickupAt > row.deadline)) &&
      !input.lateDispatchReason?.trim()
    )
      return "Enter a reason for the late Scheduled orders before reviewing the booking.";
  }
  return null;
}
function memberGuard(
  db: D1Database,
  row: Source,
  locationId: string,
  pickupAt: number | null,
  lateReason: string | null,
  now: number,
) {
  return db
    .prepare(`INSERT INTO commitment_abort(id) SELECT -32 WHERE NOT EXISTS (
    SELECT 1 FROM delivery_job job JOIN grocery_order orders ON orders.id=job.order_id
    JOIN fulfillment_record fulfillment ON fulfillment.order_id=job.order_id AND fulfillment.location_id=job.location_id
    JOIN delivery_stop stop ON stop.delivery_job_id=job.id
    JOIN fulfillment_location location ON location.id=job.location_id
    JOIN fulfillment_location_delivery_profile profile ON profile.location_id=job.location_id
    WHERE job.id=? AND job.location_id=? AND job.fulfillment_mode='SCHEDULED' AND job.version=?
      AND orders.version=? AND fulfillment.version=? AND stop.version=? AND profile.version=? AND location.version=? AND location.status='active'
      AND orders.status='FULFILLMENT_READY' AND fulfillment.status='PACKED' AND job.batch_id IS NULL AND job.rider_id IS NULL
      AND ((job.status IN ('UNASSIGNED','RETRY_SCHEDULED') AND NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch WHERE delivery_job_id=job.id)) OR (${deliveryRetryReadySql}))
      AND ${scheduledDeliveryDeadlineSql}=?
      AND (? IS NOT NULL OR (${scheduledDeliveryDeadlineSql}>? AND (? IS NULL OR ?<=${scheduledDeliveryDeadlineSql})))
      AND (? IS NULL OR ?>?)
      AND NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch attempt WHERE attempt.delivery_job_id=job.id
        AND attempt.status NOT IN ('COMPLETED','CANCELED','RETURNED','FAILED')))
  `)
    .bind(
      row.job_id,
      locationId,
      row.job_version,
      row.order_version,
      row.fulfillment_version,
      row.stop_version,
      row.profile_version,
      row.location_version,
      row.deadline,
      lateReason,
      now,
      pickupAt,
      pickupAt,
      pickupAt,
      pickupAt,
      now,
    );
}
export async function loadSharedBooking(db: D1Database, id: string, locationId?: string) {
  return db
    .prepare(
      `SELECT * FROM delivery_shared_booking WHERE id=?${locationId ? " AND location_id=?" : ""}`,
    )
    .bind(id, ...(locationId ? [locationId] : []))
    .first<SharedBookingRow>();
}
export async function sharedBookingView(
  db: D1Database,
  row: SharedBookingRow,
): Promise<SharedDeliveryBookingView> {
  const saved = JSON.parse(row.request_snapshot_json) as SharedBookingSnapshot;
  const members = (
    await db
      .prepare(
        "SELECT job_id,provider_position,outcome FROM delivery_shared_booking_member WHERE booking_id=? ORDER BY provider_position",
      )
      .bind(row.id)
      .all<{ job_id: string; provider_position: number; outcome: string }>()
  ).results;
  return {
    bookingId: row.id,
    locationId: row.location_id,
    status: row.status,
    version: row.version,
    providerStatus: row.provider_status,
    pickup: saved.pickup,
    optimized: saved.route.optimize,
    quoteAmountMinor: row.quote_amount_minor,
    actualCostMinor: row.final_payable_minor,
    currency: "PHP",
    expiresAt: new Date(row.expires_at).toISOString(),
    stops: members.map((member) => {
      const source = saved.rows.find((candidate) => candidate.job_id === member.job_id)!;
      const destination = saved.route.destinations.find(
        (candidate) => candidate.reference === member.job_id,
      )!;
      return {
        jobId: source.job_id,
        orderId: source.order_id,
        orderNumber: source.order_number ?? source.order_id,
        recipientName: destination.recipient.name,
        destinationLabel: destination.address.formattedAddress,
        position: member.provider_position,
        status: member.outcome,
      };
    }),
  };
}

export async function prepareSharedDelivery(
  deps: SharedBookingDeps,
  input: PrepareSharedDeliveryRequest,
): Promise<RpcResult<SharedDeliveryBookingView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    input,
    "delivery.manage",
    input.locationId,
  );
  if (!access.ok) return access;
  if (
    !deps.provider.quoteRoute ||
    !deps.provider.createRoute ||
    deps.provider.code !== "lalamove" ||
    deps.configuredServiceType !== "MOTORCYCLE"
  )
    return failure(
      "CONFIGURATION_ERROR",
      "Shared Lalamove Motorcycle booking is unavailable",
      input.requestId,
    );
  if (
    input.jobs.length < 2 ||
    input.jobs.length > 5 ||
    new Set(input.jobs.map((job) => job.jobId)).size !== input.jobs.length
  )
    return failure(
      "VALIDATION_FAILED",
      "Select two through five different Scheduled orders",
      input.requestId,
    );
  const intent = {
    locationId: input.locationId,
    jobs: [...input.jobs].sort((a, b) => a.jobId.localeCompare(b.jobId)),
    pickup: input.pickup,
    optimize: input.optimize,
    lateDispatchReason: input.lateDispatchReason?.trim() ?? null,
  };
  const hash = await requestHash(intent);
  const prior = await deps.db
    .prepare("SELECT * FROM delivery_shared_booking WHERE prepare_key=?")
    .bind(input.idempotencyKey)
    .first<SharedBookingRow>();
  if (prior) {
    if (prior.prepare_hash !== hash || prior.location_id !== input.locationId)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "The review key belongs to another selection",
        input.requestId,
      );
    if (!prior.prepare_result_json)
      return failure("CONFLICT", "This review is still being prepared", input.requestId);
    return {
      ok: true,
      value: JSON.parse(prior.prepare_result_json) as SharedDeliveryBookingView,
      requestId: input.requestId,
    };
  }
  const rows = await sources(
    deps.db,
    input.locationId,
    intent.jobs.map((job) => job.jobId),
  );
  if (rows.length !== input.jobs.length)
    return failure(
      "NOT_FOUND",
      "One or more Scheduled deliveries are unavailable in this location",
      input.requestId,
    );
  if (
    rows.some(
      (row) =>
        input.jobs.find((job) => job.jobId === row.job_id)?.expectedVersion !== row.job_version,
    )
  )
    return failure(
      "STALE_VERSION",
      "A selected order changed; refresh and select it again",
      input.requestId,
    );
  const blocker = unavailable(rows, input, deps.now());
  if (blocker) return failure("ILLEGAL_TRANSITION", blocker, input.requestId);
  const saved = snapshot(rows, input, deps.configuredServiceType);
  if (!saved)
    return failure(
      "CONFIGURATION_ERROR",
      "Courier pickup or recipient details are incomplete",
      input.requestId,
    );
  const result = await deps.provider.quoteRoute(saved.route);
  if (!result.ok)
    return failure(
      "CONFLICT",
      "Lalamove could not quote the selected deliveries. Review the selection and try again.",
      input.requestId,
    );
  const quotation = result.value;
  const expiry = Date.parse(quotation.quote.expiresAt ?? "");
  if (
    quotation.stops.length !== rows.length ||
    new Set(quotation.stops.map((stop) => stop.reference)).size !== rows.length ||
    quotation.stops.some(
      (stop) =>
        !rows.some((row) => row.job_id === stop.reference) ||
        !stop.stopId ||
        stop.position < 1 ||
        stop.position > rows.length,
    ) ||
    new Set(quotation.stops.map((stop) => stop.position)).size !== rows.length ||
    new Set([quotation.pickupStopId, ...quotation.stops.map((stop) => stop.stopId)]).size !==
      rows.length + 1 ||
    quotation.quote.serviceType !== deps.configuredServiceType ||
    !Number.isSafeInteger(quotation.quote.amountMinor) ||
    quotation.quote.amountMinor < 0
  )
    return failure(
      "CONFLICT",
      "Lalamove returned an inconsistent route; request a new review",
      input.requestId,
    );
  if (
    !Number.isFinite(expiry) ||
    expiry <= deps.now() + 15000 ||
    quotation.quote.currency !== "PHP"
  )
    return failure(
      "CONFLICT",
      "The courier quote has expired; request a new review",
      input.requestId,
    );
  const id = crypto.randomUUID();
  const now = deps.now();
  const pickupAt = saved.route.schedule ? Date.parse(saved.route.schedule.pickupFrom) : null;
  const value: SharedDeliveryBookingView = {
    bookingId: id,
    locationId: input.locationId,
    status: "PREPARED",
    version: 1,
    providerStatus: null,
    pickup: saved.pickup,
    optimized: saved.route.optimize,
    quoteAmountMinor: quotation.quote.amountMinor,
    actualCostMinor: null,
    currency: "PHP",
    expiresAt: new Date(expiry).toISOString(),
    stops: quotation.stops
      .map((stop) => {
        const source = rows.find((candidate) => candidate.job_id === stop.reference)!;
        const destination = saved.route.destinations.find(
          (candidate) => candidate.reference === stop.reference,
        )!;
        return {
          jobId: source.job_id,
          orderId: source.order_id,
          orderNumber: source.order_number ?? source.order_id,
          recipientName: destination.recipient.name,
          destinationLabel: destination.address.formattedAddress,
          position: stop.position,
          status: "PENDING",
        };
      })
      .sort((a, b) => a.position - b.position),
  };
  try {
    await deps.db.batch([
      sharedAccessGuard(deps.db, access.value.authUserId, input.locationId),
      ...rows.map((row) =>
        memberGuard(deps.db, row, input.locationId, pickupAt, saved.lateDispatchReason, now),
      ),
      deps.db
        .prepare(`INSERT INTO delivery_shared_booking(id,location_id,provider,merchant_order_id,prepare_key,prepare_hash,prepare_result_json,request_snapshot_json,quotation_snapshot_json,status,quote_amount_minor,currency,expires_at,created_at,updated_at)
        VALUES (?,?,'lalamove',?,?,?,?,?,?,'PREPARED',?,'PHP',?,?,?)`)
        .bind(
          id,
          input.locationId,
          `fm-shared-${id}`,
          input.idempotencyKey,
          hash,
          JSON.stringify(value),
          JSON.stringify(saved),
          JSON.stringify(quotation),
          quotation.quote.amountMinor,
          expiry,
          now,
          now,
        ),
      ...quotation.stops.map((stop) =>
        deps.db
          .prepare(
            `INSERT INTO delivery_shared_booking_member(booking_id,job_id,provider_stop_id,provider_position,source_snapshot_json) VALUES (?,?,?,?,?)`,
          )
          .bind(
            id,
            stop.reference,
            stop.stopId,
            stop.position,
            JSON.stringify(rows.find((row) => row.job_id === stop.reference)),
          ),
      ),
    ]);
  } catch (error) {
    if (!sharedConflict(error)) throw error;
    const replay = await deps.db
      .prepare(
        "SELECT prepare_hash,prepare_result_json FROM delivery_shared_booking WHERE prepare_key=? AND location_id=?",
      )
      .bind(input.idempotencyKey, input.locationId)
      .first<{ prepare_hash: string; prepare_result_json: string | null }>();
    if (replay?.prepare_hash === hash && replay.prepare_result_json)
      return {
        ok: true,
        value: JSON.parse(replay.prepare_result_json) as SharedDeliveryBookingView,
        requestId: input.requestId,
      };
    return failure(
      "STALE_VERSION",
      "The selection or access changed during quotation; refresh and review again",
      input.requestId,
    );
  }
  return { ok: true, value, requestId: input.requestId };
}

export async function confirmSharedDelivery(
  deps: SharedBookingDeps,
  input: ConfirmSharedDeliveryRequest,
): Promise<RpcResult<SharedDeliveryBookingView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    input,
    "delivery.manage",
    input.locationId,
  );
  if (!access.ok) return access;
  const row = await loadSharedBooking(deps.db, input.bookingId, input.locationId);
  if (!row) return failure("NOT_FOUND", "Shared booking not found", input.requestId);
  const hash = await requestHash({
    bookingId: input.bookingId,
    locationId: input.locationId,
    expectedVersion: input.expectedVersion,
    combinedLoadFits: input.combinedLoadFits,
  });
  if (row.confirm_key !== null) {
    if (row.confirm_key !== input.idempotencyKey || row.confirm_hash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This shared booking already has another submission",
        input.requestId,
      );
    if (row.confirm_result_json)
      return {
        ok: true,
        value: JSON.parse(row.confirm_result_json) as SharedDeliveryBookingView,
        requestId: input.requestId,
      };
    return failure(
      "CONFLICT",
      row.status === "FAILED"
        ? "The booking was rejected; prepare a new selection"
        : "Await provider confirmation. Do not submit another booking for these orders.",
      input.requestId,
    );
  }
  if (input.combinedLoadFits !== true)
    return failure(
      "VALIDATION_FAILED",
      "Confirm that all packages fit one Motorcycle",
      input.requestId,
    );
  if (
    !deps.provider.createRoute ||
    row.status !== "PREPARED" ||
    row.version !== input.expectedVersion ||
    row.expires_at <= deps.now() + 15000
  )
    return failure(
      "STALE_VERSION",
      "The booking or quote changed; review a fresh courier quote",
      input.requestId,
    );
  const saved = JSON.parse(row.request_snapshot_json) as SharedBookingSnapshot;
  const quotation = JSON.parse(row.quotation_snapshot_json) as DeliveryRouteQuote;
  if (saved.route.serviceType !== deps.configuredServiceType)
    return failure(
      "STALE_VERSION",
      "Courier service configuration changed; review again",
      input.requestId,
    );
  const blocker = unavailable(saved.rows, saved, deps.now());
  if (blocker) return failure("ILLEGAL_TRANSITION", blocker, input.requestId);
  const now = deps.now();
  const pickupAt = saved.route.schedule ? Date.parse(saved.route.schedule.pickupFrom) : null;
  try {
    await deps.db.batch([
      sharedAccessGuard(deps.db, access.value.authUserId, input.locationId),
      ...saved.rows.map((source) =>
        memberGuard(deps.db, source, input.locationId, pickupAt, saved.lateDispatchReason, now),
      ),
      deps.db
        .prepare(
          `UPDATE delivery_shared_booking SET status='CREATING',confirm_key=?,confirm_hash=?,combined_load_confirmed_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='PREPARED' AND confirm_key IS NULL AND expires_at>?`,
        )
        .bind(input.idempotencyKey, hash, now, now, row.id, input.expectedVersion, now + 15000),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      ...saved.rows.flatMap((source) => {
        const dispatchId = `shared-attempt:${row.id}:${source.job_id}`;
        return [
          deps.db
            .prepare(`INSERT INTO delivery_provider_dispatch(id,delivery_job_id,provider,merchant_order_id,request_hash,request_snapshot_json,status,attempt_count,version,created_at,updated_at,client_idempotency_key,attempt_sequence,shared_booking_id,pickup_timing,scheduled_pickup_at)
            SELECT ?,job.id,'lalamove',?,?,?,'CREATING',1,1,?,?,?,COALESCE((SELECT MAX(attempt_sequence) FROM delivery_provider_dispatch WHERE delivery_job_id=job.id),0)+1,?,?,? FROM delivery_job job WHERE job.id=?`)
            .bind(
              dispatchId,
              `${row.merchant_order_id}:${source.job_id}`,
              hash,
              JSON.stringify({ sharedBookingId: row.id, jobId: source.job_id }),
              now,
              now,
              `${input.idempotencyKey}:${source.job_id}`,
              row.id,
              saved.pickup.kind,
              pickupAt,
              source.job_id,
            ),
          deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
          deps.db
            .prepare(
              "UPDATE delivery_shared_booking_member SET dispatch_id=? WHERE booking_id=? AND job_id=? AND dispatch_id IS NULL",
            )
            .bind(dispatchId, row.id, source.job_id),
          deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
          deps.db
            .prepare(
              `UPDATE delivery_job SET version=version+1,updated_at=? WHERE id=? AND version=?`,
            )
            .bind(now, source.job_id, source.job_version),
          deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
          deps.db
            .prepare(`INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,correlation_id,occurred_at)
            VALUES (?,?,'DELIVERY.SHARED_BOOKING_ADMITTED','delivery_provider_dispatch',?,?,?,?,?,?)`)
            .bind(
              `shared-admission:${dispatchId}`,
              access.value.authUserId,
              dispatchId,
              JSON.stringify({
                bookingId: row.id,
                memberCount: saved.rows.length,
                combinedLoadFits: true,
                lateDispatchReason: saved.lateDispatchReason,
              }),
              `${input.idempotencyKey}:${source.job_id}`,
              input.locationId,
              input.requestId,
              now,
            ),
        ];
      }),
    ]);
  } catch (error) {
    if (!sharedConflict(error)) throw error;
    return failure(
      "STALE_VERSION",
      "A selected order or access changed. No courier was requested; refresh and review again.",
      input.requestId,
    );
  }
  const created = await deps.provider.createRoute({
    route: saved.route,
    quotation,
    merchantOrderId: row.merchant_order_id,
  });
  if (!created.ok) {
    const status = created.error.outcomeUnknown ? "OUTCOME_UNKNOWN" : "FAILED";
    await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE delivery_shared_booking SET status=?,last_error_code=?,version=version+1,updated_at=? WHERE id=? AND status='CREATING'",
        )
        .bind(status, created.error.code, deps.now(), row.id),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      deps.db
        .prepare(
          "UPDATE delivery_provider_dispatch SET status=?,last_error_code=?,version=version+1,updated_at=? WHERE shared_booking_id=? AND status='CREATING'",
        )
        .bind(status, created.error.code, deps.now(), row.id),
      deps.db
        .prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=?")
        .bind(saved.rows.length),
    ]);
    return failure(
      "CONFLICT",
      created.error.outcomeUnknown
        ? "The rider booking may exist. Refresh provider confirmation before requesting another."
        : "Lalamove rejected the booking. Prepare a new review before retrying.",
      input.requestId,
    );
  }
  const costEvidence = created.value.evidence?.find((item) => item.kind === "COST")?.value;
  const cost =
    costEvidence && typeof costEvidence === "object" && !Array.isArray(costEvidence)
      ? (costEvidence as Record<string, unknown>)
      : null;
  const actualCostMinor =
    cost?.currency === "PHP" &&
    Number.isSafeInteger(cost.amountMinor) &&
    Number(cost.amountMinor) >= 0
      ? Number(cost.amountMinor)
      : null;
  const confirmed: SharedDeliveryBookingView = {
    ...(await sharedBookingView(deps.db, row)),
    status: "ACTIVE",
    version: row.version + 2,
    providerStatus: created.value.status,
    actualCostMinor,
  };
  try {
    await deps.db.batch([
      deps.db
        .prepare(
          `UPDATE delivery_shared_booking SET provider_delivery_id=?,provider_status=?,driver_id=?,tracking_url=?,final_payable_minor=?,cost_observed_at=?,status='ACTIVE',confirm_result_json=?,version=version+1,updated_at=? WHERE id=? AND status='CREATING' AND version=?`,
        )
        .bind(
          created.value.providerDeliveryId,
          created.value.status,
          created.value.driverId ?? null,
          created.value.trackingUrl,
          actualCostMinor,
          actualCostMinor === null ? null : deps.now(),
          JSON.stringify(confirmed),
          deps.now(),
          row.id,
          row.version + 1,
        ),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=1"),
      deps.db
        .prepare(
          "INSERT INTO delivery_shared_booking_identity(provider_delivery_id,booking_id,observed_at) VALUES (?,?,?)",
        )
        .bind(created.value.providerDeliveryId, row.id, deps.now()),
      deps.db
        .prepare(
          "UPDATE delivery_provider_dispatch SET status='ACTIVE',provider_status=?,driver_id=?,version=version+1,updated_at=? WHERE shared_booking_id=? AND status='CREATING'",
        )
        .bind(created.value.status, created.value.driverId ?? null, deps.now(), row.id),
      deps.db
        .prepare("INSERT INTO commitment_abort(id) SELECT -32 WHERE changes()!=?")
        .bind(saved.rows.length),
      deps.db
        .prepare(`INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,correlation_id,occurred_at)
        VALUES (?,?,'DELIVERY.SHARED_BOOKING_REQUESTED','delivery_shared_booking',?,?,?,?,?,?)`)
        .bind(
          `shared-result:${row.id}`,
          access.value.authUserId,
          row.id,
          JSON.stringify({ memberCount: saved.rows.length }),
          input.idempotencyKey,
          input.locationId,
          input.requestId,
          deps.now(),
        ),
    ]);
  } catch (error) {
    // The provider has accepted the mutation. Preserve its protected response for internal repair.
    const event: ProviderEvent = {
      eventId: `shared-create:${row.id}`,
      kind: "STATUS",
      providerDeliveryId: created.value.providerDeliveryId,
      merchantOrderId: row.merchant_order_id,
      observedAt: deps.now(),
      status: created.value.status,
      driverId: created.value.driverId,
      trackingUrl: created.value.trackingUrl,
      evidence: created.value.evidence,
      observedStops: created.value.observedStops,
    };
    await deps.db
      .prepare(`INSERT OR IGNORE INTO delivery_provider_event_inbox(id,provider,provider_event_id,shared_booking_id,provider_delivery_id,merchant_order_id,observed_at,provider_status,payload_hash,raw_payload,normalized_event_json,processing_status,received_at)
      VALUES (?,'lalamove',?,?,?,?,?,?,?,?,?,'RECONCILIATION_REQUIRED',?)`)
      .bind(
        `shared-create:${row.id}`,
        `shared-create:${row.id}`,
        row.id,
        created.value.providerDeliveryId,
        row.merchant_order_id,
        deps.now(),
        created.value.status,
        await requestHash(created.value),
        JSON.stringify(created.value),
        JSON.stringify(event),
        deps.now(),
      )
      .run();
    await deps.db.batch([
      deps.db
        .prepare(
          "UPDATE delivery_shared_booking SET status='OUTCOME_UNKNOWN',last_error_code='DELIVERY_RESULT_RECONCILIATION_REQUIRED',updated_at=? WHERE id=? AND status='CREATING'",
        )
        .bind(deps.now(), row.id),
      deps.db
        .prepare(
          "UPDATE delivery_provider_dispatch SET status='OUTCOME_UNKNOWN',last_error_code='DELIVERY_RESULT_RECONCILIATION_REQUIRED' WHERE shared_booking_id=? AND status='CREATING'",
        )
        .bind(row.id),
    ]);
    if (!(error instanceof Error)) throw error;
    return failure(
      "CONFLICT",
      "The courier accepted the booking; saved provider evidence requires reconciliation. Do not rebook.",
      input.requestId,
    );
  }
  return { ok: true, value: confirmed, requestId: input.requestId };
}
