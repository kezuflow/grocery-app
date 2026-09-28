import type {
  OrderMessageAttachmentContent,
  OrderMessageAttachmentView,
  ReadOrderMessageAttachmentRequest,
  RpcResult,
  StageOrderMessageAttachmentRequest,
} from "@freshmarkets/contracts";
import type { MessageContext } from "./shared";
import {
  actorGuard,
  fail,
  messageExpiry,
  orderGuard,
  readMessageOrder,
  resolveMessageActor,
} from "./shared";

type Upload = {
  id: string;
  order_id: string;
  actor_kind: "CUSTOMER" | "ADMIN";
  actor_user_id: string;
  object_key: string;
  file_name: string | null;
  mime_type: OrderMessageAttachmentView["mimeType"];
  byte_size: number;
  content_digest: string;
  status: "PENDING" | "UNKNOWN" | "STORED" | "ATTACHED" | "DELETE_PENDING" | "DELETED";
};

const accepted = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
type Mime = (typeof accepted)[number];

function signatureMatches(bytes: Uint8Array, mimeType: Mime): boolean {
  if (mimeType === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png")
    return (
      bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
    );
  if (mimeType === "image/webp")
    return (
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
    );
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}

function safeFileName(fileName: string): string | null {
  const name = fileName.replaceAll("\\", "/").split("/").at(-1)?.trim();
  if (
    !name ||
    name.length > 120 ||
    [...name].some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code < 32 || code === 127);
    })
  )
    return null;
  return name;
}

async function digestBytes(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stable.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function view(upload: Upload): OrderMessageAttachmentView {
  return {
    id: upload.id,
    fileName: upload.file_name ?? "Attachment",
    mimeType: upload.mime_type,
    byteSize: upload.byte_size,
  };
}

async function storedUpload(database: D1Database, key: string): Promise<Upload | null> {
  return database
    .prepare(`SELECT id,order_id,actor_kind,actor_user_id,object_key,file_name,mime_type,
      byte_size,content_digest,status FROM order_message_upload WHERE idempotency_key=?`)
    .bind(key)
    .first<Upload>();
}

export async function stageOrderMessageAttachment(
  context: MessageContext,
  request: StageOrderMessageAttachmentRequest,
  kind: "CUSTOMER" | "ADMIN",
): Promise<RpcResult<OrderMessageAttachmentView>> {
  const name = safeFileName(request.fileName);
  const mimeType = request.mimeType;
  const bytes = request.bytes;
  if (
    !name ||
    !accepted.includes(mimeType as Mime) ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > 5 * 1024 * 1024 ||
    !signatureMatches(bytes, mimeType as Mime)
  )
    return fail(
      "VALIDATION_FAILED",
      "Attach a JPEG, PNG, WebP or PDF up to 5 MiB",
      request.requestId,
    );
  const actor = await resolveMessageActor(context, request, kind, true);
  if (!actor.ok) return actor;
  const database = context.env.DB;
  const order = await readMessageOrder(database, actor.value, request.orderId);
  if (!order) return fail("NOT_FOUND", "Order not found", request.requestId);
  const digest = await digestBytes(bytes);
  const now = context.access.now();
  let upload = await storedUpload(database, request.idempotencyKey);
  if (upload) {
    if (
      upload.order_id !== request.orderId ||
      upload.actor_kind !== kind ||
      upload.actor_user_id !== actor.value.userId ||
      upload.content_digest !== digest ||
      upload.mime_type !== mimeType ||
      upload.byte_size !== bytes.byteLength ||
      upload.file_name !== name
    )
      return fail(
        "IDEMPOTENCY_CONFLICT",
        "This upload key was used for another file",
        request.requestId,
      );
    if (upload.status === "STORED" || upload.status === "ATTACHED")
      return { ok: true, value: view(upload), requestId: request.requestId };
    if (upload.status === "DELETE_PENDING" || upload.status === "DELETED")
      return fail("CONFLICT", "This upload has expired", request.requestId);
  } else {
    const id = crypto.randomUUID();
    const objectKey = `messages/${request.orderId}/${id}`;
    try {
      await database.batch([
        actorGuard(database, actor.value, true, request.orderId),
        orderGuard(database, actor.value, request.orderId),
        database
          .prepare(`INSERT OR IGNORE INTO order_conversation
            (order_id,customer_id,next_sequence,customer_read_sequence,admin_read_sequence,
             acknowledgement_sent,last_message_at,created_at)
            SELECT id,customer_id,1,0,0,0,NULL,? FROM grocery_order
            WHERE id=? AND committed_at IS NOT NULL`)
          .bind(now, request.orderId),
        database
          .prepare(`INSERT INTO order_message_upload
            (id,order_id,actor_kind,actor_user_id,idempotency_key,message_id,object_key,
             file_name,mime_type,byte_size,content_digest,status,created_at,updated_at)
            VALUES (?,?,?,?,?,NULL,?,?,?,?,?,'PENDING',?,?)`)
          .bind(
            id,
            request.orderId,
            kind,
            actor.value.userId,
            request.idempotencyKey,
            objectKey,
            name,
            mimeType,
            bytes.byteLength,
            digest,
            now,
            now,
          ),
      ]);
    } catch {
      const raced = await storedUpload(database, request.idempotencyKey);
      if (!raced) return fail("CONFLICT", "Upload could not be reserved", request.requestId);
      if (
        raced.order_id !== request.orderId ||
        raced.actor_kind !== kind ||
        raced.actor_user_id !== actor.value.userId ||
        raced.content_digest !== digest ||
        raced.mime_type !== mimeType ||
        raced.byte_size !== bytes.byteLength ||
        raced.file_name !== name
      )
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "This upload key was used for another file",
          request.requestId,
        );
    }
    upload = await storedUpload(database, request.idempotencyKey);
  }
  if (!upload) return fail("INTERNAL_ERROR", "Upload reservation unavailable", request.requestId);
  try {
    const observed = await context.env.PRODUCT_MEDIA.head(upload.object_key);
    if (observed) {
      if (observed.size !== upload.byte_size || observed.customMetadata?.contentDigest !== digest)
        return fail("CONFLICT", "Stored file verification failed", request.requestId);
    } else {
      const stored = await context.env.PRODUCT_MEDIA.put(upload.object_key, bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: digest,
        httpMetadata: { contentType: mimeType },
        customMetadata: { attachmentId: upload.id, contentDigest: digest },
      });
      if (!stored)
        return fail("CONFLICT", "Upload outcome is being checked; retry", request.requestId);
    }
    const saved = await database
      .prepare(`UPDATE order_message_upload SET status='STORED',updated_at=?
        WHERE id=? AND status IN ('PENDING','UNKNOWN')`)
      .bind(context.access.now(), upload.id)
      .run();
    if (saved.meta.changes !== 1)
      return fail("CONFLICT", "Upload status changed; retry", request.requestId);
    return { ok: true, value: view(upload), requestId: request.requestId };
  } catch {
    await database
      .prepare(`UPDATE order_message_upload SET status='UNKNOWN',updated_at=?
        WHERE id=? AND status IN ('PENDING','UNKNOWN')`)
      .bind(context.access.now(), upload.id)
      .run();
    return fail("CONFLICT", "Upload outcome is being checked; retry", request.requestId);
  }
}

export async function readOrderMessageAttachment(
  context: MessageContext,
  request: ReadOrderMessageAttachmentRequest,
  kind: "CUSTOMER" | "ADMIN",
): Promise<RpcResult<OrderMessageAttachmentContent>> {
  const actor = await resolveMessageActor(context, request, kind);
  if (!actor.ok) return actor;
  const database = context.env.DB;
  const order = await readMessageOrder(database, actor.value, request.orderId);
  if (!order) return fail("NOT_FOUND", "Attachment not found", request.requestId);
  const expiresAt = await messageExpiry(database, order);
  if (expiresAt !== null && expiresAt <= context.access.now())
    return fail("NOT_FOUND", "Attachment expired", request.requestId);
  const upload = await database
    .prepare(`SELECT id,order_id,actor_kind,actor_user_id,object_key,file_name,mime_type,
      byte_size,content_digest,status FROM order_message_upload u
      WHERE u.id=? AND u.order_id=? AND u.status='ATTACHED' AND u.message_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM order_message_content c WHERE c.message_id=u.message_id)`)
    .bind(request.attachmentId, request.orderId)
    .first<Upload>();
  if (!upload || !upload.file_name)
    return fail("NOT_FOUND", "Attachment not found", request.requestId);
  const object = await context.env.PRODUCT_MEDIA.get(upload.object_key);
  if (
    !object ||
    object.size !== upload.byte_size ||
    object.customMetadata?.contentDigest !== upload.content_digest
  )
    return fail("NOT_FOUND", "Attachment unavailable", request.requestId);
  const bytes = new Uint8Array(await object.arrayBuffer());
  // Recheck after the external read so a simultaneous purge cannot publish expired bytes.
  const latestActor = await resolveMessageActor(context, request, kind);
  if (!latestActor.ok) return latestActor;
  const latestOrder = await readMessageOrder(database, latestActor.value, request.orderId);
  if (!latestOrder) return fail("NOT_FOUND", "Attachment unavailable", request.requestId);
  const latestExpiry = await messageExpiry(database, latestOrder);
  if (latestExpiry !== null && latestExpiry <= context.access.now())
    return fail("NOT_FOUND", "Attachment expired", request.requestId);
  const stillAttached = await database
    .prepare("SELECT 1 AS live FROM order_message_upload WHERE id=? AND status='ATTACHED'")
    .bind(request.attachmentId)
    .first<{ live: number }>();
  if (!stillAttached) return fail("NOT_FOUND", "Attachment expired", request.requestId);
  return {
    ok: true,
    value: { bytes, mimeType: upload.mime_type, fileName: upload.file_name },
    requestId: request.requestId,
  };
}
