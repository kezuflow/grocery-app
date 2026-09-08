import type { Capability } from "@freshmarkets/contracts";

export async function readInitialAdministratorSetup(database: D1Database, userId: string) {
  return database
    .prepare(
      "SELECT staff_id AS staffId FROM initial_administrator_setup WHERE id=1 AND auth_user_id=?",
    )
    .bind(userId)
    .first<{ staffId: string }>();
}

export async function initialAdministratorSetupAvailable(
  database: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await database
    .prepare(`SELECT 1 AS available WHERE
    NOT EXISTS (SELECT 1 FROM initial_administrator_setup)
    AND NOT EXISTS (SELECT 1 FROM staff_scope WHERE scope_kind='global')
    AND NOT EXISTS (SELECT 1 FROM staff_identity WHERE auth_user_id=?)`)
    .bind(userId)
    .first();
  return row !== null;
}

export async function completeInitialAdministratorRecord(
  database: D1Database,
  command: {
    userId: string;
    configuredEmail: string;
    staffId: string;
    roleId: string;
    capabilities: readonly Capability[];
    idempotencyKey: string;
    requestHash: string;
    requestId: string;
    now: number;
  },
): Promise<void> {
  const c = command;
  const required = () =>
    database.prepare("INSERT INTO commitment_abort(id) SELECT -35 WHERE changes()!=1");
  const statements = [
    database
      .prepare(`INSERT INTO commitment_abort(id) SELECT -35 WHERE
      NOT EXISTS (SELECT 1 FROM user WHERE id=? AND lower(trim(email))=? AND email_verified=1)
      OR EXISTS (SELECT 1 FROM initial_administrator_setup)
      OR EXISTS (SELECT 1 FROM staff_scope WHERE scope_kind='global')
      OR EXISTS (SELECT 1 FROM staff_identity WHERE auth_user_id=?)`)
      .bind(c.userId, c.configuredEmail, c.userId),
    database
      .prepare(`INSERT INTO idempotency_records(scope,idempotency_key,request_hash,status,result_type,created_at,updated_at)
      VALUES ('iam.initialAdministrator',?,?,'PROCESSING','staff_identity',?,?)`)
      .bind(c.idempotencyKey, c.requestHash, c.now, c.now),
    required(),
    database
      .prepare(`INSERT INTO role(id,code,name,description,status,version,created_at)
      VALUES (?,?,'Initial Global administrator','Explicit setup capability grants','ACTIVE',1,?)`)
      .bind(c.roleId, `initial-global-${c.roleId}`, c.now),
    required(),
    database
      .prepare(`INSERT INTO staff_identity(id,auth_user_id,display_name,status,version,created_at,updated_at)
      SELECT ?,id,name,'active',1,?,? FROM user WHERE id=?`)
      .bind(c.staffId, c.now, c.now, c.userId),
    required(),
    database
      .prepare("INSERT INTO staff_role(staff_id,role_id) VALUES (?,?)")
      .bind(c.staffId, c.roleId),
    required(),
    database
      .prepare(
        "INSERT INTO staff_scope(id,staff_id,scope_kind,market_id,location_id) VALUES (?,?,'global',NULL,NULL)",
      )
      .bind(`initial-global:${c.staffId}`, c.staffId),
    required(),
  ];
  for (const capability of c.capabilities)
    statements.push(
      database
        .prepare(
          "INSERT INTO role_permission(role_id,permission_id) SELECT ?,id FROM permission WHERE code=?",
        )
        .bind(c.roleId, capability),
      required(),
    );
  statements.push(
    database
      .prepare(
        "INSERT INTO initial_administrator_setup(id,auth_user_id,staff_id,role_id,capability_codes_json,completed_at) VALUES (1,?,?,?,?,?)",
      )
      .bind(c.userId, c.staffId, c.roleId, JSON.stringify(c.capabilities), c.now),
    required(),
    database
      .prepare(`INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,correlation_id,occurred_at)
      VALUES ('initial-administrator-setup',?,'STAFF.INITIAL_ADMINISTRATOR_CREATED','staff_identity',?,?,?,?)`)
      .bind(
        c.userId,
        c.staffId,
        JSON.stringify({ capabilityCodes: c.capabilities, scope: { kind: "global" } }),
        c.requestId,
        c.now,
      ),
    required(),
    database
      .prepare(
        "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope='iam.initialAdministrator' AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
      )
      .bind(c.staffId, c.now, c.idempotencyKey, c.requestHash),
    required(),
  );
  await database.batch(statements);
}
