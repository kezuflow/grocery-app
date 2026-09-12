"use client";

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";

export const ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH = 460;
const ADMIN_WORKSPACE_PANEL_MIN_WIDTH = 380;
const ADMIN_WORKSPACE_PANEL_MAX_WIDTH = 640;
const ADMIN_WORKSPACE_MASTER_MIN_WIDTH = 560;
const ADMIN_WORKSPACE_KEYBOARD_STEP = 16;

type DragState = {
  pointerId: number;
  startX: number;
  startWidth: number;
  maxWidth: number;
  previousCursor: string;
  previousUserSelect: string;
};

function availableMaximum(handle: HTMLElement): number {
  const workspace = handle.closest<HTMLElement>("[data-admin-workspace]");
  const workspaceWidth = workspace?.getBoundingClientRect().width ?? window.innerWidth;
  return Math.max(
    ADMIN_WORKSPACE_PANEL_MIN_WIDTH,
    Math.min(ADMIN_WORKSPACE_PANEL_MAX_WIDTH, workspaceWidth - ADMIN_WORKSPACE_MASTER_MIN_WIDTH),
  );
}

function clampWidth(width: number, maximum: number): number {
  return Math.min(maximum, Math.max(ADMIN_WORKSPACE_PANEL_MIN_WIDTH, Math.round(width)));
}

export function AdminWorkspaceResizeHandle({
  label,
  width,
  onWidthChange,
  onResizeStateChange,
}: {
  label: string;
  width: number;
  onWidthChange: (width: number) => void;
  onResizeStateChange: (resizing: boolean) => void;
}) {
  const drag = useRef<DragState | null>(null);
  const [resizing, setResizing] = useState(false);

  function setResizeState(next: boolean): void {
    setResizing(next);
    onResizeStateChange(next);
  }

  function finishResize(handle: HTMLDivElement, pointerId: number): void {
    const current = drag.current;
    if (!current || current.pointerId !== pointerId) return;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    document.body.style.cursor = current.previousCursor;
    document.body.style.userSelect = current.previousUserSelect;
    drag.current = null;
    setResizeState(false);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      maxWidth: availableMaximum(handle),
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizeState(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    onWidthChange(
      clampWidth(current.startWidth + current.startX - event.clientX, current.maxWidth),
    );
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const maximum = availableMaximum(event.currentTarget);
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = width + ADMIN_WORKSPACE_KEYBOARD_STEP;
    if (event.key === "ArrowRight") nextWidth = width - ADMIN_WORKSPACE_KEYBOARD_STEP;
    if (event.key === "Home") nextWidth = ADMIN_WORKSPACE_PANEL_MIN_WIDTH;
    if (event.key === "End") nextWidth = maximum;
    if (nextWidth === null) return;
    event.preventDefault();
    onWidthChange(clampWidth(nextWidth, maximum));
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={ADMIN_WORKSPACE_PANEL_MIN_WIDTH}
      aria-valuemax={ADMIN_WORKSPACE_PANEL_MAX_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels wide`}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className="group absolute inset-y-0 left-0 z-30 hidden w-4 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none xl:flex"
      onDoubleClick={(event) =>
        onWidthChange(
          clampWidth(ADMIN_WORKSPACE_PANEL_DEFAULT_WIDTH, availableMaximum(event.currentTarget)),
        )
      }
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishResize(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => finishResize(event.currentTarget, event.pointerId)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-12 w-1 rounded-full bg-[var(--fm-border)] transition-[transform,background-color] duration-150 group-hover:bg-[var(--fm-admin-accent)] group-focus-visible:bg-[var(--fm-admin-accent)] motion-reduce:transition-[background-color]",
          resizing && "scale-y-150 bg-[var(--fm-admin-accent)]",
        )}
      />
    </div>
  );
}
