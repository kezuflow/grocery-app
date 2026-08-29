import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("admin operations canonical-state migration", () => {
  it("adds operational timestamps and the active procurement context guard", async () => {
    for (const table of ["procurement_requirement", "receiving_record", "delivery_job"]) {
      const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(columns.results.map((row) => row.name)).toEqual(
        expect.arrayContaining(["created_at", "updated_at"]),
      );
    }
    const indexes = await env.DB.prepare("PRAGMA index_list(procurement_requirement)").all<{
      name: string;
      unique: number;
      partial: number;
    }>();
    expect(indexes.results).toContainEqual(
      expect.objectContaining({
        name: "procurement_requirement_active_context_unique",
        unique: 1,
        partial: 1,
      }),
    );
  });
});
