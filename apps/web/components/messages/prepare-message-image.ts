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

export async function prepareMessageImage(file: File): Promise<File> {
  const mime = imageMime(file);
  if (!accepted.has(mime) || file.size < 1)
    throw new Error("Choose a JPEG, PNG, WebP or HEIC photo");
  if (file.size > orderMessageImageMaxInputBytes)
    throw new Error("Choose a photo smaller than 18 MB");
  const source = mime === file.type ? file : new File([file], file.name, { type: mime });
  if (source.size <= orderMessageImageMaxStoredBytes) return source;

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(source);
      try {
        if (bitmap.width < 1 || bitmap.height < 1) throw new Error("Invalid image dimensions");
        const canvas = document.createElement("canvas");
        for (const [edge, quality] of [
          [2560, 0.82],
          [2048, 0.72],
          [1600, 0.64],
        ]) {
          const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
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
      // HEIC and exceptionally large photos may be undecodable in a browser.
    }
  }
  return source;
}
