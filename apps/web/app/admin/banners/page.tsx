"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, RotateCw, X } from "lucide-react";
import type { StorefrontBanner } from "@freshmarkets/contracts";
import { storefrontBannerSchema, storefrontBannerListSchema } from "@freshmarkets/validation";
import { useAdminContext } from "../admin-context-provider";
import { PageHeader } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BannerMediaEditor } from "@/components/admin/banner-media-editor";
import { catalogResultSchema, useCatalogCommand } from "@/components/admin/catalog-command-state";
import { AdminMasterDetailWorkspace } from "@/components/admin/admin-master-detail-workspace";
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
    [panelOpen, setPanelOpen] = useState(false),
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
    setPanelOpen(true);
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
  function closePanel() {
    setPanelOpen(false);
  }

  const master = (
    <section className="flex min-w-0 flex-col p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader
        title="Banners"
        description="Manage the images displayed on your storefront."
        action={
          manage ? (
            <Button
              onClick={() => (panelOpen ? closePanel() : create())}
              disabled={command.pending || command.uncertain}
              aria-expanded={panelOpen}
              aria-controls="banner-detail-panel"
              className="fm-admin-reference-primary"
            >
              <Plus aria-hidden="true" />
              Add banner
            </Button>
          ) : null
        }
      />
      <div className="mt-6 flex items-center justify-between gap-3 border-b border-[var(--fm-border)] pb-3">
        <p className="text-sm text-[var(--fm-text-muted)]">
          {loading ? "Loading banners…" : `${items.length} banner${items.length === 1 ? "" : "s"}`}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RotateCw aria-hidden="true" />
          Refresh gallery
        </Button>
      </div>
      {message && (
        <p className="mt-4" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p className="mt-6" role="status">
          Loading banners…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-6">No banners yet. Add a banner to get started.</p>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((banner) => (
            <button
              key={banner.bannerId}
              type="button"
              aria-expanded={panelOpen && selected?.bannerId === banner.bannerId}
              aria-controls="banner-detail-panel"
              disabled={command.pending || command.uncertain}
              onClick={() => {
                setSelected(banner);
                setPanelOpen(true);
                setMessage("");
              }}
              className="overflow-hidden rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] text-left transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-[var(--fm-admin-accent)] hover:shadow-[var(--fm-shadow-card)] active:translate-y-0 motion-reduce:transform-none"
            >
              {banner.image ? (
                <img
                  src={banner.image.src}
                  alt={banner.image.alt}
                  className="aspect-[20/9] w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex aspect-[20/9] items-center justify-center bg-[var(--fm-admin-surface-muted)] text-[var(--fm-text-muted)]">
                  No image
                </div>
              )}
              <div className="space-y-1 p-4">
                <h2 className="font-semibold">{banner.name || "Untitled banner"}</h2>
                <p className="text-sm text-[var(--fm-text-muted)]">
                  {banner.status} · Priority {banner.priority}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  const detail = selected ? (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div>
          <h2 id="banner-panel-title" className="text-xl font-bold tracking-[-0.03em]">
            {selected.version ? "Edit banner" : "New banner"}
          </h2>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            Configure its storefront image, destination, and schedule.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={closePanel}
          disabled={command.pending || command.uncertain}
          aria-label="Close banner workspace"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <form id="banner-details-form" onSubmit={save} className="space-y-5">
          <fieldset
            disabled={!manage || archived || command.pending || command.uncertain}
            className="grid gap-4"
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
                onChange={(e) => setSelected({ ...selected, href: e.currentTarget.value || null })}
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
        </form>
        {selected.version > 0 && (
          <BannerMediaEditor
            key={selected.bannerId}
            bannerId={selected.bannerId}
            archived={archived}
            onChange={() => void load()}
          />
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-5 py-4">
        <Button
          type="button"
          variant="outline"
          disabled={command.pending || command.uncertain}
          onClick={closePanel}
        >
          Close
        </Button>
        {manage ? (
          <Button type="submit" form="banner-details-form" disabled={archived || command.pending}>
            {command.pending
              ? "Saving…"
              : command.uncertain
                ? "Retry save"
                : selected.version
                  ? "Save banner"
                  : "Create draft"}
          </Button>
        ) : null}
      </div>
    </>
  ) : null;

  return (
    <AdminMasterDetailWorkspace
      open={panelOpen && selected !== null}
      master={master}
      detail={detail}
      panelId="banner-detail-panel"
      labelledBy="banner-panel-title"
      resizeLabel="Resize banner workspace"
    />
  );
}
