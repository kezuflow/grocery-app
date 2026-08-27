import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const alertVariants = cva(
  "relative flex w-full gap-3 rounded-[var(--fm-radius-surface)] border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-[var(--fm-border)] bg-white text-[var(--fm-text)]",
        destructive:
          "border-[var(--fm-danger-border)] bg-[var(--fm-danger-soft)] text-[var(--fm-destructive)]",
        warning:
          "border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] text-[var(--fm-warning)]",
        info: "border-[var(--fm-info-border)] bg-[var(--fm-info-soft)] text-[var(--fm-info)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Alert({
  className,
  variant,
  role = "alert",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role={role} className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<"h5">) {
  return <h5 className={cn("font-semibold leading-none", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-1 text-sm opacity-90", className)} {...props} />;
}
