import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* Button */
const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-900 disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-signal text-base-900 hover:bg-signal-soft",
        outline: "border border-base-600 text-ink hover:bg-base-700",
        ghost: "text-ink-muted hover:text-ink hover:bg-base-800",
        danger: "border border-gap/60 text-gap hover:bg-gap/10",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-9 px-4 text-sm", lg: "h-11 px-5 text-sm" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
);
Button.displayName = "Button";

/* Card */
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-base-850/80 shadow-panel backdrop-blur-sm",
        className
      )}
      {...p}
    />
  );
}

/* Badge */
const badge = cva("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-base-700 text-ink-muted",
      signal: "bg-signal/15 text-signal-soft border border-signal/30",
      verified: "bg-verified/15 text-verified border border-verified/30",
      gap: "bg-gap/15 text-gap border border-gap/30",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({
  tone,
  className,
  ...p
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}

/* Input */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-base-600 bg-base-900 px-3 text-sm text-ink placeholder:text-ink-faint",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

/* Spinner */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-muted text-sm" data-testid="spinner">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}

/* Empty state */
export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-base-600 bg-base-850/40 px-6 py-14 text-center"
      data-testid="empty-state"
    >
      {icon && <div className="mb-3 text-ink-faint">{icon}</div>}
      <p className="font-display text-lg text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-ink-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* Key/value row for diagnostics */
export function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line py-2 last:border-0">
      <span className="text-sm text-ink-muted">{k}</span>
      <span className={cn("text-sm text-ink text-right", mono && "font-mono text-[13px]")}>{v}</span>
    </div>
  );
}
