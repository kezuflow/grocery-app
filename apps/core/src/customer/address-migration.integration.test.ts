import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

const structuredColumns = [
  "address_components_json",
  "barangay",
  "city",
  "postal_code",
  "geocode_provider",
  "geocode_reference",
  "confirmation_source",
  "user_confirmed_at",
  "delivery_instructions_json",
] as const;

describe("Mapbox address confirmation migration", () => {
  it("adds nullable structured confirmation fields without rewriting legacy rows", async () => {
    const customerId = `customer-${crypto.randomUUID()}`;
    const principalId = `principal-${crypto.randomUUID()}`;
    const authUserId = `auth-${crypto.randomUUID()}`;
    const addressId = `address-${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Legacy User', ?, 1, 0, 0)",
      ).bind(authUserId, `${authUserId}@example.com`),
      env.DB.prepare(
        "INSERT INTO customer_principal (id, auth_user_id, status, created_at, updated_at) VALUES (?, ?, 'active', 0, 0)",
      ).bind(principalId, authUserId),
      env.DB.prepare(
        "INSERT INTO customer (id, auth_user_id, principal_id, status, version, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, 0, 0)",
      ).bind(customerId, authUserId, principalId),
      env.DB.prepare(
        "INSERT INTO customer_address (id, customer_id, label, recipient, phone, address_json, latitude, longitude, status, version, created_at, updated_at) VALUES (?, ?, 'Legacy', 'Recipient', '09000000000', ?, 10.32, 123.9, 'active', 1, 0, 0)",
      ).bind(addressId, customerId, '{"line1":"Cebu City"}'),
    ]);

    const tableInfo = await env.DB.prepare("PRAGMA table_info(customer_address)").all<{
      name: string;
      notnull: number;
    }>();
    const byName = new Map(tableInfo.results.map((column) => [column.name, column]));
    for (const columnName of structuredColumns) {
      expect(byName.get(columnName), `${columnName} should exist`).toMatchObject({ notnull: 0 });
    }

    const legacy = await env.DB.prepare(
      `SELECT address_json, ${structuredColumns.join(", ")} FROM customer_address WHERE id=?`,
    )
      .bind(addressId)
      .first<Record<(typeof structuredColumns)[number] | "address_json", string | number | null>>();
    expect(legacy?.address_json).toBe('{"line1":"Cebu City"}');
    for (const columnName of structuredColumns) expect(legacy?.[columnName]).toBeNull();
  });

  it("creates owner/status and resolved-zone query indexes", async () => {
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='customer_address' ORDER BY name",
    ).all<{ name: string }>();
    expect(indexes.results.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "customer_address_owner_status_updated_idx",
        "customer_address_resolved_zone_idx",
      ]),
    );
  });

  it("registers 0042 without modifying or renumbering the tracked 0041 migration", async () => {
    const migrations = await env.DB.prepare(
      "SELECT name FROM d1_migrations WHERE name LIKE '0041%' OR name LIKE '0042%' ORDER BY name",
    ).all<{ name: string }>();
    expect(migrations.results.map((migration) => migration.name)).toEqual([
      "0041_admin_catalog_authoring.sql",
      "0042_mapbox_address_confirmation.sql",
    ]);
  });
});
