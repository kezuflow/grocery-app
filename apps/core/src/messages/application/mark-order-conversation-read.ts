import type { MarkOrderConversationReadRequest, RpcResult } from "@freshmarkets/contracts";
import type { MessageContext } from "./shared";
import { actorGuard, fail, orderGuard, readMessageOrder, resolveMessageActor } from "./shared";

export async function markOrderConversationRead(
  context: MessageContext,
  request: MarkOrderConversationReadRequest,
  kind: "CUSTOMER" | "ADMIN",
): Promise<RpcResult<{ throughSequence: number }>> {
  const actor = await resolveMessageActor(context, request, kind);
  if (!actor.ok) return actor;
  const database = context.env.DB;
  const order = await readMessageOrder(database, actor.value, request.orderId);
  if (!order) return fail("NOT_FOUND", "Order not found", request.requestId);
  const field = kind === "CUSTOMER" ? "customer_read_sequence" : "admin_read_sequence";
  try {
    await database.batch([
      actorGuard(database, actor.value),
      orderGuard(database, actor.value, request.orderId),
      database
        .prepare(`UPDATE order_conversation SET ${field}=MAX(${field},MIN(?,next_sequence-1))
          WHERE order_id=?`)
        .bind(request.throughSequence, request.orderId),
    ]);
  } catch {
    return fail("CONFLICT", "Conversation changed; retry", request.requestId);
  }
  const row = await database
    .prepare(`SELECT ${field} AS sequence FROM order_conversation WHERE order_id=?`)
    .bind(request.orderId)
    .first<{ sequence: number }>();
  return { ok: true, value: { throughSequence: row?.sequence ?? 0 }, requestId: request.requestId };
}
