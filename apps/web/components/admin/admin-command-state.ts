"use client";

import { useEffect, useRef, useState } from "react";
import type { AppError, RpcResult } from "@freshmarkets/contracts";
import { setAdminScopeCommandLock } from "./admin-scope-command-lock";

export type AdminCommandIntent = {
  readonly idempotencyKey: string;
  readonly pending: boolean;
  readonly uncertain: boolean;
  submit<T>(run: (idempotencyKey: string) => Promise<RpcResult<T>>): Promise<RpcResult<T>>;
  reset(): void;
};

/** Framework-free state machine used by the React hook and focused unit tests. */
export function createAdminCommandIntent(
  notify: () => void = () => undefined,
  keyFactory: () => string = () => crypto.randomUUID(),
  options?: { retainConflict?: (error: AppError) => boolean },
): AdminCommandIntent {
  let idempotencyKey = keyFactory();
  let active: Promise<RpcResult<unknown>> | null = null;
  let uncertain = false;

  return {
    get idempotencyKey() {
      return idempotencyKey;
    },
    get pending() {
      return active !== null;
    },
    get uncertain() {
      return uncertain;
    },
    submit<T>(run: (key: string) => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
      if (active) return active as Promise<RpcResult<T>>;
      const key = idempotencyKey;
      const execution = Promise.resolve()
        .then(() => run(key))
        .then((result) => {
          // Some commands use CONFLICT for an original request still processing.
          // Those retain the same key until Core returns a final typed outcome.
          if (
            !result.ok &&
            result.error.code === "CONFLICT" &&
            options?.retainConflict?.(result.error)
          ) {
            uncertain = true;
          } else {
            idempotencyKey = keyFactory();
            uncertain = false;
          }
          return result;
        })
        .catch((error: unknown) => {
          uncertain = true;
          throw error;
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
      uncertain = false;
      notify();
    },
  };
}

/** Retains one idempotency key for an operator intent until Core answers definitively. */
export function useAdminCommandIntent(options?: {
  retainConflict?: (error: AppError) => boolean;
}): AdminCommandIntent {
  const [, render] = useState(0);
  const intent = useRef<AdminCommandIntent | null>(null);
  const lockOwner = useRef({});
  if (intent.current === null) {
    intent.current = createAdminCommandIntent(
      () => {
        setAdminScopeCommandLock(
          lockOwner.current,
          Boolean(intent.current?.pending || intent.current?.uncertain),
        );
        render((version) => version + 1);
      },
      undefined,
      options,
    );
  }
  useEffect(() => () => setAdminScopeCommandLock(lockOwner.current, false), []);
  return intent.current;
}
