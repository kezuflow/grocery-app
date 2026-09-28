import type {
  OrderMessageAttachmentContent,
  OrderMessageAttachmentView,
  CancelOrderMessageAttachmentRequest,
  ReadOrderMessageAttachmentRequest,
  RpcResult,
  StageOrderMessageAttachmentRequest,
} from "@freshmarkets/contracts";
import {
  orderMessageImageMaxInputBytes,
  orderMessageImageMaxStoredBytes,
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
import { log } from "../../observability";

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
  input_mime_type: string | null;
  input_byte_size: number | null;
  input_digest: string | null;
  normalization_ready: number;
  normalization_claim: string | null;
  normalization_claim_until: number | null;
  status: "PENDING" | "UNKNOWN" | "STORED" | "ATTACHED" | "DELETE_PENDING" | "DELETED";
};

const accepted = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
type Mime = (typeof accepted)[number];

function isMime(value: string): value is Mime {
  return accepted.some((mime) => mime === value);
}

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
  if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") return false;
  const brands = new TextDecoder().decode(bytes.subarray(8, Math.min(bytes.length, 64)));
  return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].some((brand) => brands.includes(brand));
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

export function messageAttachmentFileName(name: string | null, normalized: boolean): string {
  name ??= "Attachment";
  if (!normalized) return name;
  return `${name.replace(/\.[^.]+$/, "")}.webp`;
}

async function boundedOutput(response: Response): Promise<Uint8Array | null> {
  if (!response.ok) {
    const code = Number(response.headers.get("cf-resized")?.match(/(?:^|[;,\s])err=(\d+)/)?.[1]);
    throw { code: Number.isFinite(code) ? code : null, status: response.status };
  }
  if (response.headers.get("content-type")?.split(";")[0] !== "image/webp") return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > orderMessageImageMaxStoredBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  if (length === 0) return null;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function normalizeImage(
  images: ImagesBinding,
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; digest: string } | null> {
  const source = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  const info = await images.info(source());
  if (!("width" in info) || info.width < 1 || info.height < 1) return null;
  if (info.width * info.height > 100_000_000) return null;
  for (const [edge, quality] of [
    [2560, 82],
    [2048, 72],
    [1600, 64],
  ]) {
    const result = await images
      .input(source())
      .transform({ width: edge, height: edge, fit: "scale-down" })
      .output({ format: "image/webp", quality, anim: false });
    const output = await boundedOutput(result.response());
    if (output && signatureMatches(output, "image/webp"))
      return { bytes: output, digest: await digestBytes(output) };
  }
  return null;
}

function processingFailure(error: unknown, requestId: string): RpcResult<never> {
  const rawCode = error && typeof error === "object" && "code" in error ? error.code : null;
  const code = typeof rawCode === "number" ? rawCode : Number(rawCode);
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  if (
    [9412, 9413, 9520, 9523].includes(code) ||
    (code === 0 && [400, 415].includes(Number(status)))
  )
    return fail(
      "VALIDATION_FAILED",
      "This photo cannot be processed; choose another image",
      requestId,
    );
  if ([9422, 9432].includes(code))
    return fail("CONFIGURATION_ERROR", "Photo uploads are temporarily unavailable", requestId);
  if (code === 9522)
    return fail(
      "VALIDATION_FAILED",
      "This photo is too complex; choose a smaller photo",
      requestId,
    );
  return fail("CONFLICT", "Image processing is unavailable; retry", requestId);
}

function view(upload: Upload): OrderMessageAttachmentView {
  return {
    id: upload.id,
    fileName: messageAttachmentFileName(upload.file_name, upload.input_digest !== null),
    mimeType: upload.mime_type,
    byteSize: upload.byte_size,
  };
}

async function storedUpload(database: D1Database, key: string): Promise<Upload | null> {
  return database
    .prepare(`SELECT id,order_id,actor_kind,actor_user_id,object_key,file_name,mime_type,
      byte_size,content_digest,input_mime_type,input_byte_size,input_digest,status,
      normalization_ready,normalization_claim,normalization_claim_until
      FROM order_message_upload WHERE idempotency_key=?`)
    .bind(key)
    .first<Upload>();
}

function matchesInput(
  upload: Upload,
  request: StageOrderMessageAttachmentRequest,
  kind: "CUSTOMER" | "ADMIN",
  actorUserId: string,
  name: string,
  digest: string,
): boolean {
  return (
    upload.order_id === request.orderId &&
    upload.actor_kind === kind &&
    upload.actor_user_id === actorUserId &&
    (upload.input_digest ?? upload.content_digest) === digest &&
    (upload.input_mime_type ?? upload.mime_type) === request.mimeType &&
    (upload.input_byte_size ?? upload.byte_size) === request.bytes.byteLength &&
    (upload.file_name === name ||
      ((upload.status === "DELETE_PENDING" || upload.status === "DELETED") &&
        upload.file_name === null))
  );
}

function storedObjectMatches(upload: Upload, object: R2Object): boolean {
  return (
    object.size === upload.byte_size &&
    object.customMetadata?.contentDigest === upload.content_digest &&
    object.httpMetadata?.contentType === upload.mime_type
  );
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
    !isMime(mimeType) ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > orderMessageImageMaxInputBytes ||
    !signatureMatches(bytes, mimeType as Mime)
  )
    return fail(
      "VALIDATION_FAILED",
      "Attach a JPEG, PNG, WebP or HEIC image up to 18 MB",
      request.requestId,
    );
  const actor = await resolveMessageActor(context, request, kind, true);
  if (!actor.ok) return actor;
  const database = context.env.DB;
  const order = await readMessageOrder(database, actor.value, request.orderId);
  if (!order) return fail("NOT_FOUND", "Order not found", request.requestId);
  const inputDigest = await digestBytes(bytes);
  let upload = await storedUpload(database, request.idempotencyKey);
  let normalized: Awaited<ReturnType<typeof normalizeImage>> = null;
  let ownsNormalization = false;
  const claim = crypto.randomUUID();
  if (upload) {
    if (!matchesInput(upload, request, kind, actor.value.userId, name, inputDigest))
      return fail(
        "IDEMPOTENCY_CONFLICT",
        "This upload key was used for another file",
        request.requestId,
      );
    if (upload.status === "STORED" || upload.status === "ATTACHED")
      return { ok: true, value: view(upload), requestId: request.requestId };
    if (upload.status === "DELETE_PENDING" || upload.status === "DELETED")
      return fail("CONFLICT", "This upload has expired", request.requestId);
    if (upload.normalization_ready === 0) {
      const claimed = await database
        .prepare(`UPDATE order_message_upload SET normalization_claim=?,normalization_claim_until=?,updated_at=?
          WHERE id=? AND status='PENDING' AND normalization_ready=0
          AND (normalization_claim IS NULL OR normalization_claim_until<=?)`)
        .bind(
          claim,
          context.access.now() + 120_000,
          context.access.now(),
          upload.id,
          context.access.now(),
        )
        .run();
      if (claimed.meta.changes !== 1)
        return fail("CONFLICT", "Photo is being prepared; retry shortly", request.requestId);
      ownsNormalization = true;
    }
  } else {
    const id = crypto.randomUUID();
    const objectKey = `messages/${request.orderId}/${id}`;
    const now = context.access.now();
    try {
      await database.batch([
        actorGuard(database, actor.value, true, request.orderId),
        orderGuard(database, actor.value, request.orderId),
        database
          .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
          EXISTS(SELECT 1 FROM order_message_upload_cancel WHERE idempotency_key=?)
          OR (SELECT COUNT(*) FROM order_message_upload WHERE order_id=? AND actor_kind=?
            AND actor_user_id=? AND message_id IS NULL AND status IN ('PENDING','UNKNOWN','STORED'))>=3
          OR (SELECT COUNT(*) FROM order_message_upload WHERE actor_kind=? AND actor_user_id=?
            AND created_at>=?)>=30`)
          .bind(
            request.idempotencyKey,
            request.orderId,
            kind,
            actor.value.userId,
            kind,
            actor.value.userId,
            now - 24 * 60 * 60 * 1000,
          ),
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
             file_name,mime_type,byte_size,content_digest,input_mime_type,input_byte_size,
             input_digest,status,created_at,updated_at,normalization_ready,
             normalization_claim,normalization_claim_until)
            VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,'PENDING',?,?,0,?,?)`)
          .bind(
            id,
            request.orderId,
            kind,
            actor.value.userId,
            request.idempotencyKey,
            objectKey,
            name,
            "image/webp",
            1,
            inputDigest,
            mimeType,
            bytes.byteLength,
            inputDigest,
            now,
            now,
            claim,
            now + 120_000,
          ),
      ]);
      ownsNormalization = true;
    } catch {
      const raced = await storedUpload(database, request.idempotencyKey);
      if (!raced) {
        const canceled = await database
          .prepare(`SELECT 1 AS canceled FROM order_message_upload_cancel
          WHERE idempotency_key=? AND order_id=? AND actor_kind=? AND actor_user_id=?`)
          .bind(request.idempotencyKey, request.orderId, kind, actor.value.userId)
          .first();
        if (canceled) return fail("CONFLICT", "This photo was removed", request.requestId);
        const latestActor = await resolveMessageActor(context, request, kind, true);
        if (!latestActor.ok) return latestActor;
        if (!(await readMessageOrder(database, latestActor.value, request.orderId)))
          return fail("NOT_FOUND", "Order not found", request.requestId);
        const counts = await database
          .prepare(`SELECT
          (SELECT COUNT(*) FROM order_message_upload WHERE order_id=? AND actor_kind=?
            AND actor_user_id=? AND message_id IS NULL
            AND status IN ('PENDING','UNKNOWN','STORED')) AS active,
          (SELECT COUNT(*) FROM order_message_upload WHERE actor_kind=? AND actor_user_id=?
            AND created_at>=?) AS daily`)
          .bind(
            request.orderId,
            kind,
            actor.value.userId,
            kind,
            actor.value.userId,
            now - 24 * 60 * 60 * 1000,
          )
          .first<{ active: number; daily: number }>();
        if (counts && (counts.active >= 3 || counts.daily >= 30))
          return fail(
            "CONFLICT",
            "Only three unsent photos and 30 photos per day are allowed",
            request.requestId,
          );
        return fail("CONFLICT", "Upload could not be reserved; retry", request.requestId);
      }
      if (!matchesInput(raced, request, kind, actor.value.userId, name, inputDigest))
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "This upload key was used for another file",
          request.requestId,
        );
    }
    upload = await storedUpload(database, request.idempotencyKey);
    if (upload && !ownsNormalization) {
      if (upload.status === "STORED" || upload.status === "ATTACHED")
        return { ok: true, value: view(upload), requestId: request.requestId };
      return fail("CONFLICT", "Photo is being prepared; retry shortly", request.requestId);
    }
  }
  if (!upload) return fail("INTERNAL_ERROR", "Upload reservation unavailable", request.requestId);
  if (ownsNormalization) {
    try {
      normalized = await normalizeImage(context.env.IMAGES, bytes);
    } catch (error) {
      const failure = processingFailure(error, request.requestId);
      if (failure.ok) return failure;
      const providerCode =
        error && typeof error === "object" && "code" in error ? Number(error.code) : NaN;
      if (failure.error.code !== "VALIDATION_FAILED")
        log("error", "message_image_processing_failure", {
          code: Number.isInteger(providerCode) ? providerCode : "unknown",
        });
      await database
        .prepare(`UPDATE order_message_upload SET
        status=CASE WHEN ?='VALIDATION_FAILED' OR ?='CONFIGURATION_ERROR' THEN 'DELETED' ELSE status END,
        file_name=CASE WHEN ? IN ('VALIDATION_FAILED','CONFIGURATION_ERROR') THEN NULL ELSE file_name END,
        normalization_claim=NULL,normalization_claim_until=NULL,updated_at=?
        WHERE id=? AND status='PENDING' AND normalization_claim=?`)
        .bind(
          failure.error.code,
          failure.error.code,
          failure.error.code,
          context.access.now(),
          upload.id,
          claim,
        )
        .run();
      return failure;
    }
    if (!normalized) {
      await database
        .prepare(`UPDATE order_message_upload SET status='DELETED',file_name=NULL,
        normalization_claim=NULL,normalization_claim_until=NULL,updated_at=?
        WHERE id=? AND status='PENDING' AND normalization_claim=?`)
        .bind(context.access.now(), upload.id, claim)
        .run();
      return fail(
        "VALIDATION_FAILED",
        "This image could not be safely converted to a photo up to 5 MiB",
        request.requestId,
      );
    }
    const saved = await database
      .prepare(`UPDATE order_message_upload SET byte_size=?,content_digest=?,
      normalization_ready=1,normalization_claim=NULL,normalization_claim_until=NULL,updated_at=?
      WHERE id=? AND status='PENDING' AND normalization_ready=0 AND normalization_claim=?`)
      .bind(normalized.bytes.byteLength, normalized.digest, context.access.now(), upload.id, claim)
      .run();
    if (saved.meta.changes !== 1)
      return fail("CONFLICT", "This photo was removed or changed; retry", request.requestId);
    upload = await storedUpload(database, request.idempotencyKey);
    if (!upload) return fail("INTERNAL_ERROR", "Upload reservation unavailable", request.requestId);
  }
  try {
    const observed = await context.env.PRODUCT_MEDIA.head(upload.object_key);
    if (observed) {
      if (!storedObjectMatches(upload, observed))
        return fail("CONFLICT", "Stored file verification failed", request.requestId);
    } else {
      if (upload.input_digest !== null && !normalized) {
        try {
          normalized = await normalizeImage(context.env.IMAGES, bytes);
        } catch (error) {
          return processingFailure(error, request.requestId);
        }
      }
      if (
        upload.input_digest !== null &&
        (!normalized ||
          normalized.digest !== upload.content_digest ||
          normalized.bytes.byteLength !== upload.byte_size)
      )
        return fail("CONFLICT", "Image conversion changed; use a new upload", request.requestId);
      // A pre-migration pending intent must finish with its original byte identity.
      const storedBytes = upload.input_digest === null ? bytes : normalized?.bytes;
      if (!storedBytes)
        return fail("CONFLICT", "Image conversion is unavailable; retry", request.requestId);
      const current = await storedUpload(database, request.idempotencyKey);
      if (!current || !["PENDING", "UNKNOWN"].includes(current.status))
        return fail("CONFLICT", "This photo was removed", request.requestId);
      const stored = await context.env.PRODUCT_MEDIA.put(upload.object_key, storedBytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: upload.content_digest,
        httpMetadata: { contentType: upload.mime_type },
        customMetadata: { attachmentId: upload.id, contentDigest: upload.content_digest },
      });
      if (!stored)
        return fail("CONFLICT", "Upload outcome is being checked; retry", request.requestId);
    }
    const saved = await database
      .prepare(`UPDATE order_message_upload SET status='STORED',updated_at=?
        WHERE id=? AND status IN ('PENDING','UNKNOWN')`)
      .bind(context.access.now(), upload.id)
      .run();
    if (saved.meta.changes !== 1) {
      // A cancellation can win after the create-only R2 write. Keep its durable
      // cleanup intent pending even if a prior sweep already examined it.
      await database
        .prepare(`UPDATE order_message_upload SET status='DELETE_PENDING',
        next_attempt_at=?,updated_at=? WHERE id=? AND status IN ('DELETE_PENDING','DELETED')
        AND message_id IS NULL`)
        .bind(context.access.now(), context.access.now(), upload.id)
        .run();
      return fail("CONFLICT", "Upload status changed; retry", request.requestId);
    }
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

export async function cancelOrderMessageAttachment(
  context: MessageContext,
  request: CancelOrderMessageAttachmentRequest,
  kind: "CUSTOMER" | "ADMIN",
): Promise<RpcResult<{ canceled: true }>> {
  const actor = await resolveMessageActor(context, request, kind, true);
  if (!actor.ok) return actor;
  const database = context.env.DB;
  if (!(await readMessageOrder(database, actor.value, request.orderId)))
    return fail("NOT_FOUND", "Order not found", request.requestId);
  const now = context.access.now();
  try {
    await database.batch([
      actorGuard(database, actor.value, true, request.orderId),
      orderGuard(database, actor.value, request.orderId),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
        NOT EXISTS(SELECT 1 FROM order_message_upload WHERE idempotency_key=?)
        AND NOT EXISTS(SELECT 1 FROM order_message_upload_cancel WHERE idempotency_key=?)
        AND (SELECT COUNT(*) FROM order_message_upload_cancel WHERE actor_kind=?
          AND actor_user_id=? AND created_at>=?)>=30`)
        .bind(
          request.idempotencyKey,
          request.idempotencyKey,
          kind,
          actor.value.userId,
          now - 24 * 60 * 60 * 1000,
        ),
      database
        .prepare(`INSERT OR IGNORE INTO order_message_upload_cancel
        (idempotency_key,order_id,actor_kind,actor_user_id,created_at) VALUES (?,?,?,?,?)`)
        .bind(request.idempotencyKey, request.orderId, kind, actor.value.userId, now),
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -39 WHERE
        NOT EXISTS(SELECT 1 FROM order_message_upload_cancel WHERE idempotency_key=?
          AND order_id=? AND actor_kind=? AND actor_user_id=?)
        OR EXISTS(SELECT 1 FROM order_message_upload WHERE idempotency_key=?
          AND (order_id<>? OR actor_kind<>? OR actor_user_id<>? OR status='ATTACHED'))`)
        .bind(
          request.idempotencyKey,
          request.orderId,
          kind,
          actor.value.userId,
          request.idempotencyKey,
          request.orderId,
          kind,
          actor.value.userId,
        ),
      database
        .prepare(`UPDATE order_message_upload SET status='DELETE_PENDING',file_name=NULL,
        next_attempt_at=?,updated_at=? WHERE idempotency_key=?
        AND status IN ('PENDING','UNKNOWN','STORED')`)
        .bind(now + 120_000, now, request.idempotencyKey),
    ]);
  } catch {
    return fail("CONFLICT", "This photo could not be removed", request.requestId);
  }
  return { ok: true, value: { canceled: true }, requestId: request.requestId };
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
      byte_size,content_digest,input_mime_type,input_byte_size,input_digest,status,
      normalization_ready,normalization_claim,normalization_claim_until
      FROM order_message_upload u
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
    object.customMetadata?.contentDigest !== upload.content_digest ||
    object.httpMetadata?.contentType !== upload.mime_type
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
    value: {
      bytes,
      mimeType: upload.mime_type,
      fileName: messageAttachmentFileName(upload.file_name, upload.input_digest !== null),
    },
    requestId: request.requestId,
  };
}
