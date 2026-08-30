import { beforeEach, describe, expect, it, vi } from "vitest";

const { listCustomerOrderIssues, submitCustomerOrderIssue } = vi.hoisted(() => ({
  listCustomerOrderIssues: vi.fn(),
  submitCustomerOrderIssue: vi.fn(),
}));
const requireIdempotencyKey = vi.fn();
vi.mock("cloudflare:workers", () => ({ env: { CORE: {} } }));
vi.mock("@/lib/core-client/core", () => ({
  coreClient: () => ({ listCustomerOrderIssues, submitCustomerOrderIssue }),
}));
vi.mock("@/lib/core-client/commands", () => ({
  requireIdempotencyKey: (...args: unknown[]) => requireIdempotencyKey(...args),
}));

import { GET, POST } from "./route";

beforeEach(() => {
  listCustomerOrderIssues.mockReset();
  submitCustomerOrderIssue.mockReset();
  requireIdempotencyKey.mockReset();
});

describe("customer order issue routes", () => {
  it("lists through the thin Core binding route", async () => {
    listCustomerOrderIssues.mockResolvedValue({ ok: true, value: [] });
    const response = await GET(new Request("https://freshmarkets.ph/issues"), {
      params: Promise.resolve({ "order-id": "order-1" }),
    });
    expect(response.status).toBe(200);
    expect(listCustomerOrderIssues).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1" }),
    );
  });

  it("forwards bounded issue data and the stable idempotency key", async () => {
    requireIdempotencyKey.mockReturnValue("issue-key");
    submitCustomerOrderIssue.mockResolvedValue({ ok: true, value: { issueId: "issue-1" } });
    const response = await POST(
      new Request("https://freshmarkets.ph/issues", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "issue-key" },
        body: JSON.stringify({
          category: "POOR_QUALITY",
          description: "The produce arrived badly bruised.",
          affectedOrderItemIds: ["line-1"],
        }),
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );
    expect(response.status).toBe(200);
    expect(submitCustomerOrderIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        category: "POOR_QUALITY",
        affectedOrderItemIds: ["line-1"],
        idempotencyKey: "issue-key",
      }),
    );
  });

  it("rejects oversized or invalid data before Core", async () => {
    requireIdempotencyKey.mockReturnValue("issue-key");
    const response = await POST(
      new Request("https://freshmarkets.ph/issues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "REFUND_ME",
          description: "x".repeat(1001),
          affectedOrderItemIds: [],
        }),
      }),
      { params: Promise.resolve({ "order-id": "order-1" }) },
    );
    expect(response.status).toBe(400);
    expect(submitCustomerOrderIssue).not.toHaveBeenCalled();
  });
});
