import { describe, expect, it } from "vitest";
import { z } from "@freshmarkets/validation";
import { readBoundedJson, readBoundedText } from "./bounded-body";

function streamedRequest(chunks: Array<Uint8Array | Error>, contentType = "application/json") {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (!chunk) return controller.close();
      if (chunk instanceof Error) return controller.error(chunk);
      controller.enqueue(chunk);
    },
  });
  return new Request("https://example.test/command", {
    method: "POST",
    headers: { "content-type": contentType },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("bounded Web request bodies", () => {
  it("preserves exact bounded text and accepts charset parameters", async () => {
    const body = '{"name":"Café"}';
    const result = await readBoundedText(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body,
      }),
      { maxBytes: 64, contentTypes: ["application/json"] },
    );
    expect(result).toEqual({ ok: true, value: body });
  });

  it.each([
    ["text/plain", "UNSUPPORTED_MEDIA_TYPE", 415],
    ["application/json", "BODY_TOO_LARGE", 413],
  ])("rejects media and declared size before reading", async (contentType, code, status) => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": contentType, "content-length": "100" },
      body: "{}",
    });
    const result = await readBoundedText(request, {
      maxBytes: contentType === "text/plain" ? 200 : 2,
      contentTypes: ["application/json"],
    });
    expect(result).toMatchObject({ ok: false, error: { code, status } });
  });

  it("rejects malformed and negative Content-Length", async () => {
    for (const value of ["wat", "-1"]) {
      const result = await readBoundedText(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "application/json", "content-length": value },
          body: "{}",
        }),
        { maxBytes: 32, contentTypes: ["application/json"] },
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "INVALID_CONTENT_LENGTH", status: 400 },
      });
    }
  });

  it("counts chunked and multibyte bodies as bytes", async () => {
    const encoder = new TextEncoder();
    const result = await readBoundedText(
      streamedRequest([encoder.encode("é"), encoder.encode("é")]),
      { maxBytes: 3, contentTypes: ["application/json"] },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "BODY_TOO_LARGE", status: 413 } });
  });

  it("distinguishes malformed JSON, schema failure, and stream failure", async () => {
    const schema = z.object({ count: z.number().int() });
    await expect(
      readBoundedJson(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
        schema,
        { maxBytes: 32 },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "MALFORMED_JSON" } });
    await expect(
      readBoundedJson(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"count":"one"}',
        }),
        schema,
        { maxBytes: 64 },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "BODY_VALIDATION_FAILED" } });
    await expect(
      readBoundedText(streamedRequest([new Error("private stream detail")]), {
        maxBytes: 64,
        contentTypes: ["application/json"],
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "BODY_READ_FAILED" } });
  });
});
