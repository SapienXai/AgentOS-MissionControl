export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050816] px-6 text-white">
      <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-8 py-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <p className="text-[11px] uppercase tracking-[0.32em] text-slate-500">OpenClaw</p>
        <h1 className="mt-3 font-display text-3xl">Page not found</h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
          The requested AgentOS route does not exist in this workspace.
        </p>
      </div>
    </main>
  );
}
