"use client";

import { useEffect, useRef } from "react";

type Guard = { dirty: boolean; locked: boolean };

const guards = new Map<object, Guard>();
let marker: string | null = null;
let guardedUrl: string | null = null;
let leaving = false;
let listening = false;

function currentGuard(): Guard {
  return [...guards.values()].reduce(
    (result, guard) => ({
      dirty: result.dirty || guard.dirty,
      locked: result.locked || guard.locked,
    }),
    { dirty: false, locked: false },
  );
}

function guardedHistoryState(id: string): Record<string, unknown> {
  const state = window.history.state;
  return { ...(state && typeof state === "object" ? state : {}), freshmarketsAdminGuard: id };
}

function syncHistoryGuard(): void {
  const { dirty, locked } = currentGuard();
  if (dirty || locked) {
    if (!marker) {
      marker = crypto.randomUUID();
      guardedUrl = window.location.href;
      window.history.pushState(guardedHistoryState(marker), "", guardedUrl);
    }
    return;
  }
  if (marker && window.history.state?.freshmarketsAdminGuard === marker && !leaving) {
    // Pop the same-URL guard entry once all drafts and commands have resolved.
    window.history.back();
  }
  marker = null;
  guardedUrl = null;
  leaving = false;
}

function blockNavigation(): boolean {
  if (leaving) return false;
  const { dirty, locked } = currentGuard();
  if (!dirty && !locked) return false;
  if (locked) return true;
  if (dirty && !window.confirm("Discard unsaved changes and leave this page?")) return true;
  leaving = true;
  return false;
}

/** Use for programmatic Admin navigation that has no anchor click to intercept. */
function leaveAfterRemovingGuard(navigate: () => void): void {
  if (marker && window.history.state?.freshmarketsAdminGuard === marker) {
    marker = null;
    guardedUrl = null;
    window.addEventListener("popstate", () => window.setTimeout(navigate, 0), { once: true });
    window.history.back();
    return;
  }
  navigate();
}

export function tryNavigateAdminRoute(navigate: () => void): boolean {
  const { dirty, locked } = currentGuard();
  if (!dirty && !locked) {
    navigate();
    return true;
  }
  if (blockNavigation()) return false;
  leaveAfterRemovingGuard(navigate);
  return true;
}

function onLinkClick(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")) return;
  if (link.href === window.location.href) return;
  if (leaving) return;
  const { dirty, locked } = currentGuard();
  if (!dirty && !locked) return;
  event.preventDefault();
  event.stopPropagation();
  tryNavigateAdminRoute(() => link.click());
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (leaving) return;
  const { dirty, locked } = currentGuard();
  if (!dirty && !locked) return;
  event.preventDefault();
  event.returnValue = "";
}

function onPopState(): void {
  if (!marker || leaving) return;
  const priorUrl = guardedUrl;
  if (!blockNavigation()) {
    marker = null;
    guardedUrl = null;
    // The first Back only removes the same-URL guard entry.
    window.history.back();
    return;
  }
  if (priorUrl) window.history.pushState(guardedHistoryState(marker), "", priorUrl);
}

function installListeners(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("click", onLinkClick, true);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("popstate", onPopState);
}

function removeListeners(): void {
  if (!listening || guards.size > 0) return;
  listening = false;
  document.removeEventListener("click", onLinkClick, true);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("popstate", onPopState);
  marker = null;
  guardedUrl = null;
  leaving = false;
}

/** Blocks route exits while a draft exists or an Admin command outcome is unknown. */
export function useAdminRouteGuard(dirty: boolean, locked: boolean): void {
  const owner = useRef<object>({});
  useEffect(() => {
    guards.set(owner.current, { dirty: false, locked: false });
    installListeners();
    return () => {
      guards.delete(owner.current);
      removeListeners();
    };
  }, []);
  useEffect(() => {
    if (!guards.has(owner.current)) return;
    guards.set(owner.current, { dirty, locked });
    syncHistoryGuard();
  }, [dirty, locked]);
}
