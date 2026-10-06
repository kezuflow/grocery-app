import { beforeEach, expect, it, vi } from "vitest";

const { limit, read, stage, cancel } = vi.hoisted(() => ({
  limit: vi.fn(),
  read: vi.fn(),
  stage: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  env: {
    MESSAGE_UPLOAD_RATE: { limit },
    CORE: {
      getCustomerOrderMessages: read,
      stageCustomerOrderMessageAttachment: stage,
      cancelCustomerOrderMessageAttachment: cancel,
    },
  },
}));

import { cancelAttachment, stageAttachment } from "@/lib/http/order-messaging-routes";

function request() {
  const form = new FormData();
  form.set("file", new File(["image"], "evidence.png", { type: "image/png" }));
  return new Request("https://freshmarkets.ph/api/commerce/messages/order-1/attachments", {
    method: "POST",
    headers: {
      "idempotency-key": "photo-key-12345678",
      cookie: "better-auth.session_token=test-session",
    },
    body: form,
  });
}

beforeEach(() => {
  limit.mockReset().mockResolvedValue({ success: true });
  read.mockReset().mockResolvedValue({ ok: true, value: { items: [] }, requestId: "test" });
  stage.mockReset();
  cancel.mockReset().mockResolvedValue({ ok: true, value: { canceled: true }, requestId: "test" });
});

it("limits upload requests before consuming multipart bytes", async () => {
  limit.mockResolvedValue({ success: false });
  const input = request();
  const result = await stageAttachment(input, "CUSTOMER", "order-1");
  expect(result.status).toBe(429);
  expect(input.bodyUsed).toBe(false);
  expect(read).toHaveBeenCalledOnce();
  expect(stage).not.toHaveBeenCalled();
});

it("rejects unauthenticated upload before consuming multipart bytes", async () => {
  read.mockResolvedValue({
    ok: false,
    error: {
      code: "UNAUTHENTICATED",
      message: "Authentication is required",
      requestId: "test",
    },
  });
  const input = request();
  const result = await stageAttachment(input, "CUSTOMER", "order-1");
  expect(result.status).toBe(401);
  expect(input.bodyUsed).toBe(false);
  expect(limit).not.toHaveBeenCalled();
  expect(stage).not.toHaveBeenCalled();
});

it("forwards removal with the original upload identity", async () => {
  const result = await cancelAttachment(
    new Request("https://freshmarkets.ph/api/commerce/messages/order-1/attachments", {
      method: "DELETE",
      headers: { "idempotency-key": "photo-key-12345678" },
    }),
    "CUSTOMER",
    "order-1",
  );
  expect(result.status).toBe(200);
  expect(cancel).toHaveBeenCalledWith(
    expect.objectContaining({
      orderId: "order-1",
      idempotencyKey: "photo-key-12345678",
    }),
  );
});

it("surfaces an Images account limit as unavailable", async () => {
  stage.mockResolvedValue({
    ok: false,
    error: {
      code: "CONFIGURATION_ERROR",
      message: "Photo uploads are temporarily unavailable",
      requestId: "test",
    },
  });
  const result = await stageAttachment(request(), "CUSTOMER", "order-1");
  expect(result.status).toBe(503);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
});
