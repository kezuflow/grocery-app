import { describe, expect, it } from "vitest";
import { requestHash } from "./idempotency";

describe("idempotency request hashing", () => {
  it("is stable across object key ordering", async () => {
    await expect(requestHash({ b: 2, a: 1 })).resolves.toBe(await requestHash({ a: 1, b: 2 }));
  });

  it("changes when request values change", async () => {
    await expect(requestHash({ amount: 100 })).resolves.not.toBe(
      await requestHash({ amount: 101 }),
    );
  });
});
