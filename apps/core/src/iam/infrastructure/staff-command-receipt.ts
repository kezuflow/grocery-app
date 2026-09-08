import { adminCapabilityCodes } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { requireStaffWrite } from "./staff-administration-write";

export const staffCommandReceiptSchema = z.object({
  staffId: z.string(),
  authUserId: z.string(),
  displayName: z.string(),
  email: z.string(),
  status: z.enum(["active", "suspended"]),
  version: z.number().int().positive(),
  createdAt: z.string(),
  roleCodes: z.array(z.string()),
  capabilityCodes: z.array(z.enum(adminCapabilityCodes)),
  scopes: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("global") }),
      z.object({ kind: z.literal("market"), marketId: z.string() }),
      z.object({ kind: z.literal("location"), locationId: z.string() }),
    ]),
  ),
});

/** Snapshot current relations inside the winning transaction, including role changes. */
export function completeStaffCommandReceipt(
  database: D1Database,
  input: {
    staffId: string;
    scope: string;
    key: string;
    hash: string;
    now: number;
  },
): D1PreparedStatement[] {
  return [
    database
      .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',updated_at=?,
    result_reference=(SELECT json_object(
      'staffId',s.id,'authUserId',s.auth_user_id,'displayName',s.display_name,'email',u.email,
      'status',s.status,'version',s.version,'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ',s.created_at/1000.0,'unixepoch'),
      'roleCodes',json((SELECT json_group_array(code) FROM (SELECT r.code FROM staff_role sr JOIN role r ON r.id=sr.role_id WHERE sr.staff_id=s.id ORDER BY r.code))),
      'capabilityCodes',json((SELECT json_group_array(code) FROM (SELECT DISTINCT p.code FROM staff_role sr JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id WHERE sr.staff_id=s.id AND p.code IN (SELECT value FROM json_each(?)) ORDER BY p.code))),
      'scopes',json((SELECT json_group_array(json(scope)) FROM (SELECT CASE sc.scope_kind WHEN 'global' THEN json_object('kind','global') WHEN 'market' THEN json_object('kind','market','marketId',sc.market_id) ELSE json_object('kind','location','locationId',sc.location_id) END scope FROM staff_scope sc WHERE sc.staff_id=s.id ORDER BY sc.scope_kind,sc.market_id,sc.location_id)))
    ) FROM staff_identity s JOIN user u ON u.id=s.auth_user_id WHERE s.id=?)
    WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'
      AND EXISTS(SELECT 1 FROM staff_identity WHERE id=?)`)
      .bind(
        input.now,
        JSON.stringify(adminCapabilityCodes),
        input.staffId,
        input.scope,
        input.key,
        input.hash,
        input.staffId,
      ),
    requireStaffWrite(database),
  ];
}
