import { beforeEach, expect, it, vi } from "vitest";
const core = vi.hoisted(() => ({ getPublishedProductMedia: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { CORE: core } }));
import { GET } from "@/app/media/products/[media-id]/[version]/route";
const context = { params: Promise.resolve({ "media-id": "image-1", version: "1" }) };
beforeEach(() => core.getPublishedProductMedia.mockReset());
it("checks Core on cache misses before honoring an ETag", async () => {
  core.getPublishedProductMedia.mockResolvedValue({
    ok: true,
    requestId: "r",
    value: { bytes: new Uint8Array([1, 2]).buffer, mimeType: "image/jpeg", etag: '"image-etag"' },
  });
  const request = new Request("https://freshmarkets.test/media/products/image-1/1", {
    headers: { "if-none-match": '"image-etag"' },
  });
  const cached = await GET(request, context);
  expect(cached.status).toBe(304);
  expect(cached.headers.get("cache-control")).toBe("public, max-age=300, must-revalidate");
  expect(cached.headers.get("x-content-type-options")).toBe("nosniff");
  core.getPublishedProductMedia.mockResolvedValue({ ok: false, error: { code: "NOT_FOUND" } });
  const removed = await GET(request, context);
  expect(removed.status).toBe(404);
  expect(removed.headers.get("cache-control")).toBe("no-store");
  expect(core.getPublishedProductMedia).toHaveBeenCalledTimes(2);
});
it("rejects malformed versions before calling Core", async () => {
  expect(
    (
      await GET(new Request("https://freshmarkets.test/image"), {
        params: Promise.resolve({ "media-id": "image-1", version: "1e2" }),
      })
    ).status,
  ).toBe(404);
  expect(core.getPublishedProductMedia).not.toHaveBeenCalled();
});
