import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, RefreshCw, Loader2, ArrowLeft } from "lucide-react";
import { GradientCard } from "@/components/gradient-card";
import { getDiagnostics } from "@/lib/diagnostics.functions";

export const Route = createFileRoute("/_authenticated/diagnostics")({
  head: () => ({ meta: [{ title: "Diagnostics — ClipForge AI" }] }),
  component: DiagnosticsPage,
});

function Row({ label, ok, value }: { label: string; ok: boolean | null; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-2 last:border-none">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2 text-xs">
        {value ? <code className="text-muted-foreground">{value}</code> : null}
        {ok === true ? (
          <CheckCircle2 size={16} className="text-emerald-400" />
        ) : ok === false ? (
          <XCircle size={16} className="text-destructive" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
    </div>
  );
}

function DiagnosticsPage() {
  const qc = useQueryClient();
  const fn = useServerFn(getDiagnostics);
  const q = useQuery({ queryKey: ["diagnostics"], queryFn: () => fn(), refetchOnWindowFocus: false });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Diagnostics</p>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Connection status</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs"
          >
            <ArrowLeft size={12} /> Settings
          </Link>
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["diagnostics"] });
              qc.invalidateQueries({ queryKey: ["yt-connection"] });
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {q.isLoading || !q.data ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <GradientCard>
            <p className="mb-2 font-semibold">Environment</p>
            <Row label="SUPABASE_URL" ok={q.data.env.SUPABASE_URL} />
            <Row label="SUPABASE_PUBLISHABLE_KEY" ok={q.data.env.SUPABASE_PUBLISHABLE_KEY} />
            <Row label="SUPABASE_SERVICE_ROLE_KEY" ok={q.data.env.SUPABASE_SERVICE_ROLE_KEY} />
            <Row
              label="GOOGLE_OAUTH_CLIENT_ID"
              ok={q.data.env.GOOGLE_OAUTH_CLIENT_ID}
              value={q.data.clientIdMasked}
            />
            <Row label="GOOGLE_OAUTH_CLIENT_SECRET" ok={q.data.env.GOOGLE_OAUTH_CLIENT_SECRET} />
            <Row label="YOUTUBE_TOKEN_ENC_KEY" ok={q.data.env.YOUTUBE_TOKEN_ENC_KEY} />
            <Row
              label="CLIPFORGE_BACKEND_URL"
              ok={q.data.env.CLIPFORGE_BACKEND_URL}
              value={q.data.backendUrl}
            />
            <Row label="CLIPFORGE_BACKEND_SECRET" ok={q.data.env.CLIPFORGE_BACKEND_SECRET} />
            <Row label="LOVABLE_API_KEY" ok={q.data.env.LOVABLE_API_KEY} />
            {q.data.simulationMode ? (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Simulation mode active — Google OAuth credentials missing.
              </p>
            ) : (
              <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                All credentials present — real OAuth &amp; upload path enabled.
              </p>
            )}
          </GradientCard>

          <GradientCard>
            <p className="mb-2 font-semibold">Auth user</p>
            <p className="text-xs text-muted-foreground">
              <code>{q.data.userId}</code>
            </p>
          </GradientCard>

          <GradientCard>
            <p className="mb-2 font-semibold">YouTube connection row</p>
            <Row label="Visible via RLS (as user)" ok={Boolean(q.data.connection)} />
            <Row label="Exists in DB (service role)" ok={Boolean(q.data.adminRow)} />
            {q.data.connectionError && (
              <p className="mt-2 text-xs text-destructive">RLS read error: {q.data.connectionError}</p>
            )}
            {q.data.adminError && (
              <p className="mt-2 text-xs text-destructive">Admin read error: {q.data.adminError}</p>
            )}
            {q.data.adminRow && !q.data.connection && (
              <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Row exists but hidden by RLS — user_id mismatch between auth session and stored row.
              </p>
            )}
            {q.data.connection && (
              <pre className="mt-2 overflow-auto rounded-lg bg-secondary/60 p-3 text-[11px] text-muted-foreground">
                {JSON.stringify(q.data.connection, null, 2)}
              </pre>
            )}
          </GradientCard>

          <GradientCard>
            <p className="mb-2 font-semibold">Live YouTube API probe</p>
            {q.data.apiProbe.ok === true ? (
              <>
                <Row label="channels.list(mine=true)" ok value="200 OK" />
                <Row label="Channel ID" ok value={q.data.apiProbe.channelId} />
                <Row label="Channel title" ok value={q.data.apiProbe.channelTitle} />
                <Row label="Access token refreshed" ok={q.data.apiProbe.refreshed} />
              </>
            ) : q.data.apiProbe.ok === false ? (
              <>
                <Row label="channels.list(mine=true)" ok={false} />
                <pre className="mt-2 overflow-auto rounded-lg bg-destructive/10 p-3 text-[11px] text-destructive">
                  {q.data.apiProbe.error}
                </pre>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No connection to probe. Go to{" "}
                <Link to="/settings" className="text-brand-cyan">
                  Settings
                </Link>{" "}
                and click Connect YouTube.
              </p>
            )}
          </GradientCard>
        </>
      )}
    </div>
  );
}
