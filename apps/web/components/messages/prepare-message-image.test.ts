import { afterEach, expect, it, vi } from "vitest";
import { prepareMessageImage } from "./prepare-message-image";

afterEach(() => vi.unstubAllGlobals());

it("prepares a large phone photo once as a bounded WebP upload", async () => {
  const source = new File(["photo"], "receipt.jpg", { type: "image/jpeg" });
  Object.defineProperty(source, "size", { value: 6_000_000 });
  const close = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (done: (blob: Blob) => void) => done(new Blob(["processed"], { type: "image/webp" })),
  };
  vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close }));
  vi.stubGlobal("document", { createElement: () => canvas });

  const prepared = await prepareMessageImage(source);

  expect(prepared).toMatchObject({ name: "receipt.webp", type: "image/webp" });
  expect(prepared.size).toBeLessThan(5 * 1024 * 1024);
  expect(canvas).toMatchObject({ width: 2560, height: 1920 });
  expect(drawImage).toHaveBeenCalledOnce();
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

it("rejects originals above the server cap before browser decoding", async () => {
  const source = new File(["photo"], "huge.jpg", { type: "image/jpeg" });
  Object.defineProperty(source, "size", { value: 18_000_001 });
  const decode = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);

  await expect(prepareMessageImage(source)).rejects.toThrow("smaller than 18 MB");
  expect(decode).not.toHaveBeenCalled();
});
