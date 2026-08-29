import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("promotion administration migration 0029", () => {
  it("rebuilds promotion with the canonical definition shape", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(promotion)").all<{ name: string }>();
    expect(columns.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "id",
        "code",
        "name",
        "description",
        "status",
        "benefit_type",
        "discount_minor",
        "percent",
        "minimum_minor",
        "starts_at",
        "ends_at",
        "global_usage_limit",
        "per_customer_usage_limit",
        "automatic",
        "priority",
        "version",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("adds customer targeting to promotion grants", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(promotion_grant)").all<{
      name: string;
    }>();
    expect(columns.results.map((row) => row.name)).toContain("customer_id");
  });

  it("enforces one customer grant per promotion code", async () => {
    const indexes = await env.DB.prepare("PRAGMA index_list(promotion_grant)").all<{
      name: string;
      unique: number;
      partial: number;
    }>();
    expect(indexes.results).toContainEqual(
      expect.objectContaining({
        name: "promotion_grant_promotion_customer_unique",
        unique: 1,
        partial: 1,
      }),
    );
    const columns = await env.DB.prepare(
      "PRAGMA index_info(promotion_grant_promotion_customer_unique)",
    ).all<{ name: string }>();
    expect(columns.results.map((row) => row.name)).toEqual(["benefit_code", "customer_id"]);
  });

  it("copies legacy promotions as active fixed-discount definitions", async () => {
    const legacy = await env.DB.prepare(
      "SELECT code, status, benefit_type, discount_minor, minimum_minor, version FROM promotion WHERE code = 'WELCOME50'",
    ).first<{
      code: string;
      status: string;
      benefit_type: string;
      discount_minor: number;
      minimum_minor: number;
      version: number;
    }>();
    expect(legacy).toEqual({
      code: "WELCOME50",
      status: "ACTIVE",
      benefit_type: "ORDER_FIXED_DISCOUNT",
      discount_minor: 5000,
      minimum_minor: 50000,
      version: 1,
    });
  });

  it("enforces the closed lifecycle and per-benefit requirement columns", async () => {
    const now = Date.now();
    let draftAccepted = true;
    try {
      await env.DB.prepare(
        "INSERT INTO promotion (id, code, name, status, benefit_type, discount_minor, minimum_minor, starts_at, version, created_at, updated_at) VALUES (?, ?, 'Draft', 'DRAFT', 'ORDER_FIXED_DISCOUNT', 100, 0, ?, 1, ?, ?)",
      )
        .bind(crypto.randomUUID(), `draft-${crypto.randomUUID().slice(0, 6)}`, now, now, now)
        .run();
    } catch {
      draftAccepted = false;
    }
    expect(draftAccepted).toBe(true);

    let archivedAccepted = true;
    try {
      await env.DB.prepare(
        "INSERT INTO promotion (id, code, name, status, benefit_type, percent, minimum_minor, starts_at, version, created_at, updated_at) VALUES (?, ?, 'Archived', 'ARCHIVED', 'ORDER_PERCENT_DISCOUNT', 10, 0, ?, 1, ?, ?)",
      )
        .bind(crypto.randomUUID(), `arch-${crypto.randomUUID().slice(0, 6)}`, now, now, now)
        .run();
    } catch {
      archivedAccepted = false;
    }
    expect(archivedAccepted).toBe(true);

    // Percent benefit without a percent value fails closed.
    let percentRequired = false;
    try {
      await env.DB.prepare(
        "INSERT INTO promotion (id, code, name, status, benefit_type, minimum_minor, starts_at, version, created_at, updated_at) VALUES (?, ?, 'Bad', 'DRAFT', 'ORDER_PERCENT_DISCOUNT', 0, ?, 1, ?, ?)",
      )
        .bind(crypto.randomUUID(), `bad-${crypto.randomUUID().slice(0, 6)}`, now, now, now)
        .run();
    } catch {
      percentRequired = true;
    }
    expect(percentRequired).toBe(true);
  });
});
