"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import type { BannerMediaView } from "@freshmarkets/contracts";
import { bannerMediaMaxBytes } from "@freshmarkets/contracts";
import { bannerMediaViewSchema, storefrontBannerListSchema } from "@freshmarkets/validation";
import { useAdminContext } from "@/app/admin/admin-context-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notifyCommandSuccess } from "./admin-feedback";
import { catalogResultSchema } from "./catalog-command-state";

type EditorState = { dirty: boolean; locked: boolean };
type MediaSelection = { mediaId: string; version: number } | null;
type MediaIntent = {
  key: string;
  method: string;
  body: FormData | string;
  expectedMedia: MediaSelection;
};

function sameMediaSelection(current: BannerMediaView | null, expected: MediaSelection): boolean {
  return current?.mediaId === expected?.mediaId && current?.version === expected?.version;
}

export function BannerMediaEditor({
  bannerId,
  archived,
  onChange,
  onStateChange,
}: {
  bannerId: string;
  archived: boolean;
  onChange?: () => void;
  onStateChange?: (state: EditorState) => void;
}) {
  const { state } = useAdminContext();
  const canRead =
    state.phase === "ready" &&
    state.selectedScope?.kind === "GLOBAL" &&
    state.context.capabilities.includes("promotions.read");
  const canManage =
    !archived &&
    state.phase === "ready" &&
    state.selectedScope?.kind === "GLOBAL" &&
    state.context.capabilities.includes("promotions.read") &&
    state.context.capabilities.includes("promotions.manage");
  const [media, setMedia] = useState<BannerMediaView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileRevision, setFileRevision] = useState(0);
  const [altText, setAltText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const intent = useRef<MediaIntent | null>(null);
  const active = useRef(false);
  const url = `/api/admin/banners/${encodeURIComponent(bannerId)}/media`;
  const dirty = canManage && (file !== null || altText !== (media?.altText ?? ""));
  const locked = pending || uncertain;

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoadError(null);
    try {
      const response = await fetch(url, { cache: "no-store" });
      const result = catalogResultSchema(bannerMediaViewSchema.nullable()).parse(
        await response.json(),
      );
      if (!result.ok) {
        setLoaded(false);
        setLoadError(result.error.message);
        return;
      }
      setMedia(result.value);
      setAltText(result.value?.altText ?? "");
      setLoaded(true);
    } catch {
      setLoaded(false);
      setLoadError("The banner image could not be loaded. Try again.");
    }
  }, [canRead, url]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onStateChange?.({ dirty, locked });
  }, [dirty, locked, onStateChange]);

  useEffect(
    () => () => {
      onStateChange?.({ dirty: false, locked: false });
    },
    [onStateChange],
  );

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const source = URL.createObjectURL(file);
    setPreview(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);

  function resetIntent(): void {
    intent.current = null;
    setUncertain(false);
  }

  function discardChanges(): void {
    resetIntent();
    setFile(null);
    setFileRevision((value) => value + 1);
    setAltText(media?.altText ?? "");
    setMessage(null);
  }

  async function save(removing = false) {
    if (active.current || !canManage) return;
    if (!intent.current) {
      if (removing && media) {
        intent.current = {
          key: crypto.randomUUID(),
          method: "DELETE",
          body: JSON.stringify({ mediaId: media.mediaId, expectedVersion: media.version }),
          expectedMedia: { mediaId: media.mediaId, version: media.version },
        };
      } else if (file) {
        if (file.size < 1 || file.size > bannerMediaMaxBytes) {
          setMessage("Choose a JPEG, PNG or WebP image up to 5 MiB.");
          return;
        }
        if (!altText.trim()) {
          setMessage("Describe the banner image before saving it.");
          return;
        }
        const body = new FormData();
        body.set("file", file);
        body.set("altText", altText);
        body.set(
          "expectedMedia",
          JSON.stringify(media ? { mediaId: media.mediaId, version: media.version } : null),
        );
        intent.current = {
          key: crypto.randomUUID(),
          method: "POST",
          body,
          expectedMedia: media ? { mediaId: media.mediaId, version: media.version } : null,
        };
      } else if (media) {
        if (!altText.trim()) {
          setMessage("Describe the banner image before saving it.");
          return;
        }
        intent.current = {
          key: crypto.randomUUID(),
          method: "PATCH",
          body: JSON.stringify({ mediaId: media.mediaId, expectedVersion: media.version, altText }),
          expectedMedia: { mediaId: media.mediaId, version: media.version },
        };
      } else {
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
      setUncertain(false);
      if (result.ok) {
        const activeMedia = result.value.status === "active" ? result.value : null;
        const successTitle = activeMedia ? "Banner image saved" : "Banner image removed";
        intent.current = null;
        setFile(null);
        setFileRevision((value) => value + 1);
        setMedia(activeMedia);
        setAltText(activeMedia?.altText ?? "");
        setMessage(activeMedia ? "Banner image saved." : "Banner image removed.");
        notifyCommandSuccess(successTitle, undefined, `banner-media:${saved.key}`);
        onChange?.();
      } else {
        if (result.error.code === "CONFLICT") {
          try {
            const response = await fetch(url, { cache: "no-store" });
            const current = catalogResultSchema(bannerMediaViewSchema.nullable()).parse(
              await response.json(),
            );
            if (!current.ok) throw new Error(current.error.message);
            if (sameMediaSelection(current.value, saved.expectedMedia)) {
              const ownerResponse = await fetch("/api/admin/banners", { cache: "no-store" });
              const ownerList = catalogResultSchema(storefrontBannerListSchema).parse(
                await ownerResponse.json(),
              );
              if (!ownerList.ok) throw new Error(ownerList.error.message);
              const owner = ownerList.value.items.find((item) => item.bannerId === bannerId);
              if (owner?.status === "ARCHIVED") {
                intent.current = null;
                setFile(null);
                setFileRevision((value) => value + 1);
                setAltText(current.value?.altText ?? "");
                setMessage("This banner was archived. Image changes are no longer available.");
                onChange?.();
              } else {
                setUncertain(true);
                setMessage("Image outcome remains unconfirmed. Check the same image change again.");
              }
            } else {
              intent.current = null;
              setMedia(current.value);
              setFile(null);
              setFileRevision((value) => value + 1);
              setAltText(current.value?.altText ?? "");
              setLoaded(true);
              setMessage("The banner image changed. Review its latest state before saving.");
              onChange?.();
            }
          } catch {
            setUncertain(true);
            setMessage("Image outcome remains unconfirmed. Check the same image change again.");
          }
        } else {
          setMessage(result.error.message);
          intent.current = null;
          await load();
        }
      }
    } catch {
      setUncertain(true);
      setMessage("Image outcome unknown. Check the same image change before leaving this editor.");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="banner-image-heading"
      className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
    >
      <h3 id="banner-image-heading" className="text-base font-semibold">
        Banner image
      </h3>
      <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
        Choose one JPEG, PNG or WebP image up to 5 MiB and provide an accessible description.
      </p>

      {!canRead ? (
        <p className="mt-4 text-sm text-[var(--fm-text-muted)]">
          Banner image access requires a Global scope.
        </p>
      ) : !loaded ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--fm-border)] p-4">
          <p className="text-sm text-[var(--fm-text-muted)]">
            {loadError ?? "Loading banner image…"}
          </p>
          {loadError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="mt-3"
            >
              Retry image
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)]">
            {preview || media ? (
              <img
                src={
                  preview ??
                  `${url}/${encodeURIComponent(media?.mediaId ?? "")}?v=${media?.version}`
                }
                alt={preview ? "Selected banner preview" : media?.altText}
                className="aspect-[20/9] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[20/9] flex-col items-center justify-center gap-2 text-[var(--fm-text-muted)]">
                <ImageIcon className="size-7" aria-hidden="true" />
                <span className="text-sm font-medium">No image attached</span>
              </div>
            )}
          </div>

          {canManage ? (
            <div className="mt-4 space-y-4">
              <fieldset disabled={pending || uncertain} className="grid gap-4">
                <label className="block text-sm font-semibold">
                  Image file
                  <Input
                    key={`${media?.mediaId ?? "empty"}:${fileRevision}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      resetIntent();
                      setFile(event.target.files?.[0] ?? null);
                    }}
                    className="mt-1.5"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Image description<span className="text-red-600"> *</span>
                  <Input
                    maxLength={300}
                    value={altText}
                    onChange={(event) => {
                      resetIntent();
                      setAltText(event.target.value);
                    }}
                    placeholder="Describe what appears in the banner"
                    className="mt-1.5 h-10"
                  />
                </label>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={() => void save()}>
                  <Upload aria-hidden="true" />
                  {pending ? "Saving…" : uncertain ? "Check image status" : "Save image"}
                </Button>
                {media ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || uncertain}
                    onClick={() => void save(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove image
                  </Button>
                ) : null}
                {dirty ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || uncertain}
                    onClick={discardChanges}
                  >
                    Discard image changes
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--fm-text-muted)]">
              {archived ? "Archived banner images are read-only." : "Banner images are read-only."}
            </p>
          )}
        </>
      )}

      {message ? (
        <p role={uncertain ? "alert" : "status"} className="mt-4 text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
