import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  pauseSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  beginPaidEnrollment: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { CORE: core } }));

import { POST as pause } from "@/app/api/membership/pause/route";
import { POST as resume } from "@/app/api/membership/resume/route";
import { POST as cancel } from "@/app/api/membership/cancel/route";
import { POST as enroll } from "@/app/api/membership/enroll/route";

beforeEach(() => {
  for (const method of Object.values(core)) {
    method.mockReset().mockResolvedValue({ ok: true, value: {} });
  }
});

function request(path: string, body: unknown) {
  return new Request(`https://freshmarkets.ph${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "membership-action-123",
    },
    body: JSON.stringify(body),
  });
}

describe("customer membership lifecycle routes", () => {
  it("forwards expected version and stable idempotency for lifecycle actions", async () => {
    await pause(
      request("/api/membership/pause", { expectedVersion: 4, reason: "Customer request" }),
    );
    await resume(request("/api/membership/resume", { expectedVersion: 5 }));
    await cancel(request("/api/membership/cancel", { expectedVersion: 6, timing: "PERIOD_END" }));
    expect(core.pauseSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 4, idempotencyKey: "membership-action-123" }),
    );
    expect(core.resumeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 5, idempotencyKey: "membership-action-123" }),
    );
    expect(core.cancelSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 6,
        timing: "PERIOD_END",
        idempotencyKey: "membership-action-123",
      }),
    );
  });

  it("forwards paid enrollment without inventing activation", async () => {
    await enroll(request("/api/membership/enroll", { offerId: "offer-membership-monthly" }));
    expect(core.beginPaidEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: "offer-membership-monthly",
        idempotencyKey: "membership-action-123",
      }),
    );
  });

  it("rejects invalid lifecycle bodies before Core", async () => {
    const response = await cancel(
      request("/api/membership/cancel", { expectedVersion: -1, timing: "NOW" }),
    );
    expect(response.status).toBe(400);
    expect(core.cancelSubscription).not.toHaveBeenCalled();
  });
});
