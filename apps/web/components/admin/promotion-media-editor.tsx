"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PromotionMediaView } from "@freshmarkets/contracts";
import { promotionMediaMaxBytes } from "@freshmarkets/contracts";
import { promotionMediaViewSchema } from "@freshmarkets/validation";
import { catalogResultSchema } from "./catalog-command-state";
import { useAdminContext } from "@/app/admin/admin-context-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PromotionMediaEditor({
  promotionId,
  archived,
}: {
  promotionId: string;
  archived: boolean;
}) {
  const { state } = useAdminContext();
  const canManage =
    !archived &&
    state.phase === "ready" &&
    state.context.capabilities.includes("promotions.manage") &&
    state.context.scopes.some((scope) => scope.kind === "global");
  const [media, setMedia] = useState<PromotionMediaView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const intent = useRef<{ key: string; method: string; body: FormData | string } | null>(null);
  const active = useRef(false);
  const url = `/api/admin/promotions/${encodeURIComponent(promotionId)}/media`;
  const load = useCallback(async () => {
    try {
      const response = await fetch(url);
      const result = catalogResultSchema(promotionMediaViewSchema.nullable()).parse(
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
      setMessage("The campaign image could not be loaded. Try again.");
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
        if (file.size < 1 || file.size > promotionMediaMaxBytes) {
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
        setMessage("Choose a campaign image.");
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
        return catalogResultSchema(promotionMediaViewSchema).parse(await response.json());
      }
      const result = await send().catch(() => send());
      if (result.ok) {
        intent.current = null;
        setFile(null);
        setMedia(result.value.status === "active" ? result.value : null);
        setAltText(result.value.status === "active" ? result.value.altText : "");
        setMessage(
          result.value.status === "active" ? "Campaign image saved." : "Campaign image removed.",
        );
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
    <section aria-label="Campaign image" className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Campaign image</h2>
      <p className="text-sm text-muted-foreground">
        One JPEG, PNG or WebP image up to 5 MiB. Active campaigns appear on the storefront during
        their dates. Checkout checks each customer's eligibility.
      </p>
      {!loaded ? (
        <Button variant="outline" onClick={() => void load()}>
          Load campaign image
        </Button>
      ) : (
        <>
          {preview || media ? (
            <img
              src={
                preview ?? `${url}/${encodeURIComponent(media?.mediaId ?? "")}?v=${media?.version}`
              }
              alt={preview ? "Selected campaign preview" : media?.altText}
              className="max-h-56 w-full rounded object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No campaign image.</p>
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
                  Campaign image file
                  <Input
                    key={media?.mediaId ?? "empty"}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Campaign image description
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
            <p className="text-sm text-muted-foreground">Campaign images are read-only.</p>
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
