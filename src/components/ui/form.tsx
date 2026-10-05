"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Switch as RSwitch } from "radix-ui";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";

const control =
  "w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink shadow-xs placeholder:text-ink-4 transition-[border-color,box-shadow] duration-100 hover:border-ink-4 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-3 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { prefix?: string; suffix?: string }>(function Input(
  { className, prefix, suffix, ...rest },
  ref,
) {
  if (prefix || suffix) {
    return (
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[13px] text-ink-3">{prefix}</span>}
        <input ref={ref} className={cn(control, "h-8 max-sm:h-10", prefix && "pl-6", suffix && "pr-9", className)} {...rest} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[12px] text-ink-3">{suffix}</span>}
      </div>
    );
  }
  return <input ref={ref} className={cn(control, "h-8 max-sm:h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, "py-1.5 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, "h-8 appearance-none pr-8 max-sm:h-10", className)} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" size="sm" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
    </div>
  );
});

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled, description, id }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; description?: ReactNode; id?: string }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label htmlFor={cid} className={cn("flex cursor-pointer items-start gap-2 text-[13px]", disabled && "cursor-not-allowed opacity-60")}>
      <input id={cid} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border-line-strong accent-accent" />
      <span>
        <span className="text-ink">{label}</span>
        {description && <span className="block text-[12px] text-ink-3">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="text-[13px]">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="block text-[12px] text-ink-3">{description}</span>}
      </label>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
    </div>
  );
}

/** Compact segmented control for 2–5 mutually exclusive options. */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface-3 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[5px] px-2.5 font-medium text-ink-2 transition-colors",
            size === "sm" ? "h-6 text-[12px]" : "h-7 text-[13px]",
            value === o.value ? "bg-surface text-ink shadow-sm" : "hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FormGrid({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const map = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };
  return <div className={cn("grid grid-cols-1 gap-x-4 gap-y-3.5", map[cols], className)}>{children}</div>;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0 lg:grid-cols-[220px_1fr]">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-[12px] text-ink-3">{description}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}
