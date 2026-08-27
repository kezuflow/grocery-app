import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("staff administration migration 0027", () => {
  it("creates staff invitations and extends identity and role administration columns", async () => {
    const invitationColumns = await env.DB.prepare("PRAGMA table_info(staff_invitation)").all<{
      name: string;
    }>();
    expect(invitationColumns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "id",
        "email_normalized",
        "display_name",
        "status",
        "invited_by_staff_id",
        "expires_at",
        "accepted_auth_user_id",
        "version",
        "idempotency_key",
        "created_at",
        "updated_at",
      ]),
    );

    const identityColumns = await env.DB.prepare("PRAGMA table_info(staff_identity)").all<{
      name: string;
    }>();
    expect(identityColumns.results.map((row) => row.name)).toContain("version");

    const roleColumns = await env.DB.prepare("PRAGMA table_info(role)").all<{ name: string }>();
    expect(roleColumns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining(["description", "status", "version"]),
    );
  });

  it("backfills existing roles as active versioned rows with empty descriptions", async () => {
    const seeded = await env.DB.prepare(
      "SELECT code, description, status, version FROM role WHERE id = 'role_operations_admin'",
    ).first<{ code: string; description: string; status: string; version: number }>();
    expect(seeded).toEqual({
      code: "operations_admin",
      description: "",
      status: "ACTIVE",
      version: 1,
    });
  });
});
