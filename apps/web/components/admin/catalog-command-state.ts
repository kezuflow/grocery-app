"use client";
import { useEffect, useRef, useState } from "react";
import { appErrorCodes } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { notifyCommandSuccess, type AdminSuccessFeedback } from "./admin-feedback";
import { setAdminScopeCommandLock } from "./admin-scope-command-lock";

export const catalogErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(appErrorCodes),
    message: z.string(),
    requestId: z.string(),
  }),
});
type Intent = {
  url: string;
  body: string;
  method: "POST" | "PATCH" | "DELETE";
  key: string;
  successFeedback?: AdminSuccessFeedback;
};
export function catalogResultSchema<T>(schema: z.ZodType<T>) {
  return z.union([
    z.object({ ok: z.literal(true), value: schema, requestId: z.string() }),
    catalogErrorSchema,
  ]);
}

/** Catalog create, edit and status retries retain the complete accepted browser intent. */
export function useCatalogCommand<T>(schema: z.ZodType<T>) {
  const resultSchema = catalogResultSchema(schema);

  const saved = useRef<Intent | null>(null);
  const active = useRef(false);
  const lockOwner = useRef({});
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => () => setAdminScopeCommandLock(lockOwner.current, false), []);
  async function execute(command: Intent) {
    if (active.current) return null;
    saved.current = command;
    active.current = true;
    setAdminScopeCommandLock(lockOwner.current, true);
    setPending(true);
    try {
      const response = await fetch(command.url, {
        method: command.method,
        headers: { "content-type": "application/json", "idempotency-key": command.key },
        body: command.body,
      });
      const result = resultSchema.parse(await response.json());
      saved.current = null;
      setUncertain(false);
      setAdminScopeCommandLock(lockOwner.current, false);
      if (result.ok && command.successFeedback) {
        notifyCommandSuccess(
          command.successFeedback.title,
          command.successFeedback.description,
          `catalog-command:${command.key}`,
        );
      }
      return result;
    } catch (error) {
      setUncertain(true);
      throw error;
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  function submit(
    url: string,
    body: unknown,
    method: Intent["method"] = "POST",
    successFeedback?: AdminSuccessFeedback,
  ) {
    return execute(
      saved.current ?? {
        url,
        body: JSON.stringify(body),
        method,
        key: crypto.randomUUID(),
        successFeedback,
      },
    );
  }
  function retry() {
    return saved.current ? execute(saved.current) : Promise.resolve(null);
  }
  return { submit, retry, pending, uncertain };
}
