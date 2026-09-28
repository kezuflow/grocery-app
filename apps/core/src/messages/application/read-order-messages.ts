import type {
  AuthenticatedRequest,
  ListOrderMessagesRequest,
  OrderConversationView,
  OrderConversationsPage,
  OrderMessageAttachmentView,
  OrderMessagesPage,
  RpcResult,
} from "@freshmarkets/contracts";
import type { MessageContext } from "./shared";
import { fail, messageExpiry, readMessageOrder, resolveMessageActor } from "./shared";

type ConversationRow = {
  orderId: string;
  orderNumber: string | null;
  customerId: string;
  latestMessageAt: number;
  lastSequence: number;
  customerReadSequence: number;
  adminReadSequence: number;
  latestMessagePreview: string | null;
  orderStatus: string;
  closedAt: number | null;
};

type MessageRow = {
  id: string;
  orderId: string;
  sequence: number;
  senderKind: "CUSTOMER" | "ADMIN" | "AUTOMATION";
  body: string;
  createdAt: number;
};

type AttachmentRow = {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: OrderMessageAttachmentView["mimeType"];
  byteSize: number;
};

async function toConversation(
  database: D1Database,
  row: ConversationRow,
  kind: "CUSTOMER" | "ADMIN",
  now: number,
): Promise<OrderConversationView> {
  const expiry = await messageExpiry(database, {
    id: row.orderId,
    customerId: row.customerId,
    orderNumber: row.orderNumber,
    status: row.orderStatus,
    closedAt: row.closedAt,
    lastMessageAt: row.latestMessageAt,
  });
  const expired = expiry !== null && expiry <= now;
  const readSequence = kind === "CUSTOMER" ? row.customerReadSequence : row.adminReadSequence;
  const unread = expired
    ? null
    : await database
        .prepare(`SELECT COUNT(*) AS count FROM order_message m
          JOIN order_message_content content ON content.message_id=m.id
          WHERE m.order_id=? AND m.sequence>? AND m.sender_kind<>?`)
        .bind(row.orderId, readSequence, kind)
        .first<{ count: number }>();
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    latestMessageAt: expired ? null : new Date(row.latestMessageAt).toISOString(),
    latestMessagePreview: expired ? null : row.latestMessagePreview,
    unreadCount: expired ? 0 : (unread?.count ?? 0),
    lastSequence: row.lastSequence,
    expiresAt: expiry === null ? null : new Date(expiry).toISOString(),
  };
}

const CONVERSATION_SELECT = `SELECT c.order_id AS orderId,o.order_number AS orderNumber,
  c.customer_id AS customerId,c.last_message_at AS latestMessageAt,
  c.next_sequence-1 AS lastSequence,c.customer_read_sequence AS customerReadSequence,
  c.admin_read_sequence AS adminReadSequence,o.status AS orderStatus,
  (SELECT content.body FROM order_message m JOIN order_message_content content
    ON content.message_id=m.id WHERE m.order_id=c.order_id ORDER BY m.sequence DESC LIMIT 1)
    AS latestMessagePreview,
  CASE o.status
    WHEN 'DELIVERED' THEN (SELECT MAX(d.delivered_at) FROM delivery_job d WHERE d.order_id=o.id AND d.status='DELIVERED')
    WHEN 'CANCELED' THEN (SELECT MAX(x.updated_at) FROM order_cancellation x WHERE x.order_id=o.id AND x.status='COMPLETED')
    ELSE NULL END AS closedAt
  FROM order_conversation c JOIN grocery_order o ON o.id=c.order_id`;

function decodeCursor(cursor: string | undefined): { at: number; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(atob(cursor)) as { at?: unknown; id?: unknown };
    return Number.isSafeInteger(parsed.at) &&
      typeof parsed.id === "string" &&
      parsed.id.length < 200
      ? { at: parsed.at as number, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

export async function listOrderConversations(
  context: MessageContext,
  request: AuthenticatedRequest & { cursor?: string; limit?: number },
  kind: "CUSTOMER" | "ADMIN",
): Promise<RpcResult<OrderConversationsPage>> {
  const actor = await resolveMessageActor(context, request, kind);
  if (!actor.ok) return actor;
  const cursor = decodeCursor(request.cursor);
  if (request.cursor && !cursor)
    return fail("VALIDATION_FAILED", "Invalid conversation cursor", request.requestId);
  const limit = Math.max(1, Math.min(request.limit ?? 20, 50));
  const conditions = ["c.last_message_at IS NOT NULL"];
  const binds: (string | number)[] = [];
  if (actor.value.kind === "CUSTOMER") {
    conditions.push("c.customer_id=?");
    binds.push(actor.value.customerId);
  }
  if (cursor) {
    conditions.push("(c.last_message_at<? OR (c.last_message_at=? AND c.order_id<?))");
    binds.push(cursor.at, cursor.at, cursor.id);
  }
  const rows =
    await context.env.DB.prepare(`${CONVERSATION_SELECT} WHERE ${conditions.join(" AND ")}
      ORDER BY c.last_message_at DESC,c.order_id DESC LIMIT ?`)
      .bind(...binds, limit + 1)
      .all<ConversationRow>();
  const page = rows.results.slice(0, limit);
  const now = context.access.now();
  const items = await Promise.all(
    page.map((row) => toConversation(context.env.DB, row, kind, now)),
  );
  const last = page.at(-1);
  return {
    ok: true,
    value: {
      items,
      nextCursor:
        rows.results.length > limit && last
          ? btoa(JSON.stringify({ at: last.latestMessageAt, id: last.orderId }))
          : null,
    },
    requestId: request.requestId,
  };
}

export async function getOrderMessages(
  context: MessageContext,
  request: ListOrderMessagesRequest,
  kind: "CUSTOMER" | "ADMIN",
): Promise<RpcResult<OrderMessagesPage>> {
  const actor = await resolveMessageActor(context, request, kind);
  if (!actor.ok) return actor;
  const database = context.env.DB;
  const order = await readMessageOrder(database, actor.value, request.orderId);
  if (!order) return fail("NOT_FOUND", "Order not found", request.requestId);
  const conversation = await database
    .prepare(`${CONVERSATION_SELECT} WHERE c.order_id=?`)
    .bind(request.orderId)
    .first<ConversationRow>();
  if (!conversation) {
    return {
      ok: true,
      value: {
        conversation: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          latestMessageAt: null,
          latestMessagePreview: null,
          unreadCount: 0,
          lastSequence: 0,
          expiresAt: null,
        },
        items: [],
        nextBeforeSequence: null,
      },
      requestId: request.requestId,
    };
  }
  const now = context.access.now();
  const view = await toConversation(database, conversation, kind, now);
  if (view.expiresAt && Date.parse(view.expiresAt) <= now)
    return {
      ok: true,
      value: { conversation: view, items: [], nextBeforeSequence: null },
      requestId: request.requestId,
    };
  const limit = Math.max(1, Math.min(request.limit ?? 30, 50));
  const before = request.beforeSequence ?? Number.MAX_SAFE_INTEGER;
  const rows = await database
    .prepare(`SELECT m.id,m.order_id AS orderId,m.sequence,m.sender_kind AS senderKind,
      content.body,m.created_at AS createdAt
      FROM order_message m JOIN order_message_content content ON content.message_id=m.id
      WHERE m.order_id=? AND m.sequence<? ORDER BY m.sequence DESC LIMIT ?`)
    .bind(request.orderId, before, limit + 1)
    .all<MessageRow>();
  const page = rows.results.slice(0, limit).reverse();
  const ids = page.map((row) => row.id);
  const attachments = ids.length
    ? await database
        .prepare(`SELECT id,message_id AS messageId,file_name AS fileName,
          mime_type AS mimeType,byte_size AS byteSize FROM order_message_upload
          WHERE message_id IN (${ids.map(() => "?").join(",")}) AND status='ATTACHED'
          ORDER BY created_at,id`)
        .bind(...ids)
        .all<AttachmentRow>()
    : { results: [] as AttachmentRow[] };
  const items = page.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    sequence: row.sequence,
    senderKind: row.senderKind,
    body: row.body,
    attachments: attachments.results
      .filter((attachment) => attachment.messageId === row.id)
      .map(({ id, fileName, mimeType, byteSize }) => ({ id, fileName, mimeType, byteSize })),
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  return {
    ok: true,
    value: {
      conversation: view,
      items,
      nextBeforeSequence: rows.results.length > limit && page[0] ? page[0].sequence : null,
    },
    requestId: request.requestId,
  };
}
