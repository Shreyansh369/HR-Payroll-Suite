import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">404</p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-1.5 text-[13px] text-ink-2">The link may be out of date, or the record was removed.</p>
        <div className="mt-5 flex justify-center gap-4 text-[13px] font-medium">
          <Link href="/app" className="text-accent hover:underline">Go to the workspace</Link>
          <Link href="/" className="text-ink-2 hover:text-ink">Home</Link>
        </div>
      </div>
    </main>
  );
}
