import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ environment: "production", notFound: vi.fn() }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("cloudflare:workers", () => ({
  env: new Proxy(
    { PUBLIC_APP_ORIGIN: "https://freshmarkets.ph" },
    {
      get: (target, key) => (key === "ENVIRONMENT" ? mocks.environment : Reflect.get(target, key)),
    },
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    mocks.notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import MockPaymentPage from "@/app/development/mock-payments/[provider-reference]/page";

describe("mock payment page", () => {
  it("invokes the not-found boundary outside development and test", async () => {
    await expect(
      MockPaymentPage({
        params: Promise.resolve({ "provider-reference": "mock_pay_hidden" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
