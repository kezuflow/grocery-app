import type {
  RpcResult,
  SendOrderMessageRequest,
  SendOrderMessageView,
} from "@freshmarkets/contracts";
import type { MessageContext } from "./shared";
import {
  actorGuard,
  changedGuard,
  digestPayload,
  expireConversationIfDue,
  fail,
  orderGuard,
  readMessageOrder,
  resolveMessageActor,
} from "./shared";

type Receipt = {
  order_id: string;
  actor_kind: "CUSTOMER" | "ADMIN";
  actor_user_id: string;
  payload_digest: string;
  message_id: string;
  acknowledgement_message_id: string | null;
  sequence: number;
};

async function existingReceipt(database: D1Database, key: string) {
  return database
    .prepare(`SELECT order_id,actor_kind,actor_user_id,payload_digest,message_id,
      acknowledgement_message_id,sequence FROM order_message_receipt WHERE idempotency_key=?`)
    .bind(key)
    .first<Receipt>();
}

function replay(
  receipt: Receipt,
  request: SendOrderMessageRequest,
  actorKind: "CUSTOMER" | "ADMIN",
  userId: string,
  digest: string,
): RpcResult<SendOrderMessageView> {
  if (
    receipt.order_id !== request.orderId ||
    receipt.actor_kind !== actorKind ||
    receipt.actor_user_id !== userId ||
    receipt.payload_digest !== digest
  )
    return fail(
      "IDEMPOTENCY_CONFLICT",
      "This message key was used for another payload",
      request.requestId,
    );
  return {
    ok: true,
    value: {
      messageId: receipt.message_id,
      sequence: receipt.sequence,
      acknowledgementMessageId: receipt.acknowledgement_message_id,
    },
    requestId: request.requestId,
  };
}

export async function sendOrderMessage(
  context: MessageContext,
  request: SendOrderMessageRequest,
  kind: "CUSTOMER" | "ADMIN",
): Promise<RpcResult<SendOrderMessageView>> {
  const body = request.body.trim();
  const attachmentIds = [...request.attachmentIds];
  if (
    body.length > 2000 ||
    (body.length === 0 && attachmentIds.length === 0) ||
    attachmentIds.length > 3 ||
    new Set(attachmentIds).size !== attachmentIds.length
  )
    return fail("VALIDATION_FAILED", "Provide text or up to three attachments", request.requestId);

  const actorResult = await resolveMessageActor(context, request, kind, true);
  if (!actorResult.ok) return actorResult;
  const actor = actorResult.value;
  const database = context.env.DB;
  const order = await readMessageOrder(database, actor, request.orderId);
  if (!order) return fail("NOT_FOUND", "Order not found", request.requestId);

  const digest = await digestPayload({ orderId: request.orderId, body, attachmentIds });
  const prior = await existingReceipt(database, request.idempotencyKey);
  if (prior) return replay(prior, request, kind, actor.userId, digest);

  const now = context.access.now();
  if (!(await expireConversationIfDue(database, actor, order, now)))
    return fail("CONFLICT", "Conversation changed; retry the message", request.requestId);

  for (let retry = 0; retry < 2; retry += 1) {
    const conversation = await database
      .prepare(
        "SELECT next_sequence AS nextSequence,acknowledgement_sent AS acknowledgementSent FROM order_conversation WHERE order_id=?",
      )
      .bind(request.orderId)
      .first<{ nextSequence: number; acknowledgementSent: number }>();
    const sequence = conversation?.nextSequence ?? 1;
    const acknowledgementSent = conversation?.acknowledgementSent ?? 0;
    const acknowledge = kind === "CUSTOMER" && acknowledgementSent === 0;
    const acknowledgement = acknowledge
      ? await database
          .prepare("SELECT acknowledgement_text AS text FROM order_message_settings WHERE id=1")
          .first<{ text: string }>()
      : null;
    if (acknowledge && !acknowledgement)
      return fail("INTERNAL_ERROR", "Message settings unavailable", request.requestId);
    const messageId = crypto.randomUUID();
    const acknowledgementId = acknowledge ? crypto.randomUUID() : null;
    const acknowledgementDigest = acknowledge ? await digestPayload(acknowledgement?.text) : null;
    const guard = () => changedGuard(database);
    const statements: D1PreparedStatement[] = [
      actorGuard(database, actor, true),
      orderGuard(database, actor, request.orderId),
      database
        .prepare(`INSERT OR IGNORE INTO order_conversation
          (order_id,customer_id,next_sequence,customer_read_sequence,admin_read_sequence,
           acknowledgement_sent,last_message_at,created_at)
          SELECT id,customer_id,1,0,0,0,NULL,? FROM grocery_order
          WHERE id=? AND committed_at IS NOT NULL`)
        .bind(now, request.orderId),
      database
        .prepare(`UPDATE order_conversation SET next_sequence=next_sequence+?,
          acknowledgement_sent=?,last_message_at=?
          WHERE order_id=? AND next_sequence=? AND acknowledgement_sent=?`)
        .bind(
          acknowledge ? 2 : 1,
          acknowledge ? 1 : acknowledgementSent,
          now,
          request.orderId,
          sequence,
          acknowledgementSent,
        ),
      guard(),
    ];
    if (attachmentIds.length > 0) {
      const placeholders = attachmentIds.map(() => "?").join(",");
      statements.push(
        database
          .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
            (SELECT COUNT(*) FROM order_message_upload WHERE id IN (${placeholders})
              AND order_id=? AND actor_kind=? AND actor_user_id=? AND status='STORED')<>?`)
          .bind(...attachmentIds, request.orderId, kind, actor.userId, attachmentIds.length),
      );
    }
    statements.push(
      database
        .prepare(`INSERT INTO order_message
          (id,order_id,sequence,sender_kind,sender_user_id,payload_digest,created_at)
          VALUES (?,?,?,?,?,?,?)`)
        .bind(messageId, request.orderId, sequence, kind, actor.userId, digest, now),
      database
        .prepare("INSERT INTO order_message_content(message_id,body) VALUES (?,?)")
        .bind(messageId, body),
    );
    for (const attachmentId of attachmentIds)
      statements.push(
        database
          .prepare(`UPDATE order_message_upload SET message_id=?,status='ATTACHED',updated_at=?
            WHERE id=? AND order_id=? AND actor_kind=? AND actor_user_id=? AND status='STORED'`)
          .bind(messageId, now, attachmentId, request.orderId, kind, actor.userId),
        guard(),
      );
    if (acknowledge && acknowledgementId) {
      statements.push(
        database
          .prepare(`INSERT INTO order_message
            (id,order_id,sequence,sender_kind,sender_user_id,payload_digest,created_at)
            VALUES (?,? ,?,'AUTOMATION',NULL,?,?)`)
          .bind(acknowledgementId, request.orderId, sequence + 1, acknowledgementDigest, now),
        database
          .prepare("INSERT INTO order_message_content(message_id,body) VALUES (?,?)")
          .bind(acknowledgementId, acknowledgement?.text),
      );
    }
    statements.push(
      database
        .prepare(`INSERT INTO order_message_receipt
          (idempotency_key,order_id,actor_kind,actor_user_id,payload_digest,message_id,
           acknowledgement_message_id,sequence,acknowledgement_sequence,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(
          request.idempotencyKey,
          request.orderId,
          kind,
          actor.userId,
          digest,
          messageId,
          acknowledgementId,
          sequence,
          acknowledge ? sequence + 1 : null,
          now,
        ),
      database
        .prepare(`INSERT INTO audit_event
          (id,actor_user_id,action,aggregate_type,aggregate_id,details_json,idempotency_key,occurred_at)
          VALUES (?,?,'ORDER.MESSAGE_SENT','order_conversation',?,?,?,?)`)
        .bind(
          crypto.randomUUID(),
          actor.userId,
          request.orderId,
          JSON.stringify({
            messageId,
            senderKind: kind,
            attachmentCount: attachmentIds.length,
            acknowledgementMessageId: acknowledgementId,
          }),
          request.idempotencyKey,
          now,
        ),
    );
    for (const audience of [`customer:${order.customerId}`, "admin", `order:${request.orderId}`])
      statements.push(
        database
          .prepare(`INSERT INTO order_message_revision(audience_key,revision,published_revision)
            VALUES (?,1,0) ON CONFLICT(audience_key) DO UPDATE SET revision=revision+1`)
          .bind(audience),
      );
    try {
      await database.batch(statements);
      return {
        ok: true,
        value: { messageId, sequence, acknowledgementMessageId: acknowledgementId },
        requestId: request.requestId,
      };
    } catch {
      const raced = await existingReceipt(database, request.idempotencyKey);
      if (raced) return replay(raced, request, kind, actor.userId, digest);
      if (retry === 1)
        return fail("CONFLICT", "Conversation changed; retry the message", request.requestId);
    }
  }
  return fail("INTERNAL_ERROR", "Message could not be sent", request.requestId);
}
