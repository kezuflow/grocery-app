import type { RefreshExternalDeliveryRequest } from "@freshmarkets/contracts";
import { applyProviderObservation } from "../../delivery/application/apply-provider-observation";
import type {
  AppErrorCode,
  ExternalDeliveryMutationRequest,
  ExternalDeliveryDispatchView,
  LocationDeliveryProfileView,
  RequestExternalDeliveryRequest,
  RpcResult,
  UpsertLocationDeliveryProfileRequest,
} from "@freshmarkets/contracts";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { claimCommandIdempotency, findIdempotencyRecord, requestHash } from "../../idempotency";
import { locationDeliveryProfileViewSchema } from "@freshmarkets/validation";
import { bookOrderDelivery } from "../../delivery/application/book-order-delivery";
import type { DeliveryProvider } from "../../delivery/ports/delivery-provider";
import type { ProviderDelivery } from "../../delivery/ports/delivery-provider";
import {
  resolveOperationsAdministrationAccess,
  type OperationsAdministrationDeps,
} from "./operations-administration-access";

type DeliveryProfileRow = {
  location_id: string;
  location_name: string;
  latitude: number;
  longitude: number;
  sender_name: string | null;
  phone_e164: string | null;
  email: string | null;
  formatted_address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  barangay: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
  pickup_instructions: string | null;
  profile_version: number | null;
};

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? "";
  return cleaned || null;
}

function profileView(row: DeliveryProfileRow): LocationDeliveryProfileView {
  const complete =
    row.sender_name !== null &&
    row.phone_e164 !== null &&
    row.formatted_address !== null &&
    row.address_line1 !== null &&
    row.city !== null &&
    row.country_code !== null &&
    row.profile_version !== null;
  return {
    locationId: row.location_id,
    locationName: row.location_name,
    coordinate: { latitude: row.latitude, longitude: row.longitude },
    profile: complete
      ? {
          senderName: row.sender_name!,
          phoneE164: row.phone_e164!,
          email: row.email,
          formattedAddress: row.formatted_address!,
          addressLine1: row.address_line1!,
          addressLine2: row.address_line2,
          barangay: row.barangay,
          city: row.city!,
          region: row.region,
          postalCode: row.postal_code,
          countryCode: row.country_code!,
          pickupInstructions: row.pickup_instructions,
          version: row.profile_version!,
        }
      : null,
  };
}

async function loadProfile(
  database: D1Database,
  locationId: string,
): Promise<LocationDeliveryProfileView | null> {
  const row = await database
    .prepare(
      `SELECT location.id AS location_id, location.name AS location_name,
              location.latitude, location.longitude,
              profile.sender_name, profile.phone_e164, profile.email,
              profile.formatted_address, profile.address_line1, profile.address_line2,
              profile.barangay, profile.city, profile.region, profile.postal_code,
              profile.country_code, profile.pickup_instructions,
              profile.version AS profile_version
       FROM fulfillment_location location
       LEFT JOIN fulfillment_location_delivery_profile profile
         ON profile.location_id=location.id
       WHERE location.id=?`,
    )
    .bind(locationId)
    .first<DeliveryProfileRow>();
  return row ? profileView(row) : null;
}

export async function getLocationDeliveryProfile(
  deps: OperationsAdministrationDeps,
  request: { requestId: string; headers: Readonly<Record<string, string>>; locationId: string },
): Promise<RpcResult<LocationDeliveryProfileView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.read",
    request.locationId,
    { concealOutOfScopeLocation: true },
  );
  if (!access.ok) return access;
  const view = await loadProfile(deps.db, request.locationId);
  return view
    ? { ok: true, value: view, requestId: request.requestId }
    : failure("NOT_FOUND", "Fulfillment location not found", request.requestId);
}

function completeIdempotency(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  now: number,
) {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, now, scope, key);
}

async function failIdempotency(database: D1Database, scope: string, key: string) {
  await database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED',updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

export async function upsertLocationDeliveryProfile(
  deps: OperationsAdministrationDeps,
  request: UpsertLocationDeliveryProfileRequest,
): Promise<RpcResult<LocationDeliveryProfileView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  const normalized = {
    senderName: request.senderName.trim(),
    phoneE164: request.phoneE164.trim(),
    email: cleanOptional(request.email)?.toLowerCase() ?? null,
    formattedAddress: request.formattedAddress.trim(),
    addressLine1: request.addressLine1.trim(),
    addressLine2: cleanOptional(request.addressLine2),
    barangay: cleanOptional(request.barangay),
    city: request.city.trim(),
    region: cleanOptional(request.region),
    postalCode: cleanOptional(request.postalCode),
    countryCode: request.countryCode.trim().toUpperCase(),
    pickupInstructions: cleanOptional(request.pickupInstructions),
  };
  const scope = "admin.delivery.locationProfile";
  const legacyHash = await requestHash({
    locationId: request.locationId,
    expectedVersion: request.expectedVersion,
    ...normalized,
  });
  const hash = await requestHash({
    actorAuthUserId: access.value.authUserId,
    locationId: request.locationId,
    expectedVersion: request.expectedVersion,
    ...normalized,
  });
  async function replay(): Promise<RpcResult<LocationDeliveryProfileView> | null> {
    const saved = await findIdempotencyRecord(deps.db, scope, request.idempotencyKey);
    if (!saved) return null;
    if (saved.requestHash !== hash && saved.requestHash !== legacyHash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Key belongs to a different pickup profile command",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED") return null;
    if (saved.resultReference === request.locationId && saved.requestHash === legacyHash) {
      const historical = await loadProfile(deps.db, request.locationId);
      return historical
        ? { ok: true, value: historical, requestId: request.requestId }
        : failure("CONFLICT", "Historical profile result is unavailable", request.requestId);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(saved.resultReference ?? "null");
    } catch {
      raw = null;
    }
    const parsed = locationDeliveryProfileViewSchema.safeParse(raw);
    return parsed.success
      ? { ok: true, value: parsed.data, requestId: request.requestId }
      : failure("CONFLICT", "Saved profile result needs recovery", request.requestId);
  }
  const prior = await replay();
  if (prior) return prior;
  const before = await loadProfile(deps.db, request.locationId);
  if (!before) return failure("NOT_FOUND", "Fulfillment location not found", request.requestId);
  const current = before.profile;
  if ((current?.version ?? 0) !== request.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Store pickup profile changed; refresh first",
      request.requestId,
    );
  const next = locationDeliveryProfileViewSchema.parse({
    ...before,
    profile: { ...normalized, version: request.expectedVersion + 1 },
  });
  const now = Date.now();
  const required = () =>
    deps.db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
  try {
    const mutation = current
      ? deps.db
          .prepare(
            `UPDATE fulfillment_location_delivery_profile
             SET sender_name=?,phone_e164=?,email=?,formatted_address=?,address_line1=?,
                 address_line2=?,barangay=?,city=?,region=?,postal_code=?,country_code=?,
                 pickup_instructions=?,version=version+1,updated_at=?
             WHERE location_id=? AND version=?`,
          )
          .bind(
            normalized.senderName,
            normalized.phoneE164,
            normalized.email,
            normalized.formattedAddress,
            normalized.addressLine1,
            normalized.addressLine2,
            normalized.barangay,
            normalized.city,
            normalized.region,
            normalized.postalCode,
            normalized.countryCode,
            normalized.pickupInstructions,
            now,
            request.locationId,
            request.expectedVersion,
          )
      : deps.db
          .prepare(
            `INSERT INTO fulfillment_location_delivery_profile
             (location_id,sender_name,phone_e164,email,formatted_address,address_line1,
              address_line2,barangay,city,region,postal_code,country_code,pickup_instructions,
              version,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          )
          .bind(
            request.locationId,
            normalized.senderName,
            normalized.phoneE164,
            normalized.email,
            normalized.formattedAddress,
            normalized.addressLine1,
            normalized.addressLine2,
            normalized.barangay,
            normalized.city,
            normalized.region,
            normalized.postalCode,
            normalized.countryCode,
            normalized.pickupInstructions,
            now,
            now,
          );
    await deps.db.batch([
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
        SELECT 1 FROM staff_identity s JOIN staff_role sr ON sr.staff_id=s.id
        JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
        JOIN staff_scope sc ON sc.staff_id=s.id JOIN fulfillment_location l ON l.id=?
        WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='delivery.manage'
        AND (sc.scope_kind='global' OR (sc.scope_kind='location' AND sc.location_id=l.id) OR (sc.scope_kind='market' AND sc.market_id=l.market_id))
        AND l.name=? AND l.latitude=? AND l.longitude=?)`)
        .bind(
          request.locationId,
          access.value.staffId,
          access.value.authUserId,
          before.locationName,
          before.coordinate.latitude,
          before.coordinate.longitude,
        ),
      deps.db
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
        VALUES (?,?,?,'PROCESSING','location_delivery_profile',?,?)
        ON CONFLICT(scope,idempotency_key) DO UPDATE SET request_hash=excluded.request_hash,status='PROCESSING',result_reference=NULL,updated_at=excluded.updated_at
        WHERE idempotency_records.status IN ('PROCESSING','FAILED') AND idempotency_records.request_hash IN (?,?) AND idempotency_records.result_reference IS NULL`)
        .bind(scope, request.idempotencyKey, hash, now, now, hash, legacyHash),
      required(),
      mutation,
      required(),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "DELIVERY.LOCATION_PROFILE_UPDATED",
        resourceType: "fulfillment_location_delivery_profile",
        resourceId: request.locationId,
        locationId: request.locationId,
        details: { expectedVersion: request.expectedVersion },
        idempotencyKey: request.idempotencyKey,
        correlationId: request.requestId,
        occurredAt: now,
      }),
      required(),
      completeIdempotency(deps.db, scope, request.idempotencyKey, JSON.stringify(next), now),
      required(),
    ]);
  } catch {
    const raced = await replay();
    return (
      raced ??
      failure("CONFLICT", "Store profile or access changed; refresh and review", request.requestId)
    );
  }
  return { ok: true, value: next, requestId: request.requestId };
}

export async function requestExternalDelivery(
  deps: OperationsAdministrationDeps & {
    provider: DeliveryProvider;
    configuredServiceType: string;
    now: () => number;
  },
  request: RequestExternalDeliveryRequest,
): Promise<RpcResult<ExternalDeliveryDispatchView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  return bookOrderDelivery(deps, request, access.value.authUserId);
}

async function loadExternalDispatch(
  database: D1Database,
  dispatchId: string,
  locationId: string,
): Promise<(ExternalDeliveryDispatchView & { providerDeliveryId: string | null }) | null> {
  return database
    .prepare(
      `SELECT dispatch.id AS dispatchId,dispatch.delivery_job_id AS deliveryJobId,
              dispatch.provider,dispatch.provider_delivery_id AS providerDeliveryId,
              dispatch.status,dispatch.provider_status AS providerStatus,
              dispatch.tracking_url AS trackingUrl,dispatch.pickup_pin AS pickupPin,
              dispatch.quote_amount_minor AS quoteAmountMinor,
              dispatch.quote_currency AS quoteCurrency,dispatch.attempt_count AS attemptCount,
              dispatch.last_error_code AS lastErrorCode,dispatch.version
       FROM delivery_provider_dispatch dispatch
       JOIN delivery_job job ON job.id=dispatch.delivery_job_id
       WHERE dispatch.id=? AND job.location_id=?`,
    )
    .bind(dispatchId, locationId)
    .first<ExternalDeliveryDispatchView & { providerDeliveryId: string | null }>();
}

async function providerMutation(
  deps: OperationsAdministrationDeps & { provider: DeliveryProvider; now: () => number },
  request: RefreshExternalDeliveryRequest,
  operation: "REFRESH" | "CANCEL",
): Promise<RpcResult<ExternalDeliveryDispatchView>> {
  const access = await resolveOperationsAdministrationAccess(
    deps,
    request,
    "delivery.manage",
    request.locationId,
  );
  if (!access.ok) return access;
  const scope = `admin.delivery.external${operation === "REFRESH" ? "Refresh" : "Cancel"}`;
  const claim = await claimCommandIdempotency(deps.db, deps.now, scope, request.idempotencyKey, {
    locationId: request.locationId,
    dispatchId: request.dispatchId,
    expectedVersion: request.expectedVersion,
    ...(request.providerDeliveryId ? { providerDeliveryId: request.providerDeliveryId } : {}),
  });
  if (!claim.claimed) {
    if (claim.existing?.requestHash !== claim.hash)
      return failure("IDEMPOTENCY_CONFLICT", "Idempotency key conflict", request.requestId);
    const replay = await loadExternalDispatch(deps.db, request.dispatchId, request.locationId);
    if (claim.existing?.status === "SUCCEEDED" && replay)
      return { ok: true, value: replay, requestId: request.requestId };
    return failure("CONFLICT", "The provider operation is still processing", request.requestId);
  }
  const current = await loadExternalDispatch(deps.db, request.dispatchId, request.locationId);
  if (!current) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure("NOT_FOUND", "External delivery was not found", request.requestId);
  }
  if (current.version !== request.expectedVersion) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure("STALE_VERSION", "External delivery changed; refresh first", request.requestId);
  }
  const providerDeliveryId = current.providerDeliveryId ?? request.providerDeliveryId;
  const recoveringIdentity = !current.providerDeliveryId;
  if (
    deps.provider.code !== current.provider ||
    (request.providerDeliveryId &&
      current.providerDeliveryId &&
      request.providerDeliveryId !== current.providerDeliveryId) ||
    !providerDeliveryId ||
    (recoveringIdentity &&
      (operation !== "REFRESH" ||
        !["CREATING", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"].includes(current.status)))
  ) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure("CONFLICT", "Provider delivery identity is unavailable", request.requestId);
  }
  const commandId = `delivery-command:${scope}:${request.idempotencyKey}`;
  let observationVersion = request.expectedVersion;
  if (operation === "CANCEL" && current.status !== "ACTIVE") {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    return failure(
      "CONFLICT",
      "An uncertain or closed delivery cannot be canceled again; reconcile it first",
      request.requestId,
    );
  }
  const intentStatements: D1PreparedStatement[] = [
    deps.db
      .prepare(
        "INSERT INTO commitment_abort(id) SELECT -33 WHERE NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch WHERE id=? AND version=?)",
      )
      .bind(request.dispatchId, request.expectedVersion),
  ];
  if (operation === "CANCEL") {
    intentStatements.push(
      deps.db
        .prepare(`UPDATE delivery_provider_dispatch SET status='OUTCOME_UNKNOWN',last_error_code='CANCEL_OUTCOME_UNKNOWN',version=version+1,updated_at=?
      WHERE id=? AND version=? AND status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM delivery_provider_command WHERE dispatch_id=? AND operation='CANCEL' AND status IN ('SUBMITTING','OUTCOME_UNKNOWN','OBSERVED'))`)
        .bind(deps.now(), request.dispatchId, request.expectedVersion, request.dispatchId),
      deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -33 WHERE changes()!=1"),
    );
    observationVersion += 1;
  }
  intentStatements.push(
    deps.db
      .prepare(`INSERT INTO delivery_provider_command
    (id,dispatch_id,operation,idempotency_scope,idempotency_key,request_hash,actor_user_id,location_id,request_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'SUBMITTING',?,?)
    ON CONFLICT(idempotency_scope,idempotency_key) DO UPDATE SET status='SUBMITTING',observation_id=NULL,updated_at=excluded.updated_at
      WHERE delivery_provider_command.status='REJECTED' AND delivery_provider_command.request_hash=excluded.request_hash`)
      .bind(
        commandId,
        request.dispatchId,
        operation,
        scope,
        request.idempotencyKey,
        claim.hash,
        access.value.authUserId,
        request.locationId,
        request.requestId,
        deps.now(),
        deps.now(),
      ),
    deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -33 WHERE changes()!=1"),
  );
  try {
    await deps.db.batch(intentStatements);
  } catch (error) {
    await failIdempotency(deps.db, scope, request.idempotencyKey);
    if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
      throw error;
    return failure(
      "STALE_VERSION",
      "Delivery changed before the provider operation",
      request.requestId,
    );
  }
  const reject = async (unknown: boolean) => {
    const statements = [
      deps.db
        .prepare(
          "UPDATE delivery_provider_command SET status=?,updated_at=? WHERE id=? AND status='SUBMITTING'",
        )
        .bind(unknown ? "OUTCOME_UNKNOWN" : "REJECTED", deps.now(), commandId),
    ];
    if (operation === "CANCEL" && !unknown)
      statements.push(
        deps.db
          .prepare(`UPDATE delivery_provider_dispatch
      SET status='ACTIVE',last_error_code='CANCEL_REJECTED',version=version+1,updated_at=? WHERE id=? AND version=? AND status='OUTCOME_UNKNOWN'`)
          .bind(deps.now(), request.dispatchId, observationVersion),
      );
    await deps.db.batch(statements);
    if (!unknown) await failIdempotency(deps.db, scope, request.idempotencyKey);
  };
  let observation: ProviderDelivery;
  if (operation === "CANCEL") {
    let canceled;
    try {
      canceled = await deps.provider.cancel(providerDeliveryId);
    } catch {
      await reject(true);
      return failure(
        "CONFLICT",
        "Provider cancellation outcome is unknown; refresh to reconcile",
        request.requestId,
      );
    }
    if (!canceled.ok) {
      await reject(canceled.error.outcomeUnknown);
      return failure("CONFLICT", "Provider cancellation was not confirmed", request.requestId);
    }
    observation = {
      providerDeliveryId,
      merchantOrderId: null,
      status: "CANCELED",
      trackingUrl: null,
      pickupPin: null,
      quote: null,
    };
  } else {
    let observed;
    try {
      observed = await deps.provider.get(providerDeliveryId);
    } catch {
      await reject(false);
      return failure("CONFLICT", "Provider delivery could not be refreshed", request.requestId);
    }
    if (!observed.ok || !observed.value) {
      await reject(false);
      return failure("CONFLICT", "Provider delivery could not be refreshed", request.requestId);
    }
    if (observed.value.providerDeliveryId !== providerDeliveryId) {
      await reject(false);
      return failure("CONFLICT", "Provider returned a different delivery", request.requestId);
    }
    if (recoveringIdentity) {
      const match = await deps.db
        .prepare("SELECT id FROM delivery_provider_dispatch WHERE id=? AND merchant_order_id=?")
        .bind(request.dispatchId, observed.value.merchantOrderId)
        .first();
      if (!observed.value.merchantOrderId || !match) {
        await reject(false);
        return failure(
          "CONFLICT",
          "Provider merchant reference does not match this booking",
          request.requestId,
        );
      }
    }
    observation = observed.value;
  }
  const alreadyCompleted = await deps.db
    .prepare("SELECT id FROM delivery_provider_command WHERE id=? AND status='SUCCEEDED'")
    .bind(commandId)
    .first();
  if (alreadyCompleted) {
    const completed = await loadExternalDispatch(deps.db, request.dispatchId, request.locationId);
    if (completed) return { ok: true, value: completed, requestId: request.requestId };
  }
  const now = deps.now();
  // Failed command retries must not attach new evidence to an older observation.
  const inboxId = `admin-delivery:${crypto.randomUUID()}`;
  const identityStatements: D1PreparedStatement[] = recoveringIdentity
    ? [
        deps.db
          .prepare(`UPDATE delivery_provider_dispatch SET provider_delivery_id=?,version=version+1,updated_at=?
      WHERE id=? AND version=? AND provider_delivery_id IS NULL AND status IN ('CREATING','OUTCOME_UNKNOWN','RECONCILIATION_REQUIRED')
        AND NOT EXISTS (SELECT 1 FROM delivery_provider_dispatch WHERE provider=? AND provider_delivery_id=?)`)
          .bind(
            providerDeliveryId,
            now,
            request.dispatchId,
            request.expectedVersion,
            current.provider,
            providerDeliveryId,
          ),
        deps.db.prepare("INSERT INTO commitment_abort(id) SELECT -33 WHERE changes()!=1"),
        deps.db
          .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=?
      WHERE scope='admin.delivery.externalDispatch' AND status IN ('PROCESSING','FAILED') AND idempotency_key=
        (SELECT client_idempotency_key FROM delivery_provider_dispatch WHERE id=?)`)
          .bind(request.dispatchId, now, request.dispatchId),
        deps.db
          .prepare(`INSERT INTO audit_event
      (id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,location_id,correlation_id,occurred_at)
      VALUES (?,?,'DELIVERY.EXTERNAL_PROVIDER_IDENTITY_RECOVERED','delivery_provider_dispatch',?, '{}',?,?,?,?)`)
          .bind(
            `delivery-identity:${request.dispatchId}`,
            access.value.authUserId,
            request.dispatchId,
            request.idempotencyKey,
            request.locationId,
            request.requestId,
            now,
          ),
      ]
    : [];
  if (recoveringIdentity) observationVersion += 1;
  try {
    await deps.db.batch([
      ...identityStatements,
      deps.db
        .prepare(`INSERT OR IGNORE INTO delivery_provider_event_inbox
    (id,provider,provider_event_id,dispatch_id,provider_delivery_id,merchant_order_id,observed_at,
     provider_status,payload_hash,raw_payload,processing_status,received_at)
    SELECT ?,provider,?,id,provider_delivery_id,merchant_order_id,?,?,?,?, 'RECEIVED',?
    FROM delivery_provider_dispatch WHERE id=?`)
        .bind(
          inboxId,
          inboxId,
          now,
          observation.status,
          await requestHash(observation),
          JSON.stringify(observation),
          now,
          request.dispatchId,
        ),
      deps.db
        .prepare(
          "UPDATE delivery_provider_command SET status='OBSERVED',observation_id=?,updated_at=? WHERE id=? AND status IN ('SUBMITTING','OUTCOME_UNKNOWN')",
        )
        .bind(inboxId, now, commandId),
    ]);
  } catch (error) {
    await reject(false);
    if (!(error instanceof Error) || !error.message.includes("CHECK constraint failed: id = 0"))
      throw error;
    return failure(
      "STALE_VERSION",
      "Delivery identity changed during recovery; refresh first",
      request.requestId,
    );
  }
  const applied = await applyProviderObservation(
    deps.db,
    {
      dispatchId: request.dispatchId,
      status: observation.status,
      observedAt: now,
      trackingUrl: observation.trackingUrl,
      pickupPin: observation.pickupPin,
    },
    {
      inboxId,
      expectedVersion: observationVersion,
    },
  );
  if (applied.outcome === "RECONCILIATION_REQUIRED") {
    return failure(
      applied.reason === "DELIVERY_DISPATCH_STALE" ? "STALE_VERSION" : "CONFLICT",
      "Provider evidence requires delivery reconciliation",
      request.requestId,
    );
  }
  const saved = await loadExternalDispatch(deps.db, request.dispatchId, request.locationId);
  if (!saved)
    return failure("INTERNAL_ERROR", "External delivery persistence failed", request.requestId);
  return { ok: true, value: saved, requestId: request.requestId };
}

export function refreshExternalDelivery(
  deps: OperationsAdministrationDeps & { provider: DeliveryProvider; now: () => number },
  request: RefreshExternalDeliveryRequest,
) {
  return providerMutation(deps, request, "REFRESH");
}

export function cancelExternalDelivery(
  deps: OperationsAdministrationDeps & { provider: DeliveryProvider; now: () => number },
  request: ExternalDeliveryMutationRequest,
) {
  return providerMutation(deps, request, "CANCEL");
}
