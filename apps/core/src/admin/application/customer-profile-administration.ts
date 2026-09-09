import type {
  AdminCustomerDetailRequest,
  AuthenticatedRequest,
  CustomerProfileView,
  CustomerSupportNotePage,
  CustomerSupportNoteView,
  RpcResult,
  AppErrorCode,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  customerProfileSchema,
  customerProfileUpdateSchema,
  readCustomerProfile,
} from "../../customer/profile";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import {
  resolveCustomerAdministrationAccess,
  decodeStaffCursor,
  encodeStaffCursor,
  type CustomerAdministrationDeps,
} from "./customer-administration-access";
import {
  beginCustomerAdministrationWrite,
  completeCustomerAdministrationWrite,
  requireCustomerWrite,
} from "./customer-administration-write";

const profileScope = "admin.customers.profile";
const noteScope = "admin.customers.support-note";
const profileInput = customerProfileUpdateSchema.omit({ accountPhone: true }).extend({
  customerId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
});
const noteInput = z
  .object({
    customerId: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
const listInput = z
  .object({
    customerId: z.string().trim().min(1).max(200),
    cursor: z.string().max(1000).optional(),
    limit: z.number().int().min(1).max(100).default(10),
  })
  .strict();
const noteSchema = z.object({
  noteId: z.string().min(1),
  customerId: z.string().min(1),
  authorStaffId: z.string().min(1),
  authorDisplayName: z.string(),
  body: z.string().min(1).max(2000),
  createdAt: z.string(),
});

export async function getAdminCustomerProfile(
  deps: CustomerAdministrationDeps,
  request: AdminCustomerDetailRequest,
): Promise<RpcResult<CustomerProfileView>> {
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.read");
  if (!access.ok) return access;
  const value = await readCustomerProfile(deps.db, request.customerId);
  return value
    ? { ok: true, value, requestId: request.requestId }
    : failure("NOT_FOUND", "Customer not found", request.requestId);
}

async function savedResult<T>(
  db: D1Database,
  scope: string,
  key: string,
  hash: string,
  schema: z.ZodType<T>,
  requestId: string,
): Promise<RpcResult<T> | null> {
  const saved = await findIdempotencyRecord(db, scope, key);
  if (!saved) return null;
  if (saved.requestHash !== hash)
    return failure(
      "IDEMPOTENCY_CONFLICT",
      "This request key was used for a different command",
      requestId,
    );
  if (saved.status !== "SUCCEEDED") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(saved.resultReference ?? "null");
  } catch {
    raw = null;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data, requestId }
    : failure("INTERNAL_ERROR", "The saved command result is unavailable", requestId);
}

export async function updateAdminCustomerProfile(
  deps: CustomerAdministrationDeps,
  request: AuthenticatedRequest,
  input: unknown,
): Promise<RpcResult<CustomerProfileView>> {
  const parsed = profileInput.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Valid preferences, reason and current customer version are required",
      request.requestId,
    );
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  const command = parsed.data;
  const { idempotencyKey: key, ...intent } = command;
  const hash = await requestHash(intent);
  const replay = () =>
    savedResult(deps.db, profileScope, key, hash, customerProfileSchema, request.requestId);
  const previous = await replay();
  if (previous) return previous;
  const target = await readCustomerProfile(deps.db, command.customerId);
  if (!target) return failure("NOT_FOUND", "Customer not found", request.requestId);
  if (target.version !== command.expectedVersion)
    return failure("STALE_VERSION", "Customer changed; refresh before editing", request.requestId);
  const value: CustomerProfileView = {
    ...target,
    preferredLanguage: command.preferredLanguage,
    promotionalEmails: command.promotionalEmails,
    version: target.version + 1,
  };
  const now = Date.now();
  const db = deps.db;
  try {
    await db.batch([
      ...beginCustomerAdministrationWrite(db, {
        ...access.value,
        scope: profileScope,
        key,
        hash,
        resultType: "customer_profile_snapshot",
        now,
      }),
      db
        .prepare(
          "UPDATE customer SET preferred_language=?,promotional_emails=?,version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .bind(
          command.preferredLanguage,
          command.promotionalEmails ? 1 : 0,
          now,
          target.customerId,
          target.version,
        ),
      requireCustomerWrite(db),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: "CUSTOMER.PREFERENCES_UPDATED",
        resourceType: "customer",
        resourceId: target.customerId,
        reason: command.reason,
        details: { version: value.version },
        correlationId: request.requestId,
        idempotencyKey: `${profileScope}:${key}`,
        occurredAt: now,
      }),
      requireCustomerWrite(db),
      ...completeCustomerAdministrationWrite(db, {
        scope: profileScope,
        key,
        hash,
        result: value,
        now,
      }),
    ]);
    return { ok: true, value, requestId: request.requestId };
  } catch {
    return (
      (await replay()) ??
      failure("CONFLICT", "Customer or staff access changed; refresh and retry", request.requestId)
    );
  }
}

export async function appendCustomerSupportNote(
  deps: CustomerAdministrationDeps,
  request: AuthenticatedRequest,
  input: unknown,
): Promise<RpcResult<CustomerSupportNoteView>> {
  const parsed = noteInput.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "A customer, note of at most 2000 characters and request key are required",
      request.requestId,
    );
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.manage");
  if (!access.ok) return access;
  const { idempotencyKey: key, ...intent } = parsed.data;
  const hash = await requestHash(intent);
  const replay = () => savedResult(deps.db, noteScope, key, hash, noteSchema, request.requestId);
  const previous = await replay();
  if (previous) return previous;
  const db = deps.db;
  const now = Date.now();
  const author = await db
    .prepare("SELECT display_name FROM staff_identity WHERE id=?")
    .bind(access.value.staffId)
    .first<{ display_name: string }>();
  if (!author)
    return failure("CONFLICT", "Staff identity changed; refresh and retry", request.requestId);
  const value: CustomerSupportNoteView = {
    noteId: crypto.randomUUID(),
    customerId: intent.customerId,
    authorStaffId: access.value.staffId,
    authorDisplayName: author.display_name,
    body: intent.body,
    createdAt: new Date(now).toISOString(),
  };
  if (!(await db.prepare("SELECT 1 FROM customer WHERE id=?").bind(intent.customerId).first()))
    return failure("NOT_FOUND", "Customer not found", request.requestId);
  try {
    await db.batch([
      ...beginCustomerAdministrationWrite(db, {
        ...access.value,
        scope: noteScope,
        key,
        hash,
        resultType: "customer_support_note_snapshot",
        now,
      }),
      db
        .prepare(
          "INSERT INTO customer_support_note(id,customer_id,author_staff_id,author_display_name,body,created_at,idempotency_key) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM staff_identity WHERE id=? AND display_name=?)",
        )
        .bind(
          value.noteId,
          value.customerId,
          value.authorStaffId,
          value.authorDisplayName,
          value.body,
          now,
          `${noteScope}:${key}`,
          value.authorStaffId,
          value.authorDisplayName,
        ),
      requireCustomerWrite(db),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: "CUSTOMER.SUPPORT_NOTE_ADDED",
        resourceType: "customer",
        resourceId: value.customerId,
        details: { noteId: value.noteId },
        correlationId: request.requestId,
        idempotencyKey: `${noteScope}:${key}`,
        occurredAt: now,
      }),
      requireCustomerWrite(db),
      ...completeCustomerAdministrationWrite(db, {
        scope: noteScope,
        key,
        hash,
        result: value,
        now,
      }),
    ]);
    return { ok: true, value, requestId: request.requestId };
  } catch {
    return (
      (await replay()) ??
      failure("CONFLICT", "Customer or staff access changed; refresh and retry", request.requestId)
    );
  }
}

export async function listCustomerSupportNotes(
  deps: CustomerAdministrationDeps,
  request: AuthenticatedRequest,
  input: unknown,
): Promise<RpcResult<CustomerSupportNotePage>> {
  const parsed = listInput.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "A customer and valid page parameters are required",
      request.requestId,
    );
  const access = await resolveCustomerAdministrationAccess(deps, request, "customers.read");
  if (!access.ok) return access;
  const { customerId, limit, cursor: encoded } = parsed.data;
  const cursor = encoded ? decodeStaffCursor(encoded) : null;
  if (encoded && !cursor)
    return failure("VALIDATION_FAILED", "Invalid notes cursor", request.requestId);
  const rows = await deps.db
    .prepare(
      `SELECT id,customer_id,author_staff_id,author_display_name,body,created_at FROM customer_support_note WHERE customer_id=? ${cursor ? "AND (created_at<? OR (created_at=? AND id<?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
    )
    .bind(customerId, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1)
    .all<{
      id: string;
      customer_id: string;
      author_staff_id: string;
      author_display_name: string;
      body: string;
      created_at: number;
    }>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return {
    ok: true,
    value: {
      items: page.map((row) => ({
        noteId: row.id,
        customerId: row.customer_id,
        authorStaffId: row.author_staff_id,
        authorDisplayName: row.author_display_name,
        body: row.body,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      nextCursor:
        rows.results.length > limit && last
          ? encodeStaffCursor({ id: last.id, createdAt: last.created_at })
          : null,
    },
    requestId: request.requestId,
  };
}
function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}
