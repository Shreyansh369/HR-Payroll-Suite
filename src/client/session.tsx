"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Permission } from "@/domain/auth/permissions";
import type { ProcOutput } from "@/services/registry";
import { call, getTransport } from "@/client/api";
import { AppError } from "@/lib/errors";

export type SessionContext = ProcOutput<"session.context">;

interface SessionValue {
  ctx: SessionContext;
  can: (p: Permission) => boolean;
  canAny: (ps: Permission[]) => boolean;
  refresh: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionGate");
  return v;
}

export function useCurrency(): string {
  return useSession().ctx.company.currency;
}

type GateState = { status: "loading"; message?: string } | { status: "ready"; ctx: SessionContext } | { status: "error"; message: string };

export function SessionGate({ children, loading }: { children: ReactNode; loading: (message?: string) => ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [state, setState] = useState<GateState>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const t = await getTransport();
      await t.init((message) => setState({ status: "loading", message }));
      const s = await t.session();
      if (!s) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      const ctx = await call("session.context", {});
      setState({ status: "ready", ctx });
    } catch (e) {
      const err = AppError.from(e);
      if (err.code === "UNAUTHENTICATED") {
        router.replace("/login");
        return;
      }
      setState({ status: "error", message: err.message });
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial session bootstrap
    void load();
  }, [load]);

  if (state.status === "loading") return <>{loading(state.message)}</>;
  if (state.status === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <p className="text-[15px] font-semibold">The workspace could not be opened</p>
          <p className="mt-1 text-[13px] text-ink-3">{state.message}</p>
          <button type="button" className="mt-4 text-[13px] font-medium text-accent hover:underline" onClick={() => router.replace("/login")}>
            Return to sign in
          </button>
        </div>
      </div>
    );
  }

  const ctx = state.ctx;
  const value: SessionValue = {
    ctx,
    can: (p) => ctx.permissions.includes(p),
    canAny: (ps) => ps.some((p) => ctx.permissions.includes(p)),
    refresh: async () => {
      const next = await call("session.context", {});
      setState({ status: "ready", ctx: next });
    },
    switchCompany: async (companyId) => {
      const t = await getTransport();
      await t.switchCompany(companyId);
      qc.clear();
      const next = await call("session.context", {});
      setState({ status: "ready", ctx: next });
    },
    logout: async () => {
      const t = await getTransport();
      await t.logout();
      qc.clear();
      router.replace("/login");
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
