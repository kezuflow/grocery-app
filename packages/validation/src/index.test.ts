import { describe, expect, it } from "vitest";
import { coordinateSchema, idempotencyKeySchema, positiveIntegerSchema } from "./index";

describe("validation primitives", () => {
  it("rejects malformed IDs and idempotency keys", () => {
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("checkout-1").success).toBe(true);
  });

  it("accepts finite coordinates and positive integer quantities only", () => {
    expect(coordinateSchema.safeParse(Number.NaN).success).toBe(false);
    expect(positiveIntegerSchema.safeParse(2).success).toBe(true);
    expect(positiveIntegerSchema.safeParse(0).success).toBe(false);
  });
});
