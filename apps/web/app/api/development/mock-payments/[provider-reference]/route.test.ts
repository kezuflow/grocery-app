import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: "development",
  simulateMockProviderEvent: vi.fn(),
  idempotencyKey: "mock-simulator-key",
}));
vi.mock("cloudflare:workers", () => ({
  env: new Proxy(
    { CORE: {}, PUBLIC_APP_ORIGIN: "http://localhost:3000" },
    {
      get: (target, key) => (key === "ENVIRONMENT" ? mocks.environment : Reflect.get(target, key)),
    },
  ),
}));
vi.mock("@/lib/core-client/core", () => ({
  coreClient: () => ({ simulateMockProviderEvent: mocks.simulateMockProviderEvent }),
}));
vi.mock("@/lib/core-client/commands", () => ({
  requireIdempotencyKey: () => mocks.idempotencyKey,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ "provider-reference": "mock_pay_owned" }) };

beforeEach(() => {
  mocks.environment = "development";
  mocks.simulateMockProviderEvent.mockReset();
  mocks.simulateMockProviderEvent.mockResolvedValue({
    ok: true,
    value: { providerReference: "mock_pay_owned", outcome: "SUCCEEDED" },
  });
});

describe("development mock payment route", () => {
  it("returns 404 without contacting Core outside development and test", async () => {
    mocks.environment = "production";
    const response = await POST(
      new Request("https://freshmarkets.ph/api/development/mock-payments/mock_pay_owned", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: "SUCCEEDED" }),
      }),
      context,
    );
    expect(response.status).toBe(404);
    expect(mocks.simulateMockProviderEvent).not.toHaveBeenCalled();
  });

  it("accepts only the closed outcome and path-owned provider reference", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/development/mock-payments/mock_pay_owned", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: "SUCCEEDED" }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.simulateMockProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: "mock_pay_owned",
        outcome: "SUCCEEDED",
        idempotencyKey: "mock-simulator-key",
      }),
    );
  });

  it.each([
    { outcome: "CAPTURED" },
    { outcome: "SUCCEEDED", amountMinor: 1 },
    { outcome: "SUCCEEDED", currency: "PHP" },
    { outcome: "SUCCEEDED", customerId: "customer-1" },
  ])("rejects non-contract input %# before Core", async (body) => {
    const response = await POST(
      new Request("http://localhost:3000/api/development/mock-payments/mock_pay_owned", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.simulateMockProviderEvent).not.toHaveBeenCalled();
  });
});
