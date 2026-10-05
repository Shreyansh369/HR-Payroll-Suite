"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";

type ToastTone = "success" | "error" | "info" | "warning";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

const Ctx = createContext<{ push: (t: Omit<ToastItem, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" || t.tone === "warning" ? 7000 : 3800);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" role="region" aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 shadow-lg animate-slide-up">
            <Icon
              name={t.tone === "success" ? "success" : t.tone === "error" ? "alert" : t.tone === "warning" ? "warning" : "info"}
              className={cn("mt-px", t.tone === "success" && "text-success", t.tone === "error" && "text-danger", t.tone === "warning" && "text-warning", t.tone === "info" && "text-info")}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[12.5px] text-ink-2">{t.description}</p>}
            </div>
            <button type="button" aria-label="Dismiss" className="self-start text-ink-4 hover:text-ink" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
              <Icon name="close" size="sm" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return {
    success: (title: string, description?: string) => ctx.push({ tone: "success", title, description }),
    error: (title: string, description?: string) => ctx.push({ tone: "error", title, description }),
    info: (title: string, description?: string) => ctx.push({ tone: "info", title, description }),
    warning: (title: string, description?: string) => ctx.push({ tone: "warning", title, description }),
  };
}
