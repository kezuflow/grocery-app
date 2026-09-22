import { LoaderCircle } from "lucide-react";

/** Compact, accessible status beside an in-flight quantity stepper. */
export function QuantityPendingSpinner() {
  return (
    <span
      role="status"
      aria-label="Updating quantity"
      className="inline-flex size-4 shrink-0 items-center justify-center text-[var(--fm-primary-dark)]"
    >
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    </span>
  );
}
