import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("customer crm migration 0028", () => {
  it("creates customer invitations and privacy requests", async () => {
    const invitationColumns = await env.DB.prepare("PRAGMA table_info(customer_invitation)").all<{
      name: string;
    }>();
    expect(invitationColumns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "id",
        "email_normalized",
        "status",
        "invited_by_staff_id",
        "expires_at",
        "accepted_customer_id",
        "version",
        "idempotency_key",
        "created_at",
        "updated_at",
      ]),
    );

    const privacyColumns = await env.DB.prepare("PRAGMA table_info(privacy_request)").all<{
      name: string;
    }>();
    expect(privacyColumns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "id",
        "customer_id",
        "request_type",
        "status",
        "requested_at",
        "verified_at",
        "resolved_at",
        "assigned_staff_id",
        "reason",
        "resolution",
        "version",
        "idempotency_key",
      ]),
    );
  });

  it("enforces one pending invitation per email and unique idempotency keys", async () => {
    const now = Date.now();
    const first = await env.DB.prepare(
      "INSERT INTO customer_invitation (id, email_normalized, status, invited_by_staff_id, expires_at, version, idempotency_key, created_at, updated_at) VALUES (?, ?, 'PENDING', NULL, ?, 1, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), "pending-probe@example.com", now + 1000, "k-1", now, now)
      .run();
    expect(first.meta?.changes).toBe(1);

    // The partial unique index makes a second PENDING invitation for the same
    // email impossible; D1 surfaces this as a thrown constraint violation.
    let duplicateRejected = false;
    try {
      await env.DB.prepare(
        "INSERT INTO customer_invitation (id, email_normalized, status, invited_by_staff_id, expires_at, version, idempotency_key, created_at, updated_at) VALUES (?, ?, 'PENDING', NULL, ?, 1, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), "pending-probe@example.com", now + 1000, "k-2", now, now)
        .run();
    } catch {
      duplicateRejected = true;
    }
    expect(duplicateRejected).toBe(true);

    const secondEmail = await env.DB.prepare(
      "INSERT INTO customer_invitation (id, email_normalized, status, invited_by_staff_id, expires_at, version, idempotency_key, created_at, updated_at) VALUES (?, ?, 'PENDING', NULL, ?, 1, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), "pending-two@example.com", now + 1000, "k-3", now, now)
      .run();
    expect(secondEmail.meta?.changes).toBe(1);
  });
});
