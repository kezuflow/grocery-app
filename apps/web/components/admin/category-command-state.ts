"use client";
import { useRef, useState } from "react";
import { appErrorCodes } from "@freshmarkets/contracts";
import { z, adminCategorySummarySchema } from "@freshmarkets/validation";

export const categoryErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(appErrorCodes),
    message: z.string(),
    requestId: z.string(),
  }),
});
const resultSchema = z.union([
  z.object({ ok: z.literal(true), value: adminCategorySummarySchema, requestId: z.string() }),
  categoryErrorSchema,
]);
type Intent = { url: string; body: string; method: "POST" | "PATCH"; key: string };

/** Category create, edit and status retries retain the complete accepted browser intent. */
export function useCategoryCommand() {
  const saved = useRef<Intent | null>(null);
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  async function submit(url: string, body: unknown, method: Intent["method"] = "POST") {
    if (active.current) return null;
    const command = saved.current ?? {
      url,
      body: JSON.stringify(body),
      method,
      key: crypto.randomUUID(),
    };
    saved.current = command;
    active.current = true;
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
      return result;
    } catch (error) {
      setUncertain(true);
      throw error;
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return { submit, pending, uncertain };
}
