import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline-danger" | "link";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent select-none";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-xs hover:bg-accent-hover active:bg-accent-hover",
  secondary: "bg-surface text-ink border border-line-strong shadow-xs hover:bg-surface-2 hover:border-ink-4",
  ghost: "text-ink-2 hover:bg-surface-3 hover:text-ink",
  danger: "bg-danger text-white shadow-xs hover:bg-[#9b1f18]",
  "outline-danger": "bg-surface text-danger border border-danger-line hover:bg-danger-soft",
  link: "text-accent underline-offset-2 hover:underline px-0 h-auto",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px]",
  md: "h-8 px-3 text-[13px]",
  lg: "h-10 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(base, variants[variant], variant !== "link" && sizes[size], "max-sm:min-h-9", className)} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} size="sm" /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size="sm" /> : null}
    </button>
  );
});

export function ButtonLink({ href, variant = "secondary", size = "md", icon, iconRight, className, children, ...rest }: { href: string; variant?: Variant; size?: Size; icon?: IconName; iconRight?: IconName; className?: string; children: ReactNode; target?: string; rel?: string }) {
  return (
    <Link href={href} className={cn(base, variants[variant], variant !== "link" && sizes[size], className)} {...rest}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size="sm" /> : null}
    </Link>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "icon" | "children"> & { icon: IconName; label: string }>(function IconButton(
  { icon, label, variant = "ghost", size = "md", className, type = "button", ...rest },
  ref,
) {
  const dim = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={cn(base, variants[variant], dim, "p-0 max-sm:h-9 max-sm:w-9", className)} {...rest}>
      <Icon name={icon} size={size === "lg" ? "lg" : "md"} />
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-3.5 w-3.5 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
