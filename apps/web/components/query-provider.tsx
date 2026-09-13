"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authClient } from "../lib/auth/auth-client";
import {
  createQueryClient,
  QUERY_CONTEXT_CHANGED_EVENT,
  QUERY_SESSION_CHANGED_EVENT,
  reloadForSessionChange,
} from "../lib/query/query-client";
import { resetCartSession } from "../lib/storefront/cart-client";

const QueryEpochContext = createContext(0);
export function useQueryEpoch() {
  return useContext(QueryEpochContext);
}

/** A mounted application owns its cache; server renders never share a Worker global. */
export function ApplicationQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  const [epoch, setEpoch] = useState(0);
  const [sessionTransition, setSessionTransition] = useState(false);
  const transitionStarted = useRef(false);
  const { data: session, isPending } = authClient.useSession();
  const identity = session?.session.id ?? null;
  const previousIdentity = useRef<string | null | undefined>(undefined);
  const identityChanging =
    !isPending && previousIdentity.current !== undefined && previousIdentity.current !== identity;
  useEffect(() => {
    const reset = () => {
      void client.cancelQueries();
      client.clear();
      setEpoch((value) => value + 1);
    };
    window.addEventListener(QUERY_CONTEXT_CHANGED_EVENT, reset);
    const resetSession = () => {
      transitionStarted.current = true;
      resetCartSession();
      reset();
      setSessionTransition(true);
    };
    window.addEventListener(QUERY_SESSION_CHANGED_EVENT, resetSession);
    return () => {
      window.removeEventListener(QUERY_CONTEXT_CHANGED_EVENT, reset);
      window.removeEventListener(QUERY_SESSION_CHANGED_EVENT, resetSession);
    };
  }, [client]);
  useLayoutEffect(() => {
    if (isPending) return;
    if (previousIdentity.current !== undefined && previousIdentity.current !== identity) {
      if (transitionStarted.current) return;
      transitionStarted.current = true;
      resetCartSession();
      void client.cancelQueries();
      client.clear();
      setEpoch((value) => value + 1);
      setSessionTransition(true);
      reloadForSessionChange();
      return;
    }
    previousIdentity.current = identity;
  }, [client, identity, isPending]);
  return (
    <QueryClientProvider client={client}>
      <QueryEpochContext.Provider value={epoch}>
        {identityChanging || sessionTransition ? <p role="status">Updating session…</p> : children}
      </QueryEpochContext.Provider>
    </QueryClientProvider>
  );
}
