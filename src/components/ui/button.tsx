import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 text-[13px] font-medium uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-accent)] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--color-accent)] text-[color:var(--color-background)] hover:bg-[color:var(--color-accent-hi)]",
        outline:
          "border border-[color:var(--color-border)] bg-transparent hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] text-[color:var(--color-fg)]",
        ghost:
          "bg-transparent hover:text-[color:var(--color-accent)] text-[color:var(--color-fg-muted)]",
        danger:
          "bg-[color:var(--color-danger)] text-white hover:opacity-90",
      },
      size: {
        default: "h-8 px-4",
        sm: "h-7 px-3 text-[11px]",
        lg: "h-10 px-6 text-sm",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
