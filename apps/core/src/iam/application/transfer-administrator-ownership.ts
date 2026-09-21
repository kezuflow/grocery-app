import { z } from "@freshmarkets/validation";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { findIdempotencyRecord, requestHash } from "../../idempotency";

const SCOPE = "iam.administratorOwnershipTransfer";

export const administratorOwnershipTransferSchema = z.object({
  sourceEmail: z.string().trim().email(),
  targetEmail: z.string().trim().email(),
  idempotencyKey: z.string().trim().min(16).max(200),
});

export type AdministratorOwnershipTransferInput = z.infer<
  typeof administratorOwnershipTransferSchema
> & { requestId: string };

export type AdministratorOwnershipTransferResult = {
  targetStaffId: string;
  revokedSessionCount: number;
  removedAccountCount: number;
};

type TransferReceipt = AdministratorOwnershipTransferResult & {
  sourceEmailHash: string;
  targetEmailHash: string;
};

type SourceIdentity = {
  userId: string;
  staffId: string;
  staffVersion: number;
  roleId: string;
};

type TargetIdentity = { userId: string; name: string };

function required(database: D1Database): D1PreparedStatement {
  return database.prepare("INSERT INTO commitment_abort(id) SELECT -35 WHERE changes()!=1");
}

function requiredCount(database: D1Database, count: number): D1PreparedStatement {
  return database
    .prepare("INSERT INTO commitment_abort(id) SELECT -35 WHERE changes()!=?")
    .bind(count);
}

async function emailHash(email: string): Promise<string> {
  return requestHash(email.trim().toLowerCase());
}

async function readReceipt(database: D1Database): Promise<TransferReceipt | null> {
  const row = await database
    .prepare(`SELECT target_staff_id,source_email_hash,target_email_hash,
      revoked_session_count,removed_account_count
      FROM administrator_ownership_transfer WHERE id=1`)
    .first<{
      target_staff_id: string;
      source_email_hash: string;
      target_email_hash: string;
      revoked_session_count: number;
      removed_account_count: number;
    }>();
  return row
    ? {
        targetStaffId: row.target_staff_id,
        sourceEmailHash: row.source_email_hash,
        targetEmailHash: row.target_email_hash,
        revokedSessionCount: row.revoked_session_count,
        removedAccountCount: row.removed_account_count,
      }
    : null;
}

/**
 * One-time production remediation. The public transport is temporary and
 * bearer-gated; every business/auth mutation remains a guarded Core batch.
 */
export async function transferAdministratorOwnership(
  database: D1Database,
  rawInput: AdministratorOwnershipTransferInput,
): Promise<AdministratorOwnershipTransferResult> {
  const input = {
    ...rawInput,
    sourceEmail: rawInput.sourceEmail.trim().toLowerCase(),
    targetEmail: rawInput.targetEmail.trim().toLowerCase(),
  };
  if (input.sourceEmail === input.targetEmail)
    throw new Error("Administrator transfer identities must be distinct");

  const [sourceEmailHash, targetEmailHash] = await Promise.all([
    emailHash(input.sourceEmail),
    emailHash(input.targetEmail),
  ]);
  const hash = await requestHash({
    sourceEmailHash,
    targetEmailHash,
  });

  const replay = async (): Promise<AdministratorOwnershipTransferResult | null> => {
    const [saved, receipt] = await Promise.all([
      findIdempotencyRecord(database, SCOPE, input.idempotencyKey),
      readReceipt(database),
    ]);
    if (!saved || !receipt) return null;
    if (
      saved.requestHash !== hash ||
      receipt.sourceEmailHash !== sourceEmailHash ||
      receipt.targetEmailHash !== targetEmailHash
    )
      throw new Error("Administrator transfer idempotency conflict");
    if (saved.status !== "SUCCEEDED" || saved.resultReference !== receipt.targetStaffId)
      return null;
    return {
      targetStaffId: receipt.targetStaffId,
      revokedSessionCount: receipt.revokedSessionCount,
      removedAccountCount: receipt.removedAccountCount,
    };
  };

  const prior = await replay();
  if (prior) return prior;

  const source = await database
    .prepare(`SELECT u.id AS userId,s.id AS staffId,s.version AS staffVersion,i.role_id AS roleId
      FROM initial_administrator_setup i
      JOIN user u ON u.id=i.auth_user_id
      JOIN staff_identity s ON s.id=i.staff_id AND s.auth_user_id=u.id
      JOIN role r ON r.id=i.role_id
      WHERE lower(trim(u.email))=? AND s.status='active' AND r.status='ACTIVE'`)
    .bind(input.sourceEmail)
    .first<SourceIdentity>();
  const target = await database
    .prepare(`SELECT u.id AS userId,u.name AS name FROM user u
      WHERE lower(trim(u.email))=? AND u.email_verified=1
      AND EXISTS(SELECT 1 FROM account a WHERE a.user_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM staff_identity s WHERE s.auth_user_id=u.id)`)
    .bind(input.targetEmail)
    .first<TargetIdentity>();
  if (!source || !target) throw new Error("Administrator transfer prerequisites are unavailable");

  const count = async (sql: string, ...binds: unknown[]): Promise<number> => {
    const row = await database
      .prepare(sql)
      .bind(...binds)
      .first<{ count: number }>();
    if (!row) throw new Error("Administrator transfer evidence could not be reviewed");
    return row.count;
  };
  const [
    globalStaffCount,
    sourceScopeCount,
    sourceRoleCount,
    sourceSessionCount,
    sourceAccountCount,
    sourceVerificationCount,
  ] = await Promise.all([
    count(
      `SELECT COUNT(*) count FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id
       WHERE s.status='active' AND sc.scope_kind='global'`,
    ),
    count("SELECT COUNT(*) count FROM staff_scope WHERE staff_id=?", source.staffId),
    count("SELECT COUNT(*) count FROM staff_role WHERE staff_id=?", source.staffId),
    count("SELECT COUNT(*) count FROM session WHERE user_id=?", source.userId),
    count("SELECT COUNT(*) count FROM account WHERE user_id=?", source.userId),
    count("SELECT COUNT(*) count FROM verification WHERE lower(identifier)=?", input.sourceEmail),
  ]);
  if (globalStaffCount !== 1 || sourceScopeCount !== 1 || sourceRoleCount !== 1)
    throw new Error("Administrator transfer source access is not the reviewed singleton");

  const capabilities = await database
    .prepare(`SELECT p.code FROM role_permission rp JOIN permission p ON p.id=rp.permission_id
      WHERE rp.role_id=? ORDER BY p.code`)
    .bind(source.roleId)
    .all<{ code: string }>();
  const capabilityCodes = capabilities.results.map(({ code }) => code);
  if (!capabilityCodes.includes("staff.manage"))
    throw new Error("Administrator transfer role lacks staff management authority");

  const targetStaffId = crypto.randomUUID();
  const retiredEmail = `retired-${sourceEmailHash.slice(0, 24)}@invalid.local`;
  const now = Date.now();
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO commitment_abort(id) SELECT -35 WHERE
          EXISTS(SELECT 1 FROM administrator_ownership_transfer)
          OR NOT EXISTS(SELECT 1 FROM initial_administrator_setup i
            JOIN user u ON u.id=i.auth_user_id JOIN staff_identity s ON s.id=i.staff_id
            JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global'
            JOIN staff_role sr ON sr.staff_id=s.id AND sr.role_id=i.role_id
            JOIN role r ON r.id=i.role_id AND r.status='ACTIVE'
            WHERE u.id=? AND lower(trim(u.email))=? AND s.id=? AND s.status='active' AND s.version=?)
          OR (SELECT COUNT(*) FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id
            WHERE s.status='active' AND sc.scope_kind='global')!=1
          OR (SELECT COUNT(*) FROM staff_scope WHERE staff_id=?)!=1
          OR (SELECT COUNT(*) FROM staff_role WHERE staff_id=?)!=1
          OR NOT EXISTS(SELECT 1 FROM user u WHERE u.id=? AND lower(trim(u.email))=?
            AND u.email_verified=1 AND NOT EXISTS(SELECT 1 FROM staff_identity s WHERE s.auth_user_id=u.id)
            AND EXISTS(SELECT 1 FROM account a WHERE a.user_id=u.id))
          OR (SELECT COUNT(*) FROM session WHERE user_id=?)!=?
          OR (SELECT COUNT(*) FROM account WHERE user_id=?)!=?
          OR (SELECT COUNT(*) FROM verification WHERE lower(identifier)=?)!=?`)
        .bind(
          source.userId,
          input.sourceEmail,
          source.staffId,
          source.staffVersion,
          source.staffId,
          source.staffId,
          target.userId,
          input.targetEmail,
          source.userId,
          sourceSessionCount,
          source.userId,
          sourceAccountCount,
          input.sourceEmail,
          sourceVerificationCount,
        ),
      database
        .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
          VALUES (?,?,?,'PROCESSING','staff_identity',?,?)`)
        .bind(SCOPE, input.idempotencyKey, hash, now, now),
      required(database),
      database
        .prepare(`INSERT INTO staff_identity(id,auth_user_id,display_name,status,version,created_at,updated_at)
          VALUES (?,?,?,'active',1,?,?)`)
        .bind(targetStaffId, target.userId, target.name, now, now),
      required(database),
      database
        .prepare("INSERT INTO staff_role(staff_id,role_id) VALUES (?,?)")
        .bind(targetStaffId, source.roleId),
      required(database),
      database
        .prepare(
          "INSERT INTO staff_scope(id,staff_id,scope_kind,market_id,location_id) VALUES (?,?,'global',NULL,NULL)",
        )
        .bind(`administrator-transfer:${targetStaffId}`, targetStaffId),
      required(database),
      database
        .prepare(
          "UPDATE staff_identity SET status='suspended',version=version+1,updated_at=? WHERE id=? AND auth_user_id=? AND status='active' AND version=?",
        )
        .bind(now, source.staffId, source.userId, source.staffVersion),
      required(database),
      database.prepare("DELETE FROM staff_scope WHERE staff_id=?").bind(source.staffId),
      requiredCount(database, sourceScopeCount),
      database.prepare("DELETE FROM staff_role WHERE staff_id=?").bind(source.staffId),
      requiredCount(database, sourceRoleCount),
      database.prepare("DELETE FROM session WHERE user_id=?").bind(source.userId),
      requiredCount(database, sourceSessionCount),
      database.prepare("DELETE FROM account WHERE user_id=?").bind(source.userId),
      requiredCount(database, sourceAccountCount),
      database
        .prepare("DELETE FROM verification WHERE lower(identifier)=?")
        .bind(input.sourceEmail),
      requiredCount(database, sourceVerificationCount),
      database
        .prepare(
          "UPDATE customer_principal SET status='disabled',updated_at=? WHERE auth_user_id=? AND status='active'",
        )
        .bind(now, source.userId),
      database
        .prepare(
          "INSERT INTO commitment_abort(id) SELECT -35 WHERE EXISTS(SELECT 1 FROM customer_principal WHERE auth_user_id=? AND status='active')",
        )
        .bind(source.userId),
      database
        .prepare(
          "UPDATE user SET email=?,name='Retired administrator',email_verified=0,updated_at=? WHERE id=? AND lower(trim(email))=?",
        )
        .bind(retiredEmail, now, source.userId, input.sourceEmail),
      required(database),
      database
        .prepare(`INSERT INTO administrator_ownership_transfer(
          id,source_auth_user_id,source_staff_id,target_auth_user_id,target_staff_id,role_id,
          source_email_hash,target_email_hash,capability_codes_json,revoked_session_count,
          removed_account_count,completed_at) VALUES (1,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(
          source.userId,
          source.staffId,
          target.userId,
          targetStaffId,
          source.roleId,
          sourceEmailHash,
          targetEmailHash,
          JSON.stringify(capabilityCodes),
          sourceSessionCount,
          sourceAccountCount,
          now,
        ),
      required(database),
      auditEventStatement(database, {
        actorUserId: null,
        action: "STAFF.ADMINISTRATOR_OWNERSHIP_TRANSFERRED",
        resourceType: "staff_identity",
        resourceId: targetStaffId,
        reason: "Owner-authorized retirement of retained synthetic production authority",
        details: {
          sourceStaffId: source.staffId,
          scope: { kind: "global" },
          capabilityCodes,
          revokedSessionCount: sourceSessionCount,
          removedAccountCount: sourceAccountCount,
        },
        correlationId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
      }),
      required(database),
      database
        .prepare(
          "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
        )
        .bind(targetStaffId, now, SCOPE, input.idempotencyKey, hash),
      required(database),
    ]);
  } catch (error) {
    const completed = await replay();
    if (completed) return completed;
    throw error;
  }
  return {
    targetStaffId,
    revokedSessionCount: sourceSessionCount,
    removedAccountCount: sourceAccountCount,
  };
}
