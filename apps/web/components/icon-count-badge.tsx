"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function IconCountBadge({ count, className }: { count: number; className?: string }) {
  const [retainedCount, setRetainedCount] = useState(count);
  const [settled, setSettled] = useState(true);
  const previousCount = useRef(count);

  useEffect(() => {
    if (count > 0) {
      setRetainedCount(count);
    } else {
      const timeout = window.setTimeout(() => setRetainedCount(0), 200);
      return () => window.clearTimeout(timeout);
    }
  }, [count]);

  useEffect(() => {
    if (count <= 0 || previousCount.current === count) return;
    previousCount.current = count;
    setSettled(false);
    const frame = window.requestAnimationFrame(() => setSettled(true));
    return () => window.cancelAnimationFrame(frame);
  }, [count]);

  const displayedCount = count > 0 ? count : retainedCount;
  if (displayedCount <= 0) return null;

  return (
    <span
      aria-hidden="true"
      data-visible={count > 0}
      className={cn(
        "fm-count-badge absolute -top-2.5 -right-2.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--fm-storefront-accent)] px-1 py-0.5 text-[10px] font-semibold leading-none text-white",
        className,
      )}
    >
      <span className="fm-count-badge-value" data-settled={settled}>
        {displayedCount}
      </span>
    </span>
  );
}
