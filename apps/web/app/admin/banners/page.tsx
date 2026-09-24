"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ImageIcon, Plus, RotateCw, Search, X } from "lucide-react";
import type { StorefrontBanner } from "@freshmarkets/contracts";
import { storefrontBannerListSchema, storefrontBannerSchema } from "@freshmarkets/validation";
import { useAdminContext, useAdminScopeGuard } from "../admin-context-provider";
import { AdminIndexViews } from "@/components/admin/admin-controls";
import { AdminMasterDetailWorkspace } from "@/components/admin/admin-master-detail-workspace";
import { AdminPageState } from "@/components/admin/admin-page-state";
import { AdminStatusPill, type AdminStatusTone } from "@/components/admin/admin-status-pill";
import { BannerMediaEditor } from "@/components/admin/banner-media-editor";
import { catalogResultSchema, useCatalogCommand } from "@/components/admin/catalog-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { useAdminRouteGuard } from "@/components/admin/use-admin-route-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BannerView = "all" | "ACTIVE" | "DRAFT" | "INACTIVE" | "ARCHIVED";
type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string; requestId: string | null }
  | { phase: "ready" };

const bannerViews: ReadonlyArray<{ label: string; status: BannerView }> = [
  { label: "All", status: "all" },
  { label: "Active", status: "ACTIVE" },
  { label: "Draft", status: "DRAFT" },
  { label: "Inactive", status: "INACTIVE" },
  { label: "Archived", status: "ARCHIVED" },
];

const localDate = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? ""
    : new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function statusTone(status: StorefrontBanner["status"]): AdminStatusTone {
  if (status === "ACTIVE") return "success";
  if (status === "INACTIVE") return "warning";
  return "neutral";
}

function scheduleLabel(banner: StorefrontBanner): string {
  const start = new Date(banner.startsAt).toLocaleDateString();
  const end = banner.endsAt === null ? "No end date" : new Date(banner.endsAt).toLocaleDateString();
  return `${start} – ${end}`;
}

function sameDraft(left: StorefrontBanner | null, right: StorefrontBanner | null): boolean {
  return (
    left?.bannerId === right?.bannerId &&
    left?.name === right?.name &&
    left?.href === right?.href &&
    left?.status === right?.status &&
    left?.priority === right?.priority &&
    left?.startsAt === right?.startsAt &&
    left?.endsAt === right?.endsAt &&
    left?.version === right?.version
  );
}

export default function BannersPage() {
  const admin = useAdminContext();
  if (admin.state.phase !== "ready") {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Banners" />
        <AdminPageState state="loading" title="Loading banner access" />
      </section>
    );
  }

  const canRead =
    admin.state.selectedScope?.kind === "GLOBAL" &&
    admin.state.context.capabilities.includes("promotions.read");
  if (!canRead) {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Banners" />
        <AdminPageState
          state="error"
          title="Banners are unavailable"
          message="Banner administration requires the promotions.read capability with a Global scope."
        />
      </section>
    );
  }

  const scopeKey = JSON.stringify(admin.state.selectedScope);
  return (
    <BannersWorkspace
      key={scopeKey}
      canManage={admin.state.context.capabilities.includes("promotions.manage")}
    />
  );
}

function BannersWorkspace({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<StorefrontBanner[]>([]);
  const [selected, setSelected] = useState<StorefrontBanner | null>(null);
  const [baseline, setBaseline] = useState<StorefrontBanner | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<BannerView>("all");
  const [query, setQuery] = useState("");
  const [mediaState, setMediaState] = useState({ dirty: false, locked: false });
  const [editorRevision, setEditorRevision] = useState(0);
  const loadGeneration = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const command = useCatalogCommand(storefrontBannerSchema, { retainConflict: true });
  const detailsDirty = canManage && !sameDraft(selected, baseline);
  const dirty = detailsDirty || mediaState.dirty;
  const locked = command.pending || command.uncertain || mediaState.locked;
  const archived = baseline?.status === "ARCHIVED";

  const discardEditor = useCallback(() => {
    setSelected(baseline);
    setMediaState({ dirty: false, locked: false });
    setPanelOpen(false);
    setEditorRevision((value) => value + 1);
  }, [baseline]);

  useAdminScopeGuard(canManage && dirty, locked, discardEditor);
  useAdminRouteGuard(canManage && dirty, locked);

  const load = useCallback(async (preserveCurrent = false) => {
    const generation = ++loadGeneration.current;
    if (preserveCurrent) setRefreshing(true);
    else setLoadState({ phase: "loading" });
    try {
      const response = await fetch("/api/admin/banners", { cache: "no-store" });
      const result = catalogResultSchema(storefrontBannerListSchema).parse(await response.json());
      if (generation !== loadGeneration.current) return;
      if (!result.ok) {
        if (preserveCurrent) {
          setMessage(result.error.message);
          return;
        }
        setLoadState({
          phase: "error",
          message: result.error.message,
          requestId: result.error.requestId,
        });
        return;
      }
      setItems(result.value.items);
      const archivedSelection = result.value.items.find(
        (item) => item.bannerId === selectedRef.current?.bannerId && item.status === "ARCHIVED",
      );
      if (
        archivedSelection &&
        (baselineRef.current?.status !== "ARCHIVED" ||
          baselineRef.current?.version !== archivedSelection.version)
      ) {
        setSelected(archivedSelection);
        setBaseline(archivedSelection);
        setMediaState({ dirty: false, locked: false });
        setEditorRevision((value) => value + 1);
        setMessage("This banner was archived. Its details and image are now read-only.");
      }
      setLoadState({ phase: "ready" });
    } catch {
      if (generation !== loadGeneration.current) return;
      if (preserveCurrent) {
        setMessage("Banners couldn’t be refreshed. The displayed banners may be out of date.");
      } else {
        setLoadState({
          phase: "error",
          message: "Network error loading banners.",
          requestId: null,
        });
      }
    } finally {
      if (generation === loadGeneration.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  function confirmEditorChange(prompt: string): boolean {
    if (locked) return false;
    return !dirty || window.confirm(prompt);
  }

  function openBanner(banner: StorefrontBanner): void {
    if (!confirmEditorChange("Discard unsaved banner changes and open another banner?")) return;
    setSelected(banner);
    setBaseline(banner);
    setMediaState({ dirty: false, locked: false });
    setEditorRevision((value) => value + 1);
    setPanelOpen(true);
    setMessage(null);
  }

  function create(): void {
    if (!confirmEditorChange("Discard unsaved banner changes and create a new banner?")) return;
    const draft: StorefrontBanner = {
      bannerId: crypto.randomUUID(),
      name: "",
      href: null,
      status: "DRAFT",
      priority: 0,
      startsAt: Date.now(),
      endsAt: null,
      version: 0,
    };
    setSelected(draft);
    setBaseline(draft);
    setMediaState({ dirty: false, locked: false });
    setEditorRevision((value) => value + 1);
    setPanelOpen(true);
    setMessage(null);
  }

  function closePanel(): void {
    if (!confirmEditorChange("Discard unsaved banner changes?")) return;
    discardEditor();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !canManage || archived || mediaState.dirty || mediaState.locked) return;
    const submitted = selected;
    setMessage(null);
    try {
      const result = await command.submit(
        "/api/admin/banners",
        {
          bannerId: selected.bannerId,
          expectedVersion: selected.version,
          name: selected.name,
          href: selected.href,
          status: selected.status,
          priority: selected.priority,
          startsAt: selected.startsAt,
          endsAt: selected.endsAt,
        },
        "POST",
        { title: "Banner saved" },
      );
      if (!result) return;
      if (!result.ok) {
        if (result.error.code !== "CONFLICT") {
          setMessage(result.error.message);
          return;
        }
        try {
          const response = await fetch("/api/admin/banners", { cache: "no-store" });
          const latest = catalogResultSchema(storefrontBannerListSchema).parse(
            await response.json(),
          );
          if (!latest.ok) throw new Error(latest.error.message);
          setItems(latest.value.items);
          const current = latest.value.items.find((item) => item.bannerId === submitted.bannerId);
          if (result.error.message === "Promotion state or access changed; refresh and review") {
            command.clearSavedIntent();
            if (current && current.version !== submitted.version) {
              setSelected(current);
              setBaseline(current);
            } else if (current) {
              setBaseline(current);
            }
            setMessage(result.error.message);
            return;
          }
          if (!current) {
            setMessage("Save outcome unconfirmed. Check the same save before leaving this editor.");
            return;
          }
          if (current.version !== submitted.version) {
            command.clearSavedIntent();
            setSelected(current);
            setBaseline(current);
            if (current.status === "ARCHIVED") {
              setMediaState({ dirty: false, locked: false });
              setEditorRevision((value) => value + 1);
            }
            setMessage("Banner changed. Review the current record before saving again.");
          } else {
            setMessage("Save outcome unconfirmed. Check the same save before leaving this editor.");
          }
        } catch {
          setMessage("Save outcome unconfirmed. Check the same save before leaving this editor.");
        }
        return;
      }
      setSelected(result.value);
      setBaseline(result.value);
      setMessage("Banner saved.");
      await load(true);
    } catch {
      setMessage("Save outcome unknown. Check the same save before leaving this editor.");
    }
  }

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((banner) => {
      const matchesView = view === "all" || banner.status === view;
      const matchesQuery =
        normalized === "" ||
        banner.name.toLocaleLowerCase().includes(normalized) ||
        (banner.href?.toLocaleLowerCase().includes(normalized) ?? false);
      return matchesView && matchesQuery;
    });
  }, [items, query, view]);

  if (loadState.phase === "loading") {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Banners" />
        <AdminPageState state="loading" title="Loading banners" />
      </section>
    );
  }

  if (loadState.phase === "error") {
    return (
      <section className="space-y-6 p-5 sm:p-7" aria-labelledby="admin-page-title">
        <PageHeader title="Banners" />
        <AdminPageState
          state="error"
          title="Banners could not be loaded"
          message={loadState.message}
          requestId={loadState.requestId ?? undefined}
          onRetry={() => void load()}
        />
      </section>
    );
  }

  const master = (
    <section className="flex min-w-0 flex-col p-5 sm:p-7" aria-labelledby="admin-page-title">
      <PageHeader
        title="Banners"
        description="Manage the standalone images displayed on your storefront."
        action={
          canManage ? (
            <Button
              type="button"
              size="sm"
              onClick={create}
              disabled={locked}
              aria-expanded={panelOpen}
              aria-controls="banner-detail-panel"
              className="fm-admin-reference-primary"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add banner
            </Button>
          ) : undefined
        }
      />

      {message ? (
        <p
          role={command.uncertain ? "alert" : "status"}
          className="mt-5 rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] p-3 text-sm"
        >
          {message}
        </p>
      ) : null}

      <section className="mt-8 overflow-hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] shadow-[var(--fm-shadow-card)]">
        <h2 className="sr-only">Banner gallery</h2>
        <AdminIndexViews<BannerView>
          label="Banner views"
          views={bannerViews}
          value={view}
          onChange={setView}
        />
        <div className="flex flex-col gap-3 border-b border-[var(--fm-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--fm-text-muted)]" aria-live="polite">
            Showing {visibleItems.length} of {items.length} loaded banners. Search and status filter
            loaded banners only.
          </p>
          <div className="flex items-center gap-2">
            <label className="relative block min-w-0 sm:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fm-text-muted)]"
                aria-hidden="true"
              />
              <Input
                aria-label="Search loaded banners"
                placeholder="Search loaded banners"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 bg-[var(--fm-admin-surface)] pl-9 shadow-none"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => void load(true)}
              disabled={refreshing}
              aria-label="Refresh banner gallery"
            >
              <RotateCw className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <AdminPageState
            state={items.length === 0 ? "empty" : "filtered-empty"}
            title={items.length === 0 ? "No banners yet" : "No banners match this view"}
            message={
              items.length === 0
                ? canManage
                  ? "Add a banner to create the first storefront image."
                  : "No storefront banners are available."
                : "Change the search or status view to see another loaded banner."
            }
          />
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-2 2xl:grid-cols-3">
            {visibleItems.map((banner) => {
              const active = panelOpen && selected?.bannerId === banner.bannerId;
              return (
                <button
                  key={banner.bannerId}
                  type="button"
                  aria-expanded={active}
                  aria-controls="banner-detail-panel"
                  disabled={locked}
                  onClick={() => openBanner(banner)}
                  className={`group overflow-hidden rounded-[var(--fm-radius-surface)] border bg-[var(--fm-admin-surface)] text-left transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] ${
                    active
                      ? "border-[var(--fm-admin-accent)] shadow-[var(--fm-shadow-card)]"
                      : "border-[var(--fm-border)] hover:border-[var(--fm-admin-accent)] hover:shadow-[var(--fm-shadow-card)]"
                  }`}
                >
                  <div className="relative aspect-[20/9] overflow-hidden bg-[var(--fm-admin-surface-muted)]">
                    {banner.image ? (
                      <img
                        src={banner.image.src}
                        alt={banner.image.alt}
                        className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.01] motion-reduce:transform-none"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-2 text-[var(--fm-text-muted)]">
                        <ImageIcon className="size-6" aria-hidden="true" />
                        <span className="text-xs font-medium">No image</span>
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 truncate font-semibold">
                        {banner.name || "Untitled banner"}
                      </h3>
                      <AdminStatusPill status={banner.status} tone={statusTone(banner.status)} />
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--fm-text-muted)]">
                      <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                      {scheduleLabel(banner)}
                    </p>
                    <p className="mt-2 truncate text-xs text-[var(--fm-text-muted)]">
                      Priority {banner.priority} · {banner.href ?? "No destination"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );

  const detail = selected ? (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--fm-text-muted)]">Content / Banners</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 id="banner-panel-title" className="truncate text-xl font-bold tracking-[-0.03em]">
              {selected.version ? selected.name || "Untitled banner" : "New banner"}
            </h2>
            <AdminStatusPill status={selected.status} tone={statusTone(selected.status)} />
          </div>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            Configure the storefront image, destination, and publication schedule.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={closePanel}
          disabled={locked}
          aria-label="Close banner editor"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-[var(--fm-background)] px-5 py-5">
        <form id="banner-details-form" onSubmit={save} className="space-y-5">
          <fieldset disabled={!canManage || archived || locked} className="space-y-5">
            <section
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
              aria-labelledby="banner-details-heading"
            >
              <h3 id="banner-details-heading" className="text-base font-semibold">
                Banner details
              </h3>
              <div className="mt-4 grid gap-4">
                <label className="block text-sm font-semibold">
                  Title<span className="text-red-600"> *</span>
                  <Input
                    required
                    maxLength={150}
                    value={selected.name}
                    onChange={(event) =>
                      setSelected({ ...selected, name: event.currentTarget.value })
                    }
                    className="mt-1.5 h-10"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Storefront destination
                  <Input
                    placeholder="/#catalog"
                    value={selected.href ?? ""}
                    onChange={(event) =>
                      setSelected({ ...selected, href: event.currentTarget.value || null })
                    }
                    className="mt-1.5 h-10"
                  />
                  <span className="mt-1.5 block text-xs font-normal text-[var(--fm-text-muted)]">
                    Optional same-origin path. Leave blank for an image without a link.
                  </span>
                </label>
              </div>
            </section>

            <section
              className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]"
              aria-labelledby="banner-publication-heading"
            >
              <h3 id="banner-publication-heading" className="text-base font-semibold">
                Publication
              </h3>
              <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
                Dates use this browser’s timezone. Active banners appear only inside their date
                window and while an image is attached.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Status
                  <select
                    className="mt-1.5 min-h-10 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-3 text-sm"
                    value={selected.status}
                    onChange={(event) => {
                      const status = storefrontBannerSchema.shape.status.parse(
                        event.currentTarget.value,
                      );
                      setSelected({ ...selected, status });
                    }}
                  >
                    <option value="DRAFT">Draft</option>
                    {selected.version > 0 ? (
                      <>
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                        <option value="ARCHIVED">Archived</option>
                      </>
                    ) : null}
                  </select>
                </label>
                <label className="block text-sm font-semibold">
                  Display priority
                  <Input
                    type="number"
                    min={-10000}
                    max={10000}
                    value={selected.priority}
                    onChange={(event) =>
                      setSelected({ ...selected, priority: Number(event.currentTarget.value) })
                    }
                    className="mt-1.5 h-10"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Starts<span className="text-red-600"> *</span>
                  <Input
                    type="datetime-local"
                    required
                    value={localDate(selected.startsAt)}
                    onChange={(event) =>
                      setSelected({
                        ...selected,
                        startsAt: new Date(event.currentTarget.value).getTime(),
                      })
                    }
                    className="mt-1.5 h-10"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Ends
                  <Input
                    type="datetime-local"
                    value={localDate(selected.endsAt)}
                    onChange={(event) =>
                      setSelected({
                        ...selected,
                        endsAt: event.currentTarget.value
                          ? new Date(event.currentTarget.value).getTime()
                          : null,
                      })
                    }
                    className="mt-1.5 h-10"
                  />
                </label>
              </div>
              <p className="mt-4 text-xs text-[var(--fm-text-muted)]">
                Higher priority banners appear first. Archived banners are retained as read-only
                records.
              </p>
            </section>
          </fieldset>
        </form>

        {selected.version > 0 ? (
          <BannerMediaEditor
            bannerId={selected.bannerId}
            archived={archived}
            onChange={() => void load(true)}
            onStateChange={setMediaState}
          />
        ) : (
          <section className="rounded-[var(--fm-radius-surface)] border border-dashed border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5">
            <h3 className="text-base font-semibold">Banner image</h3>
            <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
              Save this draft before choosing its storefront image.
            </p>
          </section>
        )}

        <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 shadow-[var(--fm-shadow-card)]">
          <h3 className="text-base font-semibold">Summary</h3>
          <dl className="mt-3 divide-y divide-[var(--fm-border)] text-sm" aria-live="polite">
            <div className="py-3 first:pt-0">
              <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Banner</dt>
              <dd className="mt-1 font-medium">{selected.name.trim() || "Title not entered"}</dd>
            </div>
            <div className="py-3">
              <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Destination</dt>
              <dd className="mt-1 break-all">{selected.href || "No destination"}</dd>
            </div>
            <div className="py-3 last:pb-0">
              <dt className="text-xs font-medium text-[var(--fm-text-muted)]">Schedule</dt>
              <dd className="mt-1">{scheduleLabel(selected)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--fm-border)] bg-[var(--fm-admin-surface)] px-5 py-4 shadow-[0_-8px_24px_rgb(15_23_42_/_0.08)]">
        <p className="text-sm text-[var(--fm-text-muted)]" aria-live="polite">
          {command.uncertain
            ? "Save outcome unknown"
            : mediaState.locked
              ? "Image outcome unknown"
              : mediaState.dirty
                ? "Save or discard image changes first"
                : dirty
                  ? "Unsaved changes"
                  : archived
                    ? "Archived banner"
                    : "Up to date"}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" disabled={locked} onClick={closePanel}>
            {dirty ? "Discard" : "Close"}
          </Button>
          {canManage && !archived ? (
            <Button
              type="submit"
              form="banner-details-form"
              disabled={command.pending || mediaState.locked || mediaState.dirty}
            >
              {command.pending
                ? "Saving…"
                : command.uncertain
                  ? "Check save status"
                  : selected.version
                    ? "Save banner"
                    : "Save draft"}
            </Button>
          ) : null}
        </div>
      </div>
    </>
  ) : null;

  return (
    <AdminMasterDetailWorkspace
      open={panelOpen && selected !== null}
      master={master}
      detail={detail}
      detailKey={selected ? `${selected.bannerId}:${editorRevision}` : undefined}
      panelId="banner-detail-panel"
      labelledBy="banner-panel-title"
      resizeLabel="Resize banner editor"
    />
  );
}
