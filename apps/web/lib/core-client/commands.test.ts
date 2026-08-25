import { describe, expect, it } from "vitest";
import { requireExpectedVersion, requireIdempotencyKey } from "./commands";

function requestWith(headers: Record<string, string>, body?: unknown): Request {
  return new Request("https://freshmarkets.ph/api/commerce/checkout", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("requireIdempotencyKey", () => {
  it("accepts the Idempotency-Key header as primary transport", () => {
    expect(requireIdempotencyKey(requestWith({ "idempotency-key": "stable-command-1" }))).toBe(
      "stable-command-1",
    );
  });

  it("accepts an exactly matching body key during compatibility", () => {
    expect(
      requireIdempotencyKey(
        requestWith(
          { "idempotency-key": "stable-command-1" },
          { idempotencyKey: "stable-command-1" },
        ),
        "stable-command-1",
      ),
    ).toBe("stable-command-1");
    expect(
      requireIdempotencyKey(requestWith({}, { idempotencyKey: "body-only-key" }), "body-only-key"),
    ).toBe("body-only-key");
  });

  it("rejects missing keys and mismatched duplicates without generating one", () => {
    expect(() => requireIdempotencyKey(requestWith({}))).toThrow("IDEMPOTENCY_KEY_REQUIRED");
    expect(() => requireIdempotencyKey(requestWith({ "idempotency-key": "a" }), "b")).toThrow(
      "IDEMPOTENCY_KEY_MISMATCH",
    );
    expect(() => requireIdempotencyKey(requestWith({ "idempotency-key": "   " }))).toThrow(
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  });
});

describe("requireExpectedVersion", () => {
  it("accepts integer nonnegative versions including zero", () => {
    expect(requireExpectedVersion(0)).toBe(0);
    expect(requireExpectedVersion(7)).toBe(7);
  });

  it("rejects missing or invalid versions", () => {
    expect(() => requireExpectedVersion(undefined)).toThrow("EXPECTED_VERSION_REQUIRED");
    expect(() => requireExpectedVersion(null)).toThrow("EXPECTED_VERSION_REQUIRED");
    expect(() => requireExpectedVersion(-1)).toThrow("EXPECTED_VERSION_INVALID");
    expect(() => requireExpectedVersion(1.5)).toThrow("EXPECTED_VERSION_INVALID");
    expect(() => requireExpectedVersion("2")).toThrow("EXPECTED_VERSION_INVALID");
  });
});
