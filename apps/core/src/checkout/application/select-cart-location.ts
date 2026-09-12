import { drizzle } from "drizzle-orm/d1";
import type {
  AppErrorCode,
  CartLocationSelection,
  RpcResult,
  SelectCartLocationRequest,
} from "@freshmarkets/contracts";
import { activeMarketCode } from "../../geography/market-defaults";
import { resolveServiceability } from "../../geography/serviceability";
import { findIdempotencyRecord, requestHash } from "../../idempotency";

const SCOPE = "cart.selectLocation";

/** Select a geographically resolved site without granting checkout eligibility. */
export async function selectCartLocation(
  database: D1Database,
  input: SelectCartLocationRequest & { customerId: string },
): Promise<RpcResult<CartLocationSelection>> {
  const fail = (code: AppErrorCode, message: string): RpcResult<CartLocationSelection> => ({
    ok: false,
    error: { code, message, requestId: input.requestId },
  });
  const hash = await requestHash({
    customerId: input.customerId,
    latitude: input.latitude,
    longitude: input.longitude,
    expectedVersion: input.expectedVersion,
  });
  const replay = await findIdempotencyRecord(database, SCOPE, input.idempotencyKey);
  if (replay) {
    if (replay.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to a different location selection.");
    if (replay.status !== "SUCCEEDED" || !replay.resultReference)
      return fail("CONFLICT", "Location selection is still processing.");
    return {
      ok: true,
      value: JSON.parse(replay.resultReference) as CartLocationSelection,
      requestId: input.requestId,
    };
  }
  const marketCode = await activeMarketCode(database);
  if (!marketCode) return fail("CONFIGURATION_ERROR", "The delivery market is not configured.");
  const revision = await database
    .prepare(
      "SELECT g.market_id,g.version FROM geography_configuration g JOIN market m ON m.id=g.market_id WHERE m.code=? AND m.status='active'",
    )
    .bind(marketCode)
    .first<{ market_id: string; version: number }>();
  if (!revision) return fail("CONFIGURATION_ERROR", "Delivery locations are not configured.");
  const resolved = await resolveServiceability(drizzle(database), {
    latitude: input.latitude,
    longitude: input.longitude,
    marketCode,
    requestId: input.requestId,
  });
  if (!resolved.ok) return resolved;
  const location = resolved.value.fulfillmentLocation;
  if (!resolved.value.serviceable || !location)
    return fail("ADDRESS_UNSERVICEABLE", "No fulfillment location is currently available.");
  const cart = await database
    .prepare("SELECT id,version FROM cart WHERE customer_id=? AND status='ACTIVE'")
    .bind(input.customerId)
    .first<{ id: string; version: number }>();
  if ((cart?.version ?? 0) !== input.expectedVersion)
    return fail(
      "CART_VERSION_CONFLICT",
      "Your cart changed. Review it before changing delivery location.",
    );
  const now = Date.now();
  const value = {
    cartId: cart?.id ?? crypto.randomUUID(),
    version: input.expectedVersion + 1,
    locationId: location.id,
  };
  try {
    await database.batch([
      database
        .prepare(
          "INSERT OR IGNORE INTO idempotency_records (scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES (?,?,?,'cart_location','PROCESSING',?,?)",
        )
        .bind(SCOPE, input.idempotencyKey, hash, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -6 WHERE changes()=0"),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -6 WHERE NOT EXISTS (
        SELECT 1 FROM geography_configuration g JOIN market m ON m.id=g.market_id AND m.status='active'
        JOIN fulfillment_location l ON l.market_id=g.market_id
        WHERE g.market_id=? AND g.version=? AND l.id=? AND l.status='active' AND l.purpose='CUSTOMER_FULFILLMENT'
        AND (SELECT COUNT(DISTINCT capability) FROM location_capability WHERE location_id=l.id AND enabled=1 AND capability IN ('PICKING','PACKING','DISPATCH'))=3
        AND EXISTS (SELECT 1 FROM customer c WHERE c.id=? AND c.status='active'
          AND NOT EXISTS (SELECT 1 FROM customer_principal principal WHERE principal.auth_user_id=c.auth_user_id AND principal.status!='active')))`)
        .bind(revision.market_id, revision.version, location.id, input.customerId),
      cart
        ? database
            .prepare(
              "UPDATE cart SET location_id=?,version=version+1,updated_at=? WHERE id=? AND customer_id=? AND status='ACTIVE' AND version=?",
            )
            .bind(location.id, now, cart.id, input.customerId, input.expectedVersion)
        : database
            .prepare(
              "INSERT OR IGNORE INTO cart(id,customer_id,location_id,status,version,created_at,updated_at) VALUES (?,?,?,'ACTIVE',1,?,?)",
            )
            .bind(value.cartId, input.customerId, location.id, now, now),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -6 WHERE changes()=0"),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(value), now, SCOPE, input.idempotencyKey, hash),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -6 WHERE changes()=0"),
    ]);
  } catch (error) {
    const raced = await findIdempotencyRecord(database, SCOPE, input.idempotencyKey);
    if (raced?.status === "SUCCEEDED" && raced.requestHash === hash && raced.resultReference)
      return {
        ok: true,
        value: JSON.parse(raced.resultReference) as CartLocationSelection,
        requestId: input.requestId,
      };
    if (raced && raced.requestHash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "This key belongs to a different location selection.");
    const latest = await database
      .prepare(
        "SELECT (SELECT version FROM cart WHERE customer_id=? AND status='ACTIVE') cartVersion,(SELECT version FROM geography_configuration WHERE market_id=?) geographyVersion",
      )
      .bind(input.customerId, revision.market_id)
      .first<{ cartVersion: number | null; geographyVersion: number | null }>();
    if (
      (latest?.cartVersion ?? 0) !== input.expectedVersion ||
      latest?.geographyVersion !== revision.version
    )
      return fail(
        "CONFLICT",
        "Your cart or delivery area changed. Review the location and try again.",
      );
    throw error;
  }
  return { ok: true, value, requestId: input.requestId };
}
