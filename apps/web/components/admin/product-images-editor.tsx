"use client";
import { useState } from "react";
import { adminProductMediaMaxCount, type AdminProductMediaView } from "@freshmarkets/contracts";
import { adminProductMediaViewSchema } from "@freshmarkets/validation";
import { useCatalogCommand } from "./catalog-command-state";
import { ProductMediaUpload } from "./product-media-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Ordinary image editing, shared by Product detail and Edit Product. */
export function ProductImagesEditor({
  productId,
  version,
  images,
  onComplete,
  onBusyChange,
}: {
  productId: string;
  version: number;
  images: ReadonlyArray<AdminProductMediaView>;
  onComplete(): void;
  onBusyChange?(busy: boolean): void;
}) {
  const command = useCatalogCommand(adminProductMediaViewSchema);
  const [replacement, setReplacement] = useState<AdminProductMediaView>();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = command.pending || command.uncertain || uploadBusy;
  async function mutate(mediaId: string, body: unknown, remove = false, retry = false) {
    setMessage(null);
    onBusyChange?.(true);
    try {
      const result = retry
        ? await command.retry()
        : await command.submit(
            `/api/admin/catalog/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}`,
            body,
            remove ? "DELETE" : "PATCH",
          );
      if (!result) return;
      onBusyChange?.(false);
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setMessage(remove ? "Image removed." : "Image saved.");
      setReplacement(undefined);
      onComplete();
    } catch {
      setMessage("The image change could not be confirmed. Retry the saved change.");
    }
  }
  return (
    <section
      aria-label="Product images"
      className="overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--fm-border)] px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-lg font-semibold">Images</h2>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            Add up to five photos. Choose a main image and control their display order.
          </p>
        </div>
        <span className="shrink-0 text-sm text-[var(--fm-text-muted)]">
          {images.length} of {adminProductMediaMaxCount}
        </span>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        {replacement || images.length < adminProductMediaMaxCount ? (
          <fieldset
            disabled={command.pending || command.uncertain}
            className="rounded-[var(--fm-radius-control)] border border-dashed border-[var(--fm-border)]"
          >
            {replacement ? (
              <p className="px-4 pt-4 text-sm font-medium">Replacing {replacement.altText}</p>
            ) : null}
            <ProductMediaUpload
              key={`${replacement?.mediaId ?? "add"}-${version}`}
              productId={productId}
              productVersion={version}
              replacement={replacement}
              onBusyChange={(value) => {
                setUploadBusy(value);
                onBusyChange?.(value);
              }}
              onComplete={() => {
                setReplacement(undefined);
                onComplete();
              }}
            />
          </fieldset>
        ) : (
          <p className="text-sm text-[var(--fm-text-muted)]">
            All five photo spaces are used. Replace or remove a photo to change them.
          </p>
        )}
        {replacement ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setReplacement(undefined)}
          >
            Cancel replacement
          </Button>
        ) : null}
        <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {images.map((image) => (
            <article
              key={`${image.mediaId}-${image.version}`}
              className="space-y-3 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] p-3"
            >
              <img
                src={`/api/admin/catalog/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(image.mediaId)}/content?version=${image.version}`}
                alt={image.altText}
                className="aspect-square w-full rounded-md bg-[var(--fm-admin-surface-muted)] object-cover"
              />
              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget);
                  void mutate(image.mediaId, {
                    altText: String(fields.get("altText")),
                    sortOrder: Number(fields.get("sortOrder")),
                    isPrimary: fields.get("isPrimary") === "true",
                    expectedProductVersion: version,
                  });
                }}
              >
                <label>
                  Alt text for {image.altText}
                  <Input name="altText" defaultValue={image.altText} maxLength={300} required />
                </label>
                <label>
                  Order for {image.altText}
                  <Input
                    name="sortOrder"
                    type="number"
                    min={0}
                    max={10000}
                    defaultValue={image.sortOrder}
                    required
                  />
                </label>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    name="isPrimary"
                    type="checkbox"
                    value="true"
                    defaultChecked={image.isPrimary}
                  />
                  Main photo
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="outline" aria-label={`Save ${image.altText}`}>
                    Save image
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReplacement(image)}
                    aria-label={`Replace ${image.altText}`}
                  >
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() =>
                      void mutate(image.mediaId, { expectedProductVersion: version }, true)
                    }
                    aria-label={`Remove ${image.altText}`}
                  >
                    Remove
                  </Button>
                </div>
              </form>
            </article>
          ))}
        </fieldset>
        {message ? <p role="status">{message}</p> : null}
        {command.uncertain ? (
          <Button disabled={command.pending} onClick={() => void mutate("", {}, false, true)}>
            Retry saved image change
          </Button>
        ) : null}
      </div>
    </section>
  );
}
