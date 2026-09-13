import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export const queryKeys = {
  catalog: (epoch: number, query: string, category: string) =>
    ["catalog", epoch, query.trim(), category || "all"] as const,
  private: (epoch: number, resource: string) => ["private", epoch, resource] as const,
  admin: (epoch: number, scope: string, resource: string) =>
    ["private", epoch, "admin", scope, resource] as const,
};

export const QUERY_CONTEXT_CHANGED_EVENT = "fm:query-context-changed";
export const QUERY_SESSION_CHANGED_EVENT = "fm:query-session-changed";
export function notifyQuerySessionChanged() {
  window.dispatchEvent(new Event(QUERY_SESSION_CHANGED_EVENT));
}
/** Session protocol boundary: discard private server-rendered props as well as caches. */
export function reloadForSessionChange() {
  window.location.reload();
}
export function notifyQueryContextChanged() {
  window.dispatchEvent(new Event(QUERY_CONTEXT_CHANGED_EVENT));
}
