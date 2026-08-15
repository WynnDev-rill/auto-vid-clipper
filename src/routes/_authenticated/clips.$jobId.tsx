import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Download, Loader2, Play, RotateCcw, Sparkles, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { GradientCard } from "@/components/gradient-card";
import { GradientProgress } from "@/components/gradient-progress";
import { cancelJob, duplicateJob, getJob, pollJob } from "@/lib/jobs.functions";

export const Route = createFileRoute("/_authenticated/clips/$jobId")({
  head: () => ({ meta: [{ title: "Review moments — ClipForge" }] }),
  component: ClipReview,
});

function momentScore(tags: string[] | null | undefined) {
  const raw = tags?.find((tag) => tag.startsWith("moment-score:"));
  const value = Number(raw?.split(":")[1]);
  return Number.isFinite(value) ? value : 0;
}

function signalTags(tags: string[] | null | undefined) {
  return (tags ?? []).filter((tag) => !tag.startsWith("moment-score:")).slice(0, 4);
}

function saveUrl(url: string, name: string) {
  const native = (window as unknown as { ClipForgeNative?: { downloadFile?: (url: string, name: string) => void } }).ClipForgeNative;
  if (native?.downloadFile) {
    native.downloadFile(url, name);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function ClipReview() {
  const { jobId } = useParams({ from: "/_authenticated/clips/$jobId" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getJobFn = useServerFn(getJob);
  const pollFn = useServerFn(pollJob);
  const cancelFn = useServerFn(cancelJob);
  const duplicateFn = useServerFn(duplicateJob);

  const qo = queryOptions({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const snapshot = await getJobFn({ data: { jobId } });
      if (snapshot.job && !["done", "failed", "cancelled"].includes(snapshot.job.status)) {
        await pollFn({ data: { jobId } });
        return getJobFn({ data: { jobId } });
      }
      return snapshot;
    },
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status && !["done", "failed", "cancelled"].includes(status) ? 2000 : false;
    },
  });
  const q = useQuery(qo);
  const job = q.data?.job;
  const clips = q.data?.clips ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);

  const ranked = useMemo(
    () => [...clips].sort((a, b) => momentScore(b.tags) - momentScore(a.tags)),
    [clips],
  );
  const preview = ranked.find((clip) => clip.id === previewId) ?? ranked[0];

  useEffect(() => {
    if (!previewId && ranked[0]) setPreviewId(ranked[0].id);
  }, [previewId, ranked]);

  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { jobId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", jobId] }),
  });
  const duplicate = useMutation({
    mutationFn: () => duplicateFn({ data: { jobId } }),
    onSuccess: (result) => navigate({ to: "/clips/$jobId", params: { jobId: result.jobId } }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not retry"),
  });

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function downloadSelected() {
    const chosen = ranked.filter((clip) => selected.has(clip.id) && clip.video_url);
    if (!chosen.length) return;
    chosen.forEach((clip, index) => {
      window.setTimeout(() => saveUrl(clip.video_url!, `ClipForge-Moment-${index + 1}.mp4`), index * 250);
    });
    toast.success(`Downloading ${chosen.length} selected moment${chosen.length > 1 ? "s" : ""}`);
  }

  if (q.isPending) {
    return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  }

  if (q.isError || !job) {
    return <GradientCard><p className="text-sm text-destructive">Could not load this project.</p></GradientCard>;
  }

  if (job.status === "failed" || job.status === "cancelled") {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <GradientCard>
          <XCircle className="text-destructive" />
          <h1 className="mt-3 font-display text-xl font-semibold">{job.status === "cancelled" ? "Analysis cancelled" : "Analysis failed"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{job.error_message ?? "Try again with the same video."}</p>
          <div className="mt-5 flex gap-2">
            <button onClick={() => duplicate.mutate()} disabled={duplicate.isPending} className="inline-flex items-center gap-2 rounded-full bg-gradient-brand px-4 py-2 text-xs font-semibold text-primary-foreground">
              <RotateCcw size={14} /> Retry
            </button>
            <Link to="/create" className="rounded-full border border-border px-4 py-2 text-xs">New video</Link>
          </div>
        </GradientCard>
      </div>
    );
  }

  if (job.status !== "done") {
    const stages = [
      ["transcribing", "Understanding speech"],
      ["analyzing", "Ranking moments"],
      ["rendering", "Preparing previews"],
    ];
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Analyzing</p>
          <h1 className="font-display text-2xl font-semibold">Finding the strongest moments</h1>
        </div>
        <GradientCard glow>
          <div className="flex items-end justify-between gap-4">
            <p className="text-sm capitalize text-muted-foreground">{job.stage ?? job.status}</p>
            <p className="font-display text-3xl font-bold text-gradient-brand">{job.progress}%</p>
          </div>
          <div className="mt-4"><GradientProgress value={job.progress} /></div>
          <div className="mt-5 space-y-2">
            {stages.map(([key, label]) => (
              <div key={key} className={`flex items-center gap-2 text-sm ${job.status === key ? "text-foreground" : "text-muted-foreground"}`}>
                <Sparkles size={13} className={job.status === key ? "text-brand-purple" : ""} /> {label}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {job.estimated_remaining_s ? `About ${Math.max(1, Math.ceil(job.estimated_remaining_s / 60))} min remaining` : "Time remaining will appear once preview rendering starts."}
          </p>
          <button onClick={() => cancel.mutate()} disabled={cancel.isPending || job.status === "cancel_requested"} className="mt-5 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive disabled:opacity-50">
            {job.status === "cancel_requested" ? "Cancelling…" : "Cancel"}
          </button>
        </GradientCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Review</p>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Best moments</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ranked by hook, context, emotion, information value and pacing.</p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{ranked.length} candidates</span>
      </div>

      {preview?.video_url ? (
        <GradientCard glow>
          <div className="mx-auto max-w-[340px] overflow-hidden rounded-2xl bg-black">
            <video key={preview.id} src={preview.video_url} poster={preview.thumbnail_url ?? undefined} controls playsInline preload="metadata" className="aspect-[9/16] w-full object-contain" />
          </div>
        </GradientCard>
      ) : null}

      <div className="space-y-3">
        {ranked.map((clip, index) => {
          const score = momentScore(clip.tags);
          const isSelected = selected.has(clip.id);
          const signals = signalTags(clip.tags);
          return (
            <GradientCard key={clip.id} className={isSelected ? "ring-2 ring-primary/70" : ""}>
              <div className="flex gap-3">
                <button onClick={() => setPreviewId(clip.id)} className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-secondary">
                  {clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="size-full object-cover" /> : null}
                  <span className="absolute inset-0 grid place-items-center bg-black/20"><Play size={20} fill="currentColor" /></span>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">#{index + 1} · {clip.duration_s ?? 0}s</p>
                      <p className="mt-1 text-sm font-semibold">{clip.thumbnail_text || "Strong candidate moment"}</p>
                    </div>
                    <div className="rounded-xl bg-primary/10 px-2.5 py-1 text-center">
                      <div className="text-lg font-bold text-brand-cyan">{score}</div>
                      <div className="text-[9px] uppercase text-muted-foreground">score</div>
                    </div>
                  </div>
                  {signals.length ? <div className="mt-2 flex flex-wrap gap-1">{signals.map((signal) => <span key={signal} className="rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{signal.replaceAll("-", " ")}</span>)}</div> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => toggle(clip.id)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${isSelected ? "bg-gradient-brand text-primary-foreground" : "border border-border"}`}>
                      <Check size={12} /> {isSelected ? "Selected" : "Select"}
                    </button>
                    {clip.video_url ? <button onClick={() => saveUrl(clip.video_url!, `ClipForge-Moment-${index + 1}.mp4`)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs"><Download size={12} /> Download</button> : null}
                    <Link to="/upload/$clipId" params={{ clipId: clip.id }} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs"><Upload size={12} /> Publish</Link>
                  </div>
                </div>
              </div>
            </GradientCard>
          );
        })}
      </div>

      {selected.size ? (
        <div className="sticky bottom-[88px] z-30 rounded-2xl border border-border/70 bg-[#0b1328]/95 p-3 shadow-2xl backdrop-blur md:bottom-4">
          <button onClick={downloadSelected} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow">
            <Download size={16} /> Download {selected.size} selected
          </button>
        </div>
      ) : null}
    </div>
  );
}
