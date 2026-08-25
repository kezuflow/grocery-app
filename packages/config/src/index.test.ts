import { describe, expect, it } from "vitest";
import { runtimeEnvironment } from "./index";

describe("runtime environment", () => {
  it("uses development for unset and unrecognized values", () => {
    expect(runtimeEnvironment(undefined)).toBe("development");
    expect(runtimeEnvironment("test")).toBe("development");
  });

  it("preserves supported deployment environments", () => {
    expect(runtimeEnvironment("preview")).toBe("preview");
    expect(runtimeEnvironment("staging")).toBe("staging");
    expect(runtimeEnvironment("production")).toBe("production");
  });
});
