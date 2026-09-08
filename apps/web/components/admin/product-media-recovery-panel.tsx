"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductMediaRecoveryView, ProductMediaRecoveryAction } from "@freshmarkets/contracts";
import {
  productMediaRecoveryViewSchema,
  productMediaRecoveryResultSchema,
  z,
} from "@freshmarkets/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const errorSchema = z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) });
const viewSchema = z.union([
  z.object({ ok: z.literal(true), value: productMediaRecoveryViewSchema }),
  errorSchema,
]);
const resultSchema = z.union([
  z.object({ ok: z.literal(true), value: productMediaRecoveryResultSchema }),
  errorSchema,
]);
const labels: Record<ProductMediaRecoveryAction, string> = {
  OBSERVE_UPLOAD: "Observe storage",
  DISCARD_UPLOAD: "Discard upload",
  RETRY_CLEANUP: "Retry cleanup",
};
type Intent = {
  key: string;
  body: {
    itemId: string;
    action: ProductMediaRecoveryAction;
    expectedVersion: number;
    reason: string;
  };
};

export function ProductMediaRecoveryPanel({ productId }: { productId: string }) {
  const [view, setView] = useState<ProductMediaRecoveryView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const readGeneration = useRef(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const intent = useRef<Intent | null>(null);
  const active = useRef(false);
  const url = `/api/admin/catalog/products/${encodeURIComponent(productId)}/media/recovery`;
  const load = useCallback(
    async (cursor?: string) => {
      const generation = ++readGeneration.current;
      setLoading(true);
      setReadError(null);
      try {
        const response = await fetch(
          `${url}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        const result = viewSchema.parse(await response.json());
        if (generation !== readGeneration.current) return;
        if (!result.ok) {
          setReadError(result.error.message);
          return;
        }
        setView((previous) =>
          cursor && previous
            ? { ...result.value, items: [...previous.items, ...result.value.items] }
            : result.value,
        );
      } catch {
        if (generation === readGeneration.current)
          setReadError("Recovery work could not be loaded. Refresh to try again.");
      } finally {
        if (generation === readGeneration.current) setLoading(false);
      }
    },
    [url],
  );
  useEffect(() => {
    setView(null);
    void load();
    return () => {
      readGeneration.current++;
    };
  }, [load]);
  async function run(selected?: Intent["body"]) {
    if (active.current) return;
    if (!intent.current && selected) intent.current = { key: crypto.randomUUID(), body: selected };
    const saved = intent.current;
    if (!saved) return;
    if (!saved.body.reason.trim()) {
      intent.current = null;
      setMessage("Enter a reason for recovery.");
      return;
    }
    active.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": saved.key },
        body: JSON.stringify(saved.body),
      });
      const result = resultSchema.parse(await response.json());
      intent.current = null;
      if (!result.ok) setMessage(result.error.message);
      else {
        setMessage(
          result.value.status === "UNKNOWN"
            ? "The object is still unconfirmed. Observe it again later; no new upload was sent."
            : "Recovery action saved.",
        );
        if (result.value.status === "ABANDONED")
          setMessage(
            "Stored upload discarded. Retry its saved upload to confirm the result and choose a new image.",
          );
      }
      await load();
    } catch {
      setMessage("The response was not confirmed. Retry the saved recovery action.");
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-label="Image recovery" className="space-y-3 border-b p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Image recovery</h3>
        <Button
          type="button"
          variant="outline"
          disabled={pending || loading}
          onClick={() => void load()}
        >
          Refresh recovery
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Review unconfirmed uploads and image cleanup. Only unstarted or confirmed stored uploads can
        be discarded.
      </p>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {intent.current && !pending ? (
        <Button type="button" onClick={() => void run()}>
          Retry saved recovery
        </Button>
      ) : null}
      {readError ? (
        <p role="alert" className="text-sm">
          {readError}
        </p>
      ) : null}
      {loading ? <p role="status">Loading recovery work…</p> : null}
      {!view ? null : view.items.length === 0 ? (
        <p className="text-sm">No image recovery work is pending.</p>
      ) : (
        view.items.map((item) => (
          <article key={`${item.kind}-${item.itemId}`} className="space-y-2 rounded border p-3">
            <p className="font-medium">{item.label}</p>
            <p className="text-sm">
              {item.kind === "UPLOAD" ? "Upload" : "Cleanup"} · {item.status.toLowerCase()} ·{" "}
              {new Date(item.createdAt).toLocaleString()}
              {item.kind === "CLEANUP" ? ` · ${item.attempts} attempts` : ""}
            </p>
            {item.errorCode ? (
              <p className="text-sm">
                Storage cleanup was not confirmed.{" "}
                {item.status === "FAILED"
                  ? "Automatic retries are exhausted."
                  : "A retry is scheduled."}
              </p>
            ) : null}
            {item.allowedActions.length ? (
              <fieldset disabled={pending || intent.current !== null} className="space-y-2">
                <label className="grid gap-1 text-sm">
                  Recovery reason for {item.label}
                  <Input
                    maxLength={500}
                    value={reasons[item.itemId] ?? ""}
                    onChange={(event) =>
                      setReasons((current) => ({ ...current, [item.itemId]: event.target.value }))
                    }
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {item.allowedActions.map((action) => (
                    <Button
                      key={action}
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void run({
                          itemId: item.itemId,
                          action,
                          expectedVersion: item.version,
                          reason: reasons[item.itemId] ?? "",
                        })
                      }
                    >
                      {labels[action]}
                    </Button>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </article>
        ))
      )}
      {view?.nextCursor ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending || loading}
          onClick={() => void load(view.nextCursor ?? undefined)}
        >
          More recovery work
        </Button>
      ) : null}
    </section>
  );
}
