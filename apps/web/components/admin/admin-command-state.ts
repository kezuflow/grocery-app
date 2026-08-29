"use client";

import { useRef, useState } from "react";
import type { RpcResult } from "@freshmarkets/contracts";

export type AdminCommandIntent = {
  readonly idempotencyKey: string;
  readonly pending: boolean;
  submit<T>(run: (idempotencyKey: string) => Promise<RpcResult<T>>): Promise<RpcResult<T>>;
  reset(): void;
};

/** Framework-free state machine used by the React hook and focused unit tests. */
export function createAdminCommandIntent(
  notify: () => void = () => undefined,
  keyFactory: () => string = () => crypto.randomUUID(),
): AdminCommandIntent {
  let idempotencyKey = keyFactory();
  let active: Promise<RpcResult<unknown>> | null = null;

  return {
    get idempotencyKey() {
      return idempotencyKey;
    },
    get pending() {
      return active !== null;
    },
    submit<T>(run: (key: string) => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
      if (active) return active as Promise<RpcResult<T>>;
      const key = idempotencyKey;
      const execution = Promise.resolve()
        .then(() => run(key))
        .then((result) => {
          // Any typed Core response is definitive. Transport/parse failures reject
          // and intentionally retain the key for an operator retry.
          idempotencyKey = keyFactory();
          return result;
        })
        .finally(() => {
          active = null;
          notify();
        });
      active = execution as Promise<RpcResult<unknown>>;
      notify();
      return execution;
    },
    reset() {
      if (active) return;
      idempotencyKey = keyFactory();
      notify();
    },
  };
}

/** Retains one idempotency key for an operator intent until Core answers definitively. */
export function useAdminCommandIntent(): AdminCommandIntent {
  const [, render] = useState(0);
  const intent = useRef<AdminCommandIntent | null>(null);
  if (intent.current === null) {
    intent.current = createAdminCommandIntent(() => render((version) => version + 1));
  }
  return intent.current;
}
