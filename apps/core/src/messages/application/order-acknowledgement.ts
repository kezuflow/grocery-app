import type {
  AuthenticatedRequest,
  OrderAcknowledgementView,
  RpcResult,
  SaveOrderAcknowledgementRequest,
} from "@freshmarkets/contracts";
import type { MessageContext } from "./shared";
import { actorGuard, changedGuard, digestPayload, fail, resolveMessageActor } from "./shared";

type Receipt = {
  actor_user_id: string;
  payload_digest: string;
  result_text: string;
  result_version: number;
};

export async function getOrderAcknowledgement(
  context: MessageContext,
  request: AuthenticatedRequest,
): Promise<RpcResult<OrderAcknowledgementView>> {
  const actor = await resolveMessageActor(context, request, "ADMIN");
  if (!actor.ok) return actor;
  const settings = await context.env.DB.prepare(
    "SELECT acknowledgement_text AS text,version FROM order_message_settings WHERE id=1",
  ).first<OrderAcknowledgementView>();
  if (!settings) return fail("INTERNAL_ERROR", "Message settings unavailable", request.requestId);
  return { ok: true, value: settings, requestId: request.requestId };
}

export async function saveOrderAcknowledgement(
  context: MessageContext,
  request: SaveOrderAcknowledgementRequest,
): Promise<RpcResult<OrderAcknowledgementView>> {
  const text = request.text.trim();
  if (text.length < 1 || text.length > 500)
    return fail("VALIDATION_FAILED", "Acknowledgement must be 1–500 characters", request.requestId);
  const actor = await resolveMessageActor(context, request, "ADMIN", true);
  if (!actor.ok) return actor;
  if (actor.value.kind !== "ADMIN")
    return fail("FORBIDDEN", "Admin access is required", request.requestId);
  const database = context.env.DB;
  const digest = await digestPayload({ text, expectedVersion: request.expectedVersion });
  const prior = await database
    .prepare(`SELECT actor_user_id,payload_digest,result_text,result_version
      FROM order_message_settings_receipt WHERE idempotency_key=?`)
    .bind(request.idempotencyKey)
    .first<Receipt>();
  if (prior) {
    if (prior.actor_user_id !== actor.value.userId || prior.payload_digest !== digest)
      return fail(
        "IDEMPOTENCY_CONFLICT",
        "This settings key was used for another change",
        request.requestId,
      );
    return {
      ok: true,
      value: { text: prior.result_text, version: prior.result_version },
      requestId: request.requestId,
    };
  }
  const now = context.access.now();
  try {
    await database.batch([
      actorGuard(database, actor.value, true),
      database
        .prepare(`UPDATE order_message_settings SET acknowledgement_text=?,version=version+1,
          updated_at=?,actor_user_id=? WHERE id=1 AND version=?`)
        .bind(text, now, actor.value.userId, request.expectedVersion),
      changedGuard(database),
      database
        .prepare(`INSERT INTO order_message_settings_receipt
          (idempotency_key,actor_user_id,payload_digest,result_text,result_version,created_at)
          VALUES (?,?,?,?,?,?)`)
        .bind(
          request.idempotencyKey,
          actor.value.userId,
          digest,
          text,
          request.expectedVersion + 1,
          now,
        ),
      database
        .prepare(`INSERT INTO audit_event
          (id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,occurred_at)
          VALUES (?,?,'ORDER.MESSAGE_ACKNOWLEDGEMENT_UPDATED','order_message_settings','1',?,?,?)`)
        .bind(
          crypto.randomUUID(),
          actor.value.userId,
          JSON.stringify({ version: request.expectedVersion + 1 }),
          request.idempotencyKey,
          now,
        ),
    ]);
    return {
      ok: true,
      value: { text, version: request.expectedVersion + 1 },
      requestId: request.requestId,
    };
  } catch {
    const raced = await database
      .prepare(`SELECT actor_user_id,payload_digest,result_text,result_version
        FROM order_message_settings_receipt WHERE idempotency_key=?`)
      .bind(request.idempotencyKey)
      .first<Receipt>();
    if (raced) {
      if (raced.actor_user_id !== actor.value.userId || raced.payload_digest !== digest)
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "This settings key was used for another change",
          request.requestId,
        );
      return {
        ok: true,
        value: { text: raced.result_text, version: raced.result_version },
        requestId: request.requestId,
      };
    }
    return fail("STALE_VERSION", "Acknowledgement changed; reload it", request.requestId);
  }
}
