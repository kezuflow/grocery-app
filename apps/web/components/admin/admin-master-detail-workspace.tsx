"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH,
  AdminWorkspaceResizeHandle,
} from "./admin-workspace-resize-handle";

const PANEL_EXIT_MS = 220;

export function AdminMasterDetailWorkspace({
  open,
  master,
  detail,
  panelId,
  labelledBy,
  resizeLabel,
  className,
}: {
  open: boolean;
  master: ReactNode;
  detail: ReactNode;
  panelId: string;
  labelledBy: string;
  resizeLabel: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [panelWidth, setPanelWidth] = useState(ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <div
      data-admin-workspace
      style={{ "--fm-admin-workspace-panel-open-width": `${panelWidth}px` } as CSSProperties}
      className={cn(
        "grid min-h-[calc(100svh-3.5rem)] md:min-h-[calc(100svh-4.5rem)] xl:[grid-template-columns:minmax(0,1fr)_var(--fm-admin-workspace-panel-width)] motion-reduce:transition-none",
        resizing
          ? "xl:transition-none"
          : "xl:transition-[grid-template-columns] xl:duration-200 xl:ease-linear",
        open
          ? "xl:[--fm-admin-workspace-panel-width:var(--fm-admin-workspace-panel-open-width)]"
          : "xl:[--fm-admin-workspace-panel-width:0px]",
        className,
      )}
    >
      <div className="min-w-0">{master}</div>
      {mounted ? (
        <aside
          id={panelId}
          aria-labelledby={labelledBy}
          className={cn(
            "fixed inset-0 z-50 flex h-svh min-h-0 overflow-hidden xl:sticky xl:inset-auto xl:top-0 xl:z-auto xl:h-[calc(100svh-4.5rem)]",
            !open && "pointer-events-none",
          )}
        >
          <div
            className={cn(
              "relative ml-auto flex h-full min-h-0 w-full flex-col bg-[var(--fm-admin-surface)] transition-[transform,opacity] [transition-duration:var(--fm-motion-panel)] [transition-timing-function:var(--fm-ease-drawer)] will-change-[transform,opacity] motion-reduce:transform-none motion-reduce:transition-[opacity] motion-reduce:[transition-duration:var(--fm-motion-fast)] motion-reduce:[transition-timing-function:var(--fm-ease-out)] xl:absolute xl:inset-y-0 xl:right-0 xl:w-[var(--fm-admin-workspace-panel-open-width)] xl:border-l xl:border-[var(--fm-border)]",
              open ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 xl:translate-x-0",
            )}
          >
            <AdminWorkspaceResizeHandle
              label={resizeLabel}
              width={panelWidth}
              onWidthChange={setPanelWidth}
              onResizeStateChange={setResizing}
            />
            {detail}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
