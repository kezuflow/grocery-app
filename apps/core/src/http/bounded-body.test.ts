import { describe, expect, it } from "vitest";
import { z } from "@freshmarkets/validation";
import { readBoundedJson, readBoundedText } from "./bounded-body";

describe("bounded Core request bodies", () => {
  it("preserves exact webhook text", async () => {
    const raw = '{\r\n  "signed": "exact"\r\n}';
    await expect(
      readBoundedText(
        new Request("https://core.test/webhooks/payments/mock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw,
        }),
        { maxBytes: 128, contentTypes: ["application/json"] },
      ),
    ).resolves.toEqual({ ok: true, value: raw });
  });

  it("allows only an empty body when the caller permits a missing content type", async () => {
    await expect(
      readBoundedText(
        new Request("https://core.test/webhooks/delivery/lalamove", {
          method: "POST",
          body: new Uint8Array(0),
        }),
        {
          maxBytes: 128,
          contentTypes: ["application/json"],
          allowEmptyWithoutContentType: true,
        },
      ),
    ).resolves.toEqual({ ok: true, value: "" });

    await expect(
      readBoundedText(
        new Request("https://core.test/webhooks/delivery/lalamove", {
          method: "POST",
          body: new TextEncoder().encode("not-json"),
        }),
        {
          maxBytes: 128,
          contentTypes: ["application/json"],
          allowEmptyWithoutContentType: true,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" },
    });
  });

  it("validates JSON only after the bounded read", async () => {
    const result = await readBoundedJson(
      new Request("https://core.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"event":"paid"}',
      }),
      z.object({ event: z.literal("paid") }),
      { maxBytes: 64 },
    );
    expect(result).toEqual({ ok: true, value: { event: "paid" } });
  });
});
