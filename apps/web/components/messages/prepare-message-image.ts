import {
  orderMessageImageMaxInputBytes,
  orderMessageImageMaxStoredBytes,
} from "@freshmarkets/contracts";

const accepted = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function imageMime(file: File): string {
  if (file.type) return file.type.toLowerCase();
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  if (/\.heic$/i.test(file.name)) return "image/heic";
  if (/\.heif$/i.test(file.name)) return "image/heif";
  return "";
}

function imageBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

async function dimensions(
  file: File,
  mime: string,
): Promise<{ width: number; height: number } | null> {
  const bytes = new Uint8Array(await file.slice(0, 1_048_576).arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (mime === "image/png" && bytes.length >= 24)
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (mime === "image/webp" && bytes.length >= 30) {
    const fourcc = String.fromCharCode(...bytes.subarray(12, 16));
    if (fourcc === "VP8X")
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    if (fourcc === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (fourcc === "VP8L" && bytes[20] === 0x2f)
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
  }
  if (mime !== "image/jpeg" || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return null;
  let orientation = 1;
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1];
    while (marker === 0xff && ++offset + 1 < bytes.length) marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 4 > bytes.length) break;
    const length = view.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (
      marker === 0xe1 &&
      length >= 16 &&
      String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === "Exif"
    ) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const big = view.getUint16(tiff) === 0x4d4d;
      if ((little || big) && view.getUint16(tiff + 2, little) === 42) {
        const ifd = tiff + view.getUint32(tiff + 4, little);
        const end = Math.min(offset + 2 + length, bytes.length);
        if (ifd + 2 <= end) {
          const count = view.getUint16(ifd, little);
          for (let index = 0; index < count && ifd + 2 + (index + 1) * 12 <= end; index++) {
            const tag = ifd + 2 + index * 12;
            if (
              view.getUint16(tag, little) === 0x0112 &&
              view.getUint16(tag + 2, little) === 3 &&
              view.getUint32(tag + 4, little) === 1
            ) {
              orientation = view.getUint16(tag + 8, little);
              break;
            }
          }
        }
      }
    }
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    )
      return orientation >= 5 && orientation <= 8
        ? { width: view.getUint16(offset + 5), height: view.getUint16(offset + 7) }
        : { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

export async function prepareMessageImage(file: File): Promise<File> {
  const mime = imageMime(file);
  if (!accepted.has(mime) || file.size < 1)
    throw new Error("Choose a JPEG, PNG, WebP or HEIC photo");
  if (file.size > orderMessageImageMaxInputBytes)
    throw new Error("Choose a photo smaller than 18 MB");
  const source = mime === file.type ? file : new File([file], file.name, { type: mime });
  if (source.size <= orderMessageImageMaxStoredBytes) return source;

  // HEIC decoding is inconsistent across browsers. Core has a bounded Images
  // decoder for ordinary HEIC photos; never hold a full-size bitmap in JS.
  if (mime === "image/heic" || mime === "image/heif") return source;
  const size = await dimensions(source, mime);
  if (!size || size.width < 1 || size.height < 1)
    throw new Error("Could not read photo dimensions; choose another image");

  if (typeof createImageBitmap === "function") {
    try {
      const scale = Math.min(1, 2560 / Math.max(size.width, size.height));
      const bitmap = await createImageBitmap(source, {
        resizeWidth: Math.max(1, Math.round(size.width * scale)),
        resizeHeight: Math.max(1, Math.round(size.height * scale)),
        resizeQuality: "high",
      });
      try {
        if (bitmap.width < 1 || bitmap.height < 1) throw new Error("Invalid image dimensions");
        const canvas = document.createElement("canvas");
        for (const [edge, quality] of [
          [2560, 0.82],
          [2048, 0.72],
          [1600, 0.64],
        ]) {
          const outputScale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.max(1, Math.round(bitmap.width * outputScale));
          canvas.height = Math.max(1, Math.round(bitmap.height * outputScale));
          const context = canvas.getContext("2d");
          if (!context) break;
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await imageBlob(canvas, quality);
          if (
            blob?.type === "image/webp" &&
            blob.size > 0 &&
            blob.size <= orderMessageImageMaxStoredBytes
          )
            return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, {
              type: "image/webp",
            });
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // Core still has a bounded decoder for supported originals.
    }
  }
  return source;
}
