import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { coreServiceMethodNames, type CoreServiceBinding } from "@freshmarkets/contracts";
import { CoreEntrypoint } from "../index";

const lifecycleMethods = ["fetch", "scheduled"] as const;

function runtimeMethods(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== "constructor")
    .sort();
}

function missingMethods(advertised: readonly string[], prototype: object): string[] {
  const runtime = new Set(runtimeMethods(prototype));
  return advertised.filter((name) => !runtime.has(name));
}

describe("Core Service Binding conformance", () => {
  it("is assignable to the authoritative contract", () => {
    const coreServiceConformance: CoreServiceBinding = new CoreEntrypoint(
      {} as ExecutionContext,
      env,
    );
    expect(coreServiceConformance).toBeInstanceOf(CoreEntrypoint);
  });

  it("exposes every and only contract plus Worker lifecycle methods", () => {
    expect(runtimeMethods(CoreEntrypoint.prototype)).toEqual(
      [...coreServiceMethodNames, ...lifecycleMethods].sort(),
    );
  });

  it("detects an advertised method without a runtime implementation", () => {
    expect(
      missingMethods([...coreServiceMethodNames, "advertisedButMissing"], CoreEntrypoint.prototype),
    ).toEqual(["advertisedButMissing"]);
  });
});
