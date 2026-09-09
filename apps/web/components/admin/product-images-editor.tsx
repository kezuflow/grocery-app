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
    <section aria-label="Product images" className="space-y-4 rounded border p-4">
      <h2 className="text-lg font-semibold">Product images</h2>
      <p className="text-sm">Up to five photos. Choose a main photo and set their display order.</p>
      {replacement || images.length < adminProductMediaMaxCount ? (
        <fieldset disabled={command.pending || command.uncertain}>
          {replacement ? <p>Replacing {replacement.altText}</p> : null}
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
        <p>All five photo spaces are used. Replace or remove a photo to change them.</p>
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
      <fieldset disabled={busy} className="space-y-4">
        {images.map((image) => (
          <div key={`${image.mediaId}-${image.version}`} className="space-y-3 border-t pt-4">
            <img
              src={`/api/admin/catalog/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(image.mediaId)}/content?version=${image.version}`}
              alt={image.altText}
              className="size-28 rounded object-contain"
            />
            <form
              className="grid gap-3 sm:grid-cols-2"
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
          </div>
        ))}
      </fieldset>
      {message ? <p role="status">{message}</p> : null}
      {command.uncertain ? (
        <Button disabled={command.pending} onClick={() => void mutate("", {}, false, true)}>
          Retry saved image change
        </Button>
      ) : null}
    </section>
  );
}
