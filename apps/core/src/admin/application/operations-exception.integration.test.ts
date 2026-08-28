import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { listOperationalExceptions } from "../../audit/application/list-operational-exceptions";

describe("converged operational exceptions", () => {
  it("projects source ownership, scope, severity, age, and legal actions", async () => {
    const requirementId = `exception-requirement-${crypto.randomUUID()}`;
    const exceptionId = `exception-${crypto.randomUUID()}`;
    const createdAt = Date.now() - 120_000;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO procurement_requirement (id, delivery_cycle_id, location_id, inventory_pool_id, required_quantity, status, version) VALUES (?, 'cycle-next-cebu', 'location-cebu-central', 'pool-red-onion', 100, 'ORDERED', 1)",
      ).bind(requirementId),
      env.DB.prepare(
        "INSERT INTO supply_exception (id, requirement_id, kind, affected_quantity, status, resolution, created_at, version) VALUES (?, ?, 'SHORTAGE', 1200, 'OPEN', NULL, ?, 1)",
      ).bind(exceptionId, requirementId, createdAt),
    ]);

    const rows = await listOperationalExceptions(env.DB, { locationId: "location-cebu-central" });
    const item = rows.find((row) => row.referenceId === exceptionId);
    expect(item).toMatchObject({
      source: "PROCUREMENT",
      severity: "CRITICAL",
      locationId: "location-cebu-central",
      reason: "SHORTAGE",
      permittedActions: [],
      ownerId: null,
    });
    expect(item?.ageMinutes).toBeGreaterThanOrEqual(1);
  });
});
