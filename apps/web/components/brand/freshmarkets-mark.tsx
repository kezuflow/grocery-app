import { cn } from "../../lib/utils";

export function FreshMarketsMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/freshmarkets-mark.png"
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
