"use client";
import { useEffect, useRef, useState } from "react";
import { adminProductMediaMaxBytes } from "@freshmarkets/contracts";
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
}: {
  productId: string;
  productVersion: number;
  onComplete(): void;
}) {
  const intent = useRef<{ key: string; body: FormData } | null>(null);
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [primary, setPrimary] = useState(false);
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
      intent.current = { key: crypto.randomUUID(), body: fields };
    }
    active.current = true;
    setPending(true);
    setLocked(true);
    setMessage("Uploading image…");
    try {
      const response = await fetch(
        `/api/admin/catalog/products/${encodeURIComponent(productId)}/media`,
        {
          method: "POST",
          headers: { "idempotency-key": intent.current.key },
          body: intent.current.body,
        },
      );
      const result = responseSchema.parse(await response.json());
      if (result.ok) {
        intent.current = null;
        setLocked(false);
        setFile(null);
        setPrimary(false);
        form.reset();
        setMessage("Image uploaded.");
        onComplete();
      } else {
        setMessage(result.error.message);
        if (
          result.error.code === "VALIDATION_FAILED" ||
          result.error.code === "MEDIA_UPLOAD_ABANDONED"
        ) {
          intent.current = null;
          setLocked(false);
        }
      }
    } catch {
      setMessage(
        "The upload response was not confirmed. Retry the saved image to recover the same upload.",
      );
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 border-b p-4">
      <fieldset disabled={locked} className="grid gap-3 md:grid-cols-2">
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
          <Input name="altText" maxLength={300} required />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Media sort order
          <Input name="sortOrder" type="number" min={0} max={10000} defaultValue={0} required />
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
        {pending ? "Uploading…" : locked ? "Retry saved image" : "Upload media"}
      </Button>
    </form>
  );
}
