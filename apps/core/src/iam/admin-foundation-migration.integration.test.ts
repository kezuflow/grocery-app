import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("admin foundation migration 0026", () => {
  it("seeds canonical capabilities and extends audit query fields", async () => {
    const capabilities = await env.DB.prepare(
      "SELECT code FROM permission WHERE code IN ('customers.read','inventory.adjust','audit.read','settings.manage') ORDER BY code",
    ).all<{ code: string }>();
    expect(capabilities.results.map((row) => row.code)).toEqual([
      "audit.read",
      "customers.read",
      "inventory.adjust",
      "settings.manage",
    ]);
    const columns = await env.DB.prepare("PRAGMA table_info(audit_event)").all<{ name: string }>();
    expect(columns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "market_id",
        "location_id",
        "reason",
        "before_json",
        "after_json",
        "correlation_id",
      ]),
    );
  });

  it("maps legacy inventory:manage assignments additively without deleting history", async () => {
    const legacyPermission = await env.DB.prepare(
      "SELECT id, code FROM permission WHERE code = 'inventory:manage'",
    ).all<{ id: string; code: string }>();
    expect(legacyPermission.results).toEqual([{ id: "perm_inventory_manage", code: "inventory:manage" }]);

    const legacyAssignment = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM role_permission WHERE role_id = 'role_operations_admin' AND permission_id = 'perm_inventory_manage'",
    ).all<{ count: number }>();
    expect(legacyAssignment.results[0]?.count).toBe(1);

    const adminCanonical = await env.DB.prepare(
      "SELECT permission_id FROM role_permission WHERE role_id = 'role_operations_admin' AND permission_id IN ('perm_inventory_read_v1','perm_inventory_adjust_v1') ORDER BY permission_id",
    ).all<{ permission_id: string }>();
    expect(adminCanonical.results.map((row) => row.permission_id)).toEqual([
      "perm_inventory_adjust_v1",
      "perm_inventory_read_v1",
    ]);

    const viewerOperational = await env.DB.prepare(
      "SELECT permission_id FROM role_permission WHERE role_id = 'role_operations_viewer' AND permission_id IN ('perm_orders_read_v1','perm_orders_manage_v1','perm_inventory_read_v1','perm_inventory_adjust_v1') ORDER BY permission_id",
    ).all<{ permission_id: string }>();
    expect(viewerOperational.results.map((row) => row.permission_id)).toEqual([
      "perm_inventory_read_v1",
      "perm_orders_read_v1",
    ]);
  });
});
