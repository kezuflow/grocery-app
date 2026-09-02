import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "../../lib/utils";
export const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--fm-radius-control)] px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[var(--fm-primary-dark)] text-white hover:bg-[#294f30]",
        outline:
          "border border-[var(--fm-border)] bg-[var(--fm-background)] hover:bg-[var(--fm-hover)]",
        destructive: "bg-[var(--fm-destructive)] text-white hover:bg-[#b42318]",
        ghost: "bg-transparent hover:bg-[var(--fm-hover)]",
        secondary: "bg-[var(--fm-surface-muted)] text-[var(--fm-text)] hover:bg-[var(--fm-hover)]",
        link: "h-auto bg-transparent p-0 text-[var(--fm-primary-dark)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3",
        xs: "h-7 px-2 text-xs",
        icon: "size-10 p-0",
        "icon-sm": "size-8 p-0",
        "icon-xs": "size-6 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, variant, size, ...props }, ref) => {
    const Component = asChild ? Slot.Root : "button";
    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
