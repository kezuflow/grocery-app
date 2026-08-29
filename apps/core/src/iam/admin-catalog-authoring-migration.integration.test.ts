import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("admin catalog authoring migration 0041", () => {
  it("adds guarded category hierarchy/version columns and product media storage", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(category)").all<{
      name: string;
      dflt_value: string | null;
    }>();
    expect(columns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "parent_id" }),
        expect.objectContaining({ name: "version", dflt_value: "1" }),
      ]),
    );
    const seeded = await env.DB.prepare(
      "SELECT MIN(version) AS minimumVersion FROM category",
    ).first<{ minimumVersion: number }>();
    expect(seeded?.minimumVersion).toBe(1);
    const media = await env.DB.prepare("PRAGMA table_info(product_media)").all<{ name: string }>();
    expect(media.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "id",
        "product_id",
        "object_key",
        "mime_type",
        "alt_text",
        "is_primary",
        "sort_order",
        "status",
        "version",
      ]),
    );
  });
});
