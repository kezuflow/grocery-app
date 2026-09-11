"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BannerMediaView } from "@freshmarkets/contracts";
import { bannerMediaMaxBytes } from "@freshmarkets/contracts";
import { bannerMediaViewSchema } from "@freshmarkets/validation";
import { catalogResultSchema } from "./catalog-command-state";
import { useAdminContext } from "@/app/admin/admin-context-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BannerMediaEditor({
  bannerId,
  archived,
  onChange,
}: {
  bannerId: string;
  archived: boolean;
  onChange?: () => void;
}) {
  const { state } = useAdminContext();
  const canManage =
    !archived &&
    state.phase === "ready" &&
    state.context.capabilities.includes("promotions.manage") &&
    state.context.scopes.some((scope) => scope.kind === "global");
  const [media, setMedia] = useState<BannerMediaView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const intent = useRef<{ key: string; method: string; body: FormData | string } | null>(null);
  const active = useRef(false);
  const url = `/api/admin/banners/${encodeURIComponent(bannerId)}/media`;
  const load = useCallback(async () => {
    try {
      const response = await fetch(url);
      const result = catalogResultSchema(bannerMediaViewSchema.nullable()).parse(
        await response.json(),
      );
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setMedia(result.value);
      setAltText(result.value?.altText ?? "");
      setLoaded(true);
    } catch {
      setMessage("The banner image could not be loaded. Try again.");
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const source = URL.createObjectURL(file);
    setPreview(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);
  async function save(removing = false) {
    if (active.current || !canManage) return;
    if (!intent.current) {
      if (removing && media)
        intent.current = {
          key: crypto.randomUUID(),
          method: "DELETE",
          body: JSON.stringify({ mediaId: media.mediaId, expectedVersion: media.version }),
        };
      else if (file) {
        if (file.size < 1 || file.size > bannerMediaMaxBytes) {
          setMessage("Choose a JPEG, PNG or WebP image up to 5 MiB.");
          return;
        }
        const body = new FormData();
        body.set("file", file);
        body.set("altText", altText);
        body.set(
          "expectedMedia",
          JSON.stringify(media ? { mediaId: media.mediaId, version: media.version } : null),
        );
        intent.current = { key: crypto.randomUUID(), method: "POST", body };
      } else if (media)
        intent.current = {
          key: crypto.randomUUID(),
          method: "PATCH",
          body: JSON.stringify({ mediaId: media.mediaId, expectedVersion: media.version, altText }),
        };
      else {
        setMessage("Choose a banner image.");
        return;
      }
    }
    const saved = intent.current;
    active.current = true;
    setPending(true);
    setMessage("Saving image…");
    try {
      async function send() {
        const response = await fetch(url, {
          method: saved.method,
          headers: {
            "idempotency-key": saved.key,
            ...(typeof saved.body === "string" ? { "content-type": "application/json" } : {}),
          },
          body: saved.body,
        });
        // Framework/proxy rejections may be plain text and mean no upload was accepted.
        if (response.status === 413) {
          return {
            ok: false as const,
            error: {
              code: "VALIDATION_FAILED" as const,
              message:
                "The server rejected the image size. Choose an image up to 5 MiB and try again.",
            },
          };
        }
        return catalogResultSchema(bannerMediaViewSchema).parse(await response.json());
      }
      const result = await send().catch(() => send());
      if (result.ok) {
        intent.current = null;
        setFile(null);
        setMedia(result.value.status === "active" ? result.value : null);
        setAltText(result.value.status === "active" ? result.value.altText : "");
        setMessage(
          result.value.status === "active" ? "Banner image saved." : "Banner image removed.",
        );
        onChange?.();
      } else {
        setMessage(result.error.message);
        if (result.error.code !== "CONFLICT") {
          intent.current = null;
          await load();
        }
      }
    } catch {
      setMessage("The image change could not be confirmed. Save again to retry.");
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-label="Banner image" className="space-y-4 rounded-lg border border-border p-4">
      <h2 className="text-lg font-semibold">Banner image</h2>
      <p className="text-sm text-muted-foreground">
        One JPEG, PNG or WebP image up to 5 MiB. Active banners appear on the storefront during
        their dates.
      </p>
      {!loaded ? (
        <Button variant="outline" onClick={() => void load()}>
          Load banner image
        </Button>
      ) : (
        <>
          {preview || media ? (
            <img
              src={
                preview ?? `${url}/${encodeURIComponent(media?.mediaId ?? "")}?v=${media?.version}`
              }
              alt={preview ? "Selected banner preview" : media?.altText}
              className="max-h-56 w-full rounded object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No banner image.</p>
          )}
          {canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
              className="space-y-3"
            >
              <fieldset
                disabled={pending}
                className="grid gap-3 sm:grid-cols-2"
                onChange={() => {
                  intent.current = null;
                }}
              >
                <label className="grid gap-1 text-sm font-medium">
                  Banner image file
                  <Input
                    key={media?.mediaId ?? "empty"}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Banner image description
                  <Input
                    required
                    maxLength={300}
                    value={altText}
                    onChange={(event) => setAltText(event.target.value)}
                  />
                </label>
              </fieldset>
              <div className="flex gap-2">
                <Button disabled={pending} type="submit">
                  {pending ? "Saving…" : "Save image"}
                </Button>
                {media ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => void save(true)}
                  >
                    Remove image
                  </Button>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Banner images are read-only.</p>
          )}
        </>
      )}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
