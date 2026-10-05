"use client";

import type { ReactNode } from "react";
import { SessionGate } from "@/client/session";
import { AppShell } from "@/components/app/app-shell";
import { Spinner } from "@/components/ui/button";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate
      loading={(message) => (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-center" role="status">
          <Spinner className="h-5 w-5 text-accent" />
          <p className="text-[13px] text-ink-2">{message ?? "Opening your workspace…"}</p>
        </div>
      )}
    >
      <AppShell>{children}</AppShell>
    </SessionGate>
  );
}
