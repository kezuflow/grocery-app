"use client";
import { useCallback, useEffect, useState } from "react";
import type { StorefrontBanner } from "@freshmarkets/contracts";
import { storefrontBannerSchema, storefrontBannerListSchema } from "@freshmarkets/validation";
import { useAdminContext } from "../admin-context-provider";
import { PageHeader } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BannerMediaEditor } from "@/components/admin/banner-media-editor";
import { catalogResultSchema, useCatalogCommand } from "@/components/admin/catalog-command-state";
const localDate = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? ""
    : new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export default function BannersPage() {
  const { state } = useAdminContext();
  const manage =
    state.phase === "ready" &&
    state.context.capabilities.includes("promotions.manage") &&
    state.context.scopes.some((scope) => scope.kind === "global");
  const [items, setItems] = useState<StorefrontBanner[]>([]),
    [selected, setSelected] = useState<StorefrontBanner | null>(null),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true);
  const command = useCatalogCommand(storefrontBannerSchema);
  const archived = items.some(
    (item) => item.bannerId === selected?.bannerId && item.status === "ARCHIVED",
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/banners", { cache: "no-store" });
      const data = catalogResultSchema(storefrontBannerListSchema).parse(await r.json());
      if (!data.ok) throw new Error(data.error.message);
      setItems(data.value.items);
    } catch {
      setMessage("Banners couldn’t be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  function create() {
    setMessage("");
    setSelected({
      bannerId: crypto.randomUUID(),
      name: "",
      href: null,
      status: "DRAFT",
      priority: 0,
      startsAt: Date.now(),
      endsAt: null,
      version: 0,
    });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setMessage("");
    try {
      const r = await command.submit("/api/admin/banners", {
        bannerId: selected.bannerId,
        expectedVersion: selected.version,
        name: selected.name,
        href: selected.href,
        status: selected.status,
        priority: selected.priority,
        startsAt: selected.startsAt,
        endsAt: selected.endsAt,
      });
      if (!r) return;
      if (!r.ok) {
        setMessage(r.error.message);
        return;
      }
      setSelected(r.value);
      setMessage("Banner saved.");
      await load();
    } catch {
      setMessage("Save couldn’t be confirmed. Retry the same save.");
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader title="Banners" description="Manage the images displayed on your storefront." />
      <div className="flex gap-3">
        {manage && (
          <Button onClick={create} disabled={command.pending || command.uncertain}>
            Add banner
          </Button>
        )}
        <Button variant="outline" onClick={() => void load()}>
          Refresh gallery
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      {selected && (
        <section className="rounded-lg border border-border p-5 space-y-5">
          <h2 className="text-lg font-semibold">
            {selected.version ? "Edit banner" : "New banner"}
          </h2>
          <form onSubmit={save} className="space-y-4">
            <fieldset
              disabled={!manage || archived || command.pending || command.uncertain}
              className="grid gap-4 sm:grid-cols-2"
            >
              <label className="grid gap-2">
                Title
                <Input
                  required
                  maxLength={150}
                  value={selected.name}
                  onChange={(e) => setSelected({ ...selected, name: e.currentTarget.value })}
                />
              </label>
              <label className="grid gap-2">
                Link (optional)
                <Input
                  placeholder="/#catalog"
                  value={selected.href ?? ""}
                  onChange={(e) =>
                    setSelected({ ...selected, href: e.currentTarget.value || null })
                  }
                />
              </label>
              <label className="grid gap-2">
                Status
                <select
                  className="min-h-10 rounded border border-border bg-background px-3"
                  value={selected.status}
                  onChange={(e) => {
                    const status = storefrontBannerSchema.shape.status.parse(e.currentTarget.value);
                    setSelected({ ...selected, status });
                  }}
                >
                  <option>DRAFT</option>
                  {selected.version > 0 && (
                    <>
                      <option>ACTIVE</option>
                      <option>INACTIVE</option>
                      <option>ARCHIVED</option>
                    </>
                  )}
                </select>
              </label>
              <label className="grid gap-2">
                Display priority
                <Input
                  type="number"
                  min={-10000}
                  max={10000}
                  value={selected.priority}
                  onChange={(e) =>
                    setSelected({ ...selected, priority: Number(e.currentTarget.value) })
                  }
                />
              </label>
              <label className="grid gap-2">
                Starts
                <Input
                  type="datetime-local"
                  required
                  value={localDate(selected.startsAt)}
                  onChange={(e) =>
                    setSelected({
                      ...selected,
                      startsAt: new Date(e.currentTarget.value).getTime(),
                    })
                  }
                />
              </label>
              <label className="grid gap-2">
                Ends (optional)
                <Input
                  type="datetime-local"
                  value={localDate(selected.endsAt)}
                  onChange={(e) =>
                    setSelected({
                      ...selected,
                      endsAt: e.currentTarget.value
                        ? new Date(e.currentTarget.value).getTime()
                        : null,
                    })
                  }
                />
              </label>
            </fieldset>
            <p className="text-sm text-muted-foreground">
              Higher priority appears first. Active banners need an image and appear during their
              scheduled dates.
            </p>
            <div className="flex gap-3">
              {manage && (
                <Button type="submit" disabled={archived || command.pending}>
                  {command.pending
                    ? "Saving…"
                    : command.uncertain
                      ? "Retry save"
                      : selected.version
                        ? "Save banner"
                        : "Create draft"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={command.pending || command.uncertain}
                onClick={() => setSelected(null)}
              >
                Close editor
              </Button>
            </div>
          </form>
          {selected.version > 0 && (
            <BannerMediaEditor
              key={selected.bannerId}
              bannerId={selected.bannerId}
              archived={archived}
              onChange={() => void load()}
            />
          )}
        </section>
      )}
      {loading ? (
        <p role="status">Loading banners…</p>
      ) : items.length === 0 ? (
        <p>No banners yet. Add a banner to get started.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((banner) => (
            <button
              key={banner.bannerId}
              disabled={command.pending || command.uncertain}
              onClick={() => {
                setSelected(banner);
                setMessage("");
              }}
              className="overflow-hidden rounded-lg border border-border text-left hover:shadow-md"
            >
              {banner.image ? (
                <img
                  src={banner.image.src}
                  alt={banner.image.alt}
                  className="aspect-[20/9] w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="aspect-[20/9] bg-muted flex items-center justify-center text-muted-foreground">
                  No image
                </div>
              )}
              <div className="p-4 space-y-1">
                <h2 className="font-semibold">{banner.name}</h2>
                <p className="text-sm">
                  {banner.status} · Priority {banner.priority}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
