"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type { ProcedureName, ProcInput, ProcOutput } from "@/services/registry";
import type { Transport } from "@/client/transport";
import { HttpTransport } from "@/client/transport";
import { IS_DEMO } from "@/config/env";
import { AppError } from "@/lib/errors";

let transport: Transport | null = null;

export async function getTransport(): Promise<Transport> {
  if (transport) return transport;
  if (IS_DEMO) {
    const { DemoTransport } = await import("@/client/demo-transport");
    transport = new DemoTransport();
  } else {
    transport = new HttpTransport();
  }
  return transport;
}

export async function call<N extends ProcedureName>(name: N, input: ProcInput<N>): Promise<ProcOutput<N>> {
  const t = await getTransport();
  return (await t.call(name, input)) as ProcOutput<N>;
}

export function useQ<N extends ProcedureName>(
  name: N,
  input: ProcInput<N>,
  opts: Omit<UseQueryOptions<ProcOutput<N>, AppError>, "queryKey" | "queryFn"> = {},
) {
  return useQuery<ProcOutput<N>, AppError>({
    queryKey: [name, input],
    queryFn: () => call(name, input),
    ...opts,
  });
}

export function useM<N extends ProcedureName>(name: N, opts: { onSuccess?: (data: ProcOutput<N>, input: ProcInput<N>) => void; onError?: (e: AppError) => void } = {}) {
  const qc = useQueryClient();
  return useMutation<ProcOutput<N>, AppError, ProcInput<N>>({
    mutationFn: (input) => call(name, input),
    onSuccess: async (data, input) => {
      await qc.invalidateQueries();
      opts.onSuccess?.(data, input);
    },
    onError: (e) => opts.onError?.(AppError.from(e)),
  });
}

export function errorMessage(e: unknown): string {
  return AppError.from(e).message;
}
