import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { listOperationalExceptions } from "../../audit/application/list-operational-exceptions";
import { appendAuditEvent } from "../../audit/application/append-audit-event";

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

  it("keeps the source action vocabulary explicit and records resolution evidence", async () => {
    const actions = [
      { source: "PROCUREMENT", permittedActions: [] },
      { source: "RECEIVING", permittedActions: [] },
      { source: "FULFILLMENT", permittedActions: ["RETRY_FULFILLMENT"] },
      { source: "DELIVERY", permittedActions: ["RETRY_DELIVERY"] },
    ] as const;
    expect(actions.map((item) => item.permittedActions)).toEqual([
      [],
      [],
      ["RETRY_FULFILLMENT"],
      ["RETRY_DELIVERY"],
    ]);
    const idempotencyKey = `exception-resolution-${crypto.randomUUID()}`;
    expect(
      await appendAuditEvent(env.DB, {
        actorUserId: null,
        action: "OPERATIONS.FULFILLMENT_EXCEPTION_RESOLVED",
        resourceType: "fulfillment_record",
        resourceId: `fulfillment-${crypto.randomUUID()}`,
        reason: "retry approved",
        details: { source: "FULFILLMENT" },
        idempotencyKey,
        correlationId: crypto.randomUUID(),
        occurredAt: Date.now(),
      }),
    ).toBe(true);
    const audit = await env.DB.prepare(
      "SELECT reason FROM audit_event WHERE action=? AND idempotency_key=?",
    )
      .bind("OPERATIONS.FULFILLMENT_EXCEPTION_RESOLVED", idempotencyKey)
      .first<{ reason: string }>();
    expect(audit?.reason).toBe("retry approved");
  });
});
