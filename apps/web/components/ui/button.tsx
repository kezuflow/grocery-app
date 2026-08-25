import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center rounded-[var(--fm-radius-control)] px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--fm-primary-dark)] text-white hover:bg-[#294f30]",
        outline: "border border-[var(--fm-border)] bg-white hover:bg-[var(--fm-hover)]",
        destructive: "bg-[var(--fm-destructive)] text-white hover:bg-[#b42318]",
      },
      size: { default: "h-10 px-4", sm: "h-9 px-3", icon: "size-10 p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
