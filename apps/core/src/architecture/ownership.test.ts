import { describe, expect, it } from "vitest";
import { CoreEntrypoint } from "../index";
import { betterAuthSchema } from "../auth/schema";
import { iamSchema } from "../iam/schema";

describe("core architecture ownership (runtime checks)", () => {
  it("exposes no mock commitment surface on the entrypoint", () => {
    expect("commitMockOrder" in CoreEntrypoint.prototype).toBe(false);
  });

  it("keeps Better Auth adapter tables separate from application IAM tables", () => {
    expect(Object.keys(betterAuthSchema).sort()).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);
    expect(Object.keys(iamSchema).sort()).toEqual([
      "customerPrincipal",
      "permission",
      "role",
      "rolePermission",
      "staffIdentity",
      "staffRole",
      "staffScope",
    ]);
  });
});
