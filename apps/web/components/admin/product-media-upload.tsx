"use client";
import { useEffect, useRef, useState } from "react";
import { adminProductMediaMaxBytes, type AdminProductMediaView } from "@freshmarkets/contracts";
import { adminProductMediaViewSchema, z } from "@freshmarkets/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: adminProductMediaViewSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

/** Keep bytes, metadata, expected version and key together until the upload is resolved. */
export function ProductMediaUpload({
  productId,
  productVersion,
  onComplete,
  replacement,
  onBusyChange,
}: {
  productId: string;
  productVersion: number;
  onComplete(): void;
  replacement?: AdminProductMediaView;
  onBusyChange?(busy: boolean): void;
}) {
  const intent = useRef<{ key: string; body: FormData } | null>(null);
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [primary, setPrimary] = useState(replacement?.isPrimary ?? false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    if (!intent.current) {
      const fields = new FormData(form);
      if (!file || file.size === 0 || file.size > adminProductMediaMaxBytes) {
        setMessage("Choose a JPEG, PNG or WebP image up to 5 MiB.");
        return;
      }
      fields.set("file", file);
      fields.set("isPrimary", String(primary));
      fields.set("expectedProductVersion", String(productVersion));
      if (replacement) fields.set("replaceMediaId", replacement.mediaId);
      intent.current = { key: crypto.randomUUID(), body: fields };
    }
    active.current = true;
    setPending(true);
    onBusyChange?.(true);
    setMessage("Uploading image…");
    try {
      const saved = intent.current;
      async function upload() {
        const response = await fetch(
          `/api/admin/catalog/products/${encodeURIComponent(productId)}/media`,
          {
            method: "POST",
            headers: { "idempotency-key": saved.key },
            body: saved.body,
          },
        );
        return responseSchema.parse(await response.json());
      }
      // One bounded transport retry uses the same bytes and identity; it is not
      // a second upload or an operator workflow.
      const result = await upload().catch(() => upload());
      if (result.ok) {
        intent.current = null;
        setFile(null);
        setPrimary(false);
        form.reset();
        setMessage("Image uploaded.");
        onBusyChange?.(false);
        onComplete();
      } else {
        setMessage(
          result.error.code === "CONFLICT"
            ? "Image could not be uploaded. Please try again."
            : result.error.message,
        );
        if (
          result.error.code === "VALIDATION_FAILED" ||
          result.error.code === "MEDIA_UPLOAD_ABANDONED"
        ) {
          intent.current = null;
          onBusyChange?.(false);
        }
      }
    } catch {
      setMessage("Image upload could not be confirmed. Please try again.");
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 p-4">
      <fieldset
        disabled={pending || intent.current !== null}
        onChange={() => {
          intent.current = null;
          setMessage(null);
        }}
        className="grid gap-3 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm font-medium">
          Product media image
          <Input
            name="file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Media alt text
          <Input name="altText" maxLength={300} defaultValue={replacement?.altText} required />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Media sort order
          <Input
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            defaultValue={replacement?.sortOrder ?? 0}
            required
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={primary} onCheckedChange={(checked) => setPrimary(checked === true)} />
          Primary image
        </label>
      </fieldset>
      {preview ? (
        <img
          src={preview}
          alt="Selected upload preview"
          className="h-28 w-28 rounded object-contain"
        />
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending
          ? "Uploading…"
          : intent.current
            ? "Retry image upload"
            : replacement
              ? "Replace image"
              : "Upload image"}
      </Button>
    </form>
  );
}
