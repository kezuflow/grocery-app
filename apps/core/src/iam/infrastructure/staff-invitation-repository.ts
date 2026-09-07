import type { Scope, StaffInvitationOffer } from "@freshmarkets/contracts";

export function invitationGrantStatements(
  database: D1Database,
  invitationId: string,
  roleIds: readonly string[],
  scopes: readonly Scope[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const roleId of roleIds) {
    statements.push(
      database
        .prepare(`INSERT INTO staff_invitation_role(invitation_id,role_id)
      SELECT ?,id FROM role WHERE id=? AND status='ACTIVE'`)
        .bind(invitationId, roleId),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -35 WHERE changes()!=1"),
    );
  }
  for (const scope of scopes) {
    const marketId = scope.kind === "market" ? scope.marketId : null;
    const locationId = scope.kind === "location" ? scope.locationId : null;
    statements.push(
      database
        .prepare(`INSERT INTO staff_invitation_scope(id,invitation_id,scope_kind,market_id,location_id)
      SELECT ?,?,?,?,? WHERE (? IS NULL OR EXISTS(SELECT 1 FROM market WHERE id=? AND status='active'))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM fulfillment_location l JOIN market m ON m.id=l.market_id
        WHERE l.id=? AND l.status='active' AND m.status='active'))`)
        .bind(
          crypto.randomUUID(),
          invitationId,
          scope.kind,
          marketId,
          locationId,
          marketId,
          marketId,
          locationId,
          locationId,
        ),
      database.prepare("INSERT INTO commitment_abort(id) SELECT -35 WHERE changes()!=1"),
    );
  }
  return statements;
}

export async function readStaffInvitationOffer(
  database: D1Database,
  email: string,
): Promise<StaffInvitationOffer | null> {
  const row = await database
    .prepare(`SELECT id,display_name,expires_at,version FROM staff_invitation
    WHERE email_normalized=? AND status='PENDING' AND expires_at>?`)
    .bind(email, Date.now())
    .first<{ id: string; display_name: string; expires_at: number; version: number }>();
  if (!row) return null;
  const [roles, scopes] = await Promise.all([
    database
      .prepare(`SELECT r.id AS roleId,r.name FROM staff_invitation_role g JOIN role r ON r.id=g.role_id
      WHERE g.invitation_id=? ORDER BY r.name,r.id`)
      .bind(row.id)
      .all<{ roleId: string; name: string }>(),
    database
      .prepare(`SELECT g.scope_kind,g.market_id,g.location_id,
      CASE g.scope_kind WHEN 'global' THEN 'Global' WHEN 'market' THEN m.name ELSE l.name END AS label
      FROM staff_invitation_scope g LEFT JOIN market m ON m.id=g.market_id
      LEFT JOIN fulfillment_location l ON l.id=g.location_id WHERE g.invitation_id=? ORDER BY g.id`)
      .bind(row.id)
      .all<{
        scope_kind: string;
        market_id: string | null;
        location_id: string | null;
        label: string;
      }>(),
  ]);
  return {
    invitationId: row.id,
    displayName: row.display_name,
    expiresAt: new Date(row.expires_at).toISOString(),
    version: row.version,
    roles: roles.results,
    scopes: scopes.results.map((scope) => {
      if (scope.scope_kind === "global") return { scope: { kind: "global" }, label: scope.label };
      if (scope.scope_kind === "market" && scope.market_id)
        return { scope: { kind: "market", marketId: scope.market_id }, label: scope.label };
      if (scope.scope_kind === "location" && scope.location_id)
        return { scope: { kind: "location", locationId: scope.location_id }, label: scope.label };
      throw new Error("Invalid persisted invitation scope");
    }),
  };
}

export async function acceptInvitationRecord(
  database: D1Database,
  command: {
    invitationId: string;
    expectedVersion: number;
    userId: string;
    email: string;
    staffId: string;
    idempotencyKey: string;
    requestId: string;
    now: number;
  },
): Promise<void> {
  const c = command;
  await database.batch([
    database
      .prepare(`UPDATE staff_invitation SET status='ACCEPTED',accepted_auth_user_id=?,version=version+1,updated_at=?
      WHERE id=? AND email_normalized=? AND status='PENDING' AND version=? AND expires_at>?
      AND EXISTS(SELECT 1 FROM staff_invitation_role WHERE invitation_id=staff_invitation.id)
      AND EXISTS(SELECT 1 FROM staff_invitation_scope WHERE invitation_id=staff_invitation.id)
      AND NOT EXISTS(SELECT 1 FROM staff_invitation_role g JOIN role r ON r.id=g.role_id WHERE g.invitation_id=staff_invitation.id AND r.status!='ACTIVE')
      AND NOT EXISTS(SELECT 1 FROM staff_invitation_scope g LEFT JOIN market m ON m.id=g.market_id
        LEFT JOIN fulfillment_location l ON l.id=g.location_id LEFT JOIN market lm ON lm.id=l.market_id
        WHERE g.invitation_id=staff_invitation.id AND ((g.scope_kind='market' AND m.status!='active')
          OR (g.scope_kind='location' AND (l.status!='active' OR lm.status!='active'))))
      AND NOT EXISTS(SELECT 1 FROM staff_identity WHERE auth_user_id=?)`)
      .bind(c.userId, c.now, c.invitationId, c.email, c.expectedVersion, c.now, c.userId),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -35 WHERE changes()!=1"),
    database
      .prepare(`INSERT INTO staff_identity(id,auth_user_id,display_name,status,version,created_at,updated_at)
      SELECT ?,?,display_name,'active',1,?,? FROM staff_invitation WHERE id=?`)
      .bind(c.staffId, c.userId, c.now, c.now, c.invitationId),
    database
      .prepare(
        "INSERT INTO staff_role(staff_id,role_id) SELECT ?,role_id FROM staff_invitation_role WHERE invitation_id=?",
      )
      .bind(c.staffId, c.invitationId),
    database
      .prepare(`INSERT INTO staff_scope(id,staff_id,scope_kind,market_id,location_id)
      SELECT ?||':'||id,?,scope_kind,market_id,location_id FROM staff_invitation_scope WHERE invitation_id=?`)
      .bind(c.staffId, c.staffId, c.invitationId),
    database
      .prepare(`INSERT INTO audit_event(id,actor_user_id,action,aggregate_type,aggregate_id,details_json,correlation_id,occurred_at)
      VALUES (?,?,'STAFF.INVITATION_ACCEPTED','staff_identity',?,'{}',?,?)`)
      .bind(`staff-invitation:${c.invitationId}`, c.userId, c.staffId, c.requestId, c.now),
    database
      .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=?
      WHERE scope='iam.acceptInvitation' AND idempotency_key=? AND status='PROCESSING'`)
      .bind(c.staffId, c.now, c.idempotencyKey),
    database.prepare("INSERT INTO commitment_abort(id) SELECT -35 WHERE changes()!=1"),
  ]);
}
