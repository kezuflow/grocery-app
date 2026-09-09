import type {
  AppErrorCode,
  AuthenticatedRequest,
  ManagedCustomerAddress,
  RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../idempotency";
import { customerProfileSchema, readCustomerProfile, type ProfilePorts } from "./profile";

const commandSchema = z
  .object({
    action: z.enum(["SET_DEFAULT", "REMOVE"]),
    addressId: z.string().min(1).max(200),
    expectedAddressVersion: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();
const receiptSchema = z.object({
  addressId: z.string(),
  addressVersion: z.number().int().positive(),
  status: z.enum(["active", "disabled"]),
  profile: customerProfileSchema,
});
const scope = "customer.address.manage";
const failure = (code: AppErrorCode, message: string, requestId: string) => ({
  ok: false as const,
  error: { code, message, requestId },
});

export async function manageMyCustomerAddress(
  ports: ProfilePorts,
  request: AuthenticatedRequest,
  input: unknown,
): Promise<RpcResult<ManagedCustomerAddress>> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Choose an address and its current version",
      request.requestId,
    );
  const user = await ports.session(request);
  if (!user)
    return failure("UNAUTHENTICATED", "Sign in to manage your addresses", request.requestId);
  const db = ports.database;
  const command = parsed.data;
  const key = `${user.id}:${command.idempotencyKey}`;
  const hash = await requestHash(command);
  const customer = await db
    .prepare(
      "SELECT c.id FROM customer c JOIN customer_principal cp ON cp.id=c.principal_id AND cp.auth_user_id=c.auth_user_id WHERE c.auth_user_id=? AND c.status='active' AND cp.status='active'",
    )
    .bind(user.id)
    .first<{ id: string }>();
  if (!customer)
    return failure("FORBIDDEN", "An active customer account is required", request.requestId);
  async function replay(): Promise<RpcResult<ManagedCustomerAddress> | null> {
    const saved = await findIdempotencyRecord(db, scope, key);
    if (!saved) return null;
    if (saved.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "This request key was used for another address change",
        request.requestId,
      );
    if (saved.status !== "SUCCEEDED") return null;
    const receipt = receiptSchema.safeParse(JSON.parse(saved.resultReference ?? "null"));
    if (!receipt.success)
      return failure("INTERNAL_ERROR", "Saved address result is unavailable", request.requestId);
    return { ok: true, value: receipt.data, requestId: request.requestId };
  }
  const previous = await replay();
  if (previous) return previous;
  const profile = await readCustomerProfile(db, customer.id);
  const address = await db
    .prepare(
      "SELECT version FROM customer_address WHERE id=? AND customer_id=? AND status='active'",
    )
    .bind(command.addressId, customer.id)
    .first<{ version: number }>();
  if (!profile || !address)
    return failure("NOT_FOUND", "Saved address not found", request.requestId);
  if (
    profile.version !== command.expectedVersion ||
    address.version !== command.expectedAddressVersion
  )
    return failure(
      "STALE_VERSION",
      "Your account or address changed; refresh before continuing",
      request.requestId,
    );
  const removing = command.action === "REMOVE";
  const value: ManagedCustomerAddress = {
    addressId: command.addressId,
    addressVersion: address.version + (removing ? 1 : 0),
    status: removing ? "disabled" : "active",
    profile: {
      ...profile,
      version: profile.version + 1,
      defaultAddressId: removing
        ? profile.defaultAddressId === command.addressId
          ? null
          : profile.defaultAddressId
        : command.addressId,
    },
  };
  const now = ports.now();
  const required = () =>
    db.prepare("INSERT INTO commitment_abort(id) SELECT -36 WHERE changes()!=1");
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at) VALUES (?,?,?,'PROCESSING','customer_address_snapshot',?,?) ON CONFLICT(scope,idempotency_key) DO NOTHING",
        )
        .bind(scope, key, hash, now, now),
      required(),
      db
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -36 WHERE NOT EXISTS(SELECT 1 FROM customer_address WHERE id=? AND customer_id=? AND status='active' AND version=?)",
        )
        .bind(command.addressId, customer.id, command.expectedAddressVersion),
      db
        .prepare(
          "UPDATE customer SET default_address_id=?,version=version+1,updated_at=? WHERE id=? AND auth_user_id=? AND status='active' AND version=? AND EXISTS(SELECT 1 FROM customer_principal cp WHERE cp.id=customer.principal_id AND cp.auth_user_id=customer.auth_user_id AND cp.status='active')",
        )
        .bind(value.profile.defaultAddressId, now, customer.id, user.id, command.expectedVersion),
      required(),
      ...(removing
        ? [
            db
              .prepare(
                "UPDATE customer_address SET status='disabled',version=version+1,updated_at=? WHERE id=? AND customer_id=? AND status='active' AND version=?",
              )
              .bind(now, command.addressId, customer.id, command.expectedAddressVersion),
            required(),
          ]
        : []),
      auditEventStatement(db, {
        actorUserId: user.id,
        action: removing ? "CUSTOMER.ADDRESS_REMOVED" : "CUSTOMER.DEFAULT_ADDRESS_CHANGED",
        resourceType: "customer_address",
        resourceId: command.addressId,
        details: { version: value.addressVersion, customerVersion: value.profile.version },
        correlationId: request.requestId,
        idempotencyKey: `${scope}:${key}`,
        occurredAt: now,
      }),
      required(),
      db
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(JSON.stringify(value), now, scope, key, hash),
      required(),
    ]);
    return { ok: true, value, requestId: request.requestId };
  } catch (error) {
    const recorded = await replay();
    if (recorded) return recorded;
    const latest = await readCustomerProfile(db, customer.id);
    const current = await db
      .prepare("SELECT version,status FROM customer_address WHERE id=? AND customer_id=?")
      .bind(command.addressId, customer.id)
      .first<{ version: number; status: string }>();
    if (
      latest?.version !== command.expectedVersion ||
      current?.version !== command.expectedAddressVersion ||
      current.status !== "active"
    )
      return failure(
        "CONFLICT",
        "Your account or address changed; refresh before continuing",
        request.requestId,
      );
    if (error instanceof Error && error.message.includes("CHECK constraint failed: id = 0"))
      return failure(
        "CONFLICT",
        "The address change was not applied. Refresh and retry.",
        request.requestId,
      );
    throw error;
  }
}
