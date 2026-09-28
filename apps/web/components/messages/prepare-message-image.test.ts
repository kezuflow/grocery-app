import { afterEach, expect, it, vi } from "vitest";
import { prepareMessageImage } from "./prepare-message-image";

afterEach(() => vi.unstubAllGlobals());

it("prepares a large phone photo once as a bounded WebP upload", async () => {
  const bytes = new Uint8Array(6_000_000);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x0b, 0xb8, 0x0f, 0xa0]);
  const source = new File([bytes], "receipt.jpg", { type: "image/jpeg" });
  const close = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (done: (blob: Blob) => void) => done(new Blob(["processed"], { type: "image/webp" })),
  };
  const decode = vi.fn(async () => ({ width: 2560, height: 1920, close }));
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("document", { createElement: () => canvas });

  const prepared = await prepareMessageImage(source);

  expect(prepared).toMatchObject({ name: "receipt.webp", type: "image/webp" });
  expect(prepared.size).toBeLessThan(5 * 1024 * 1024);
  expect(canvas).toMatchObject({ width: 2560, height: 1920 });
  expect(drawImage).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledWith(source, {
    resizeWidth: 2560,
    resizeHeight: 1920,
    resizeQuality: "high",
  });
  expect(close).toHaveBeenCalledOnce();
});

it("passes a bounded HEIC photo to Core when the browser cannot decode it", async () => {
  const source = new File([new Uint8Array(8_000_000)], "camera.heic");
  vi.stubGlobal("createImageBitmap", async () => {
    throw new Error("Unsupported browser codec");
  });

  const prepared = await prepareMessageImage(source);

  expect(prepared.type).toBe("image/heic");
  expect(prepared.name).toBe("camera.heic");
});

it("keeps a rotated phone JPEG portrait when requesting a bounded decode", async () => {
  const bytes = new Uint8Array(6_000_000);
  bytes.set([
    0xff, 0xd8, 0xff, 0xe1, 0, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0,
    1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x0b, 0xb8, 0x0f,
    0xa0,
  ]);
  const source = new File([bytes], "portrait.jpg", { type: "image/jpeg" });
  const decode = vi.fn(async () => ({ width: 1920, height: 2560, close: vi.fn() }));
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (done: (blob: Blob) => void) => done(new Blob(["processed"], { type: "image/webp" })),
    }),
  });
  await prepareMessageImage(source);
  expect(decode).toHaveBeenCalledWith(source, {
    resizeWidth: 1920,
    resizeHeight: 2560,
    resizeQuality: "high",
  });
});

it("rejects originals above the server cap before browser decoding", async () => {
  const source = new File(["photo"], "huge.jpg", { type: "image/jpeg" });
  Object.defineProperty(source, "size", { value: 18_000_001 });
  const decode = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);

  await expect(prepareMessageImage(source)).rejects.toThrow("smaller than 18 MB");
  expect(decode).not.toHaveBeenCalled();
});
