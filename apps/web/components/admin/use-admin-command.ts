"use client";
import { useCallback, useRef, useState } from "react";
import { z } from "@freshmarkets/validation";
type PendingAdminCommand = {
  operationId: string;
  url: string;
  body: string;
  key: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
};
const commandResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
export function useAdminCommand() {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<PendingAdminCommand | null>(null);
  const inFlight = useRef(false);
  const execute = useCallback(async (command: PendingAdminCommand) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(command.url, {
        method: command.method,
        headers: { "content-type": "application/json", "idempotency-key": command.key },
        body: command.body,
      });
      const parsed = commandResultSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid command result");
      pending.current = null;
      setUncertain(false);
      setNotice(parsed.data.ok ? "Done." : parsed.data.error.message);
      return parsed.data.ok;
    } catch {
      setUncertain(true);
      setNotice(
        "The action could not be confirmed. Retry the original request before starting another action.",
      );
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  const run = useCallback(
    async (
      operationId: string,
      url: string,
      body: unknown,
      method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
    ) => {
      const serialized = JSON.stringify(body);
      const previous = pending.current;
      if (
        previous &&
        (previous.operationId !== operationId ||
          previous.url !== url ||
          previous.body !== serialized ||
          previous.method !== method)
      ) {
        setNotice("Retry the unconfirmed action before submitting a changed request.");
        return false;
      }
      const command = previous ?? {
        operationId,
        url,
        body: serialized,
        key: crypto.randomUUID(),
        method,
      };
      pending.current = command;
      return execute(command);
    },
    [execute],
  );
  const retry = useCallback(
    () => (pending.current ? execute(pending.current) : Promise.resolve(false)),
    [execute],
  );
  return { notice, setNotice, run, retry, busy, uncertain };
}
