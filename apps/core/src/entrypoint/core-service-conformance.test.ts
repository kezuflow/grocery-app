import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { coreServiceMethodNames } from "@freshmarkets/contracts";
import { CoreEntrypoint } from "../index";

const lifecycleMethods = ["fetch", "queue", "scheduled"] as const;

function runtimeMethods(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== "constructor")
    .sort();
}

describe("Core Service Binding conformance", () => {
  it("exposes every and only contract plus Worker lifecycle methods", () => {
    expect(runtimeMethods(CoreEntrypoint.prototype)).toEqual(
      [...coreServiceMethodNames, ...lifecycleMethods].sort(),
    );
  });

  it("validates the manual delivery request envelope before resolving its actor", async () => {
    const service = new CoreEntrypoint({} as ExecutionContext, env);
    expect(
      await service.reviseDeliveryPromise({
        requestId: "",
        headers: {},
        locationId: "location-cebu-central",
        jobId: "job",
        expectedVersion: 1,
        promisedAt: "2026-09-10T00:00:00.000Z",
        agreementNote: "Customer agreed",
        idempotencyKey: "agreement",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await service.manageManualDelivery({
        requestId: "",
        headers: {},
        locationId: "location-cebu-central",
        jobId: "job",
        action: "ASSIGN",
        expectedVersion: 1,
        idempotencyKey: "manual-request",
        personName: "Delivery helper",
        phoneE164: "+639171110000",
        note: "Staff selected a known local rider",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
});
