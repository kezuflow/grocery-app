import { describe, expect, it } from "vitest";
import { resolveAuthRedirectPath } from "./redirect";

describe("resolveAuthRedirectPath", () => {
  it("preserves same-origin application paths", () => {
    expect(resolveAuthRedirectPath("/admin")).toBe("/admin");
    expect(resolveAuthRedirectPath("/orders?status=open#latest")).toBe(
      "/orders?status=open#latest",
    );
    expect(resolveAuthRedirectPath(["/checkout", "/cart"])).toBe("/checkout");
  });

  it("rejects external and malformed redirect targets", () => {
    expect(resolveAuthRedirectPath("https://example.com/admin")).toBe("/");
    expect(resolveAuthRedirectPath("//example.com/admin")).toBe("/");
    expect(resolveAuthRedirectPath("/\\example.com/admin")).toBe("/");
    expect(resolveAuthRedirectPath(undefined)).toBe("/");
  });
});
