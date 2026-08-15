import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Loader2, Play, RotateCcw, SlidersHorizontal, Sparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { GradientProgress } from "@/components/gradient-progress";
import { cancelJob, exportMoment, getJob, getPreferences, retryJob, saveUrl } from "@/lib/clipforge-client";

export const Route = createFileRoute("/_authenticated/clips/$jobId")({ head: () => ({ meta: [{ title: "Review moments — ClipForge" }] }), component: ClipReview });
type ScoreKey = "hook" | "context" | "emotion" | "value" | "pacing" | "visual" | "prompt";
const SCORE_KEYS: Array<[ScoreKey, string]> = [["hook","Hook"],["context","Context"],["emotion","Emotion"],["value","Value"],["pacing","Pacing"],["visual","Visual"],["prompt","Prompt"]];

function ClipReview() {
  const { jobId } = useParams({ from: "/_authenticated/clips/$jobId" });
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["clipforge-job", jobId], queryFn: () => getJob(jobId), refetchInterval: (state) => { const s = state.state.data?.status; return s && !["done","failed","cancelled"].includes(s) ? 2000 : false; } });
  const job = q.data;
  const ranked = useMemo(() => [...(job?.clips ?? [])].sort((a,b) => b.score - a.score), [job?.clips]);
  const [selected, setSelected] = useState<Set<number>>(new Set()), [previewOrder, setPreviewOrder] = useState<number | null>(null), [exporting, setExporting] = useState(false);
  const preview = ranked.find((clip) => clip.order === previewOrder) ?? ranked[0];
  useEffect(() => { if (previewOrder === null && ranked[0]) setPreviewOrder(ranked[0].order); }, [previewOrder, ranked]);
  const retry = useMutation({ mutationFn: () => retryJob(jobId), onSuccess: () => { toast.success("Analysis restarted"); qc.invalidateQueries({ queryKey: ["clipforge-job", jobId] }); }, onError: (e) => toast.error(e instanceof Error ? e.message : "Could not retry") });
  const cancel = useMutation({ mutationFn: () => cancelJob(jobId), onSuccess: () => qc.invalidateQueries({ queryKey: ["clipforge-job", jobId] }) });
  const toggle = (order: number) => setSelected((current) => { const next = new Set(current); next.has(order) ? next.delete(order) : next.add(order); return next; });
  async function quickExport() {
    const chosen = ranked.filter((clip) => selected.has(clip.order)); if (!chosen.length) return;
    setExporting(true); const prefs = getPreferences(); let completed = 0;
    try { for (const clip of chosen) { const result = await exportMoment(jobId, { clipOrder: clip.order, ...prefs }); saveUrl(result.url, `ClipForge-Moment-${clip.order + 1}.mp4`); completed++; } toast.success(`Exported ${completed} moment${completed === 1 ? "" : "s"}`); }
    catch (e) { toast.error(`${completed ? `${completed} exported. ` : ""}${e instanceof Error ? e.message : "Export failed"}`); }
    finally { setExporting(false); }
  }

  if (q.isPending) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  if (q.isError || !job) return <GradientCard><p className="text-sm text-destructive">Could not load this project.</p></GradientCard>;
  if (["failed","cancelled"].includes(job.status)) return <div className="mx-auto max-w-2xl"><GradientCard><XCircle className="text-destructive" /><h1 className="mt-3 font-display text-xl font-semibold">{job.status === "cancelled" ? "Analysis cancelled" : "Analysis failed"}</h1><p className="mt-2 text-sm text-muted-foreground">{job.error || "Try the same video again."}</p><div className="mt-5 flex gap-2"><button onClick={() => retry.mutate()} disabled={retry.isPending} className="inline-flex items-center gap-2 rounded-full bg-gradient-brand px-4 py-2 text-xs font-semibold text-primary-foreground"><RotateCcw size={14} /> Retry</button><Link to="/create" className="rounded-full border border-border px-4 py-2 text-xs">New video</Link></div></GradientCard></div>;
  if (job.status !== "done") {
    const labels: Record<string,string> = { queued:"Queued", downloading:"Getting video", transcribing:"Understanding speech", analyzing:"Ranking moments", rendering:"Preparing previews", cancel_requested:"Cancelling" };
    return <div className="mx-auto max-w-2xl space-y-5"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Analyzing</p><h1 className="font-display text-2xl font-semibold">Finding the strongest moments</h1></div><GradientCard glow><div className="flex items-end justify-between"><p className="text-sm text-muted-foreground">{labels[job.status] || job.status}</p><p className="font-display text-3xl font-bold text-gradient-brand">{job.progress}%</p></div><div className="mt-4"><GradientProgress value={job.progress} /></div><p className="mt-4 text-xs text-muted-foreground">{job.estimatedRemainingS ? `About ${Math.max(1, Math.ceil(job.estimatedRemainingS / 60))} min remaining` : "Progress updates automatically."}</p><button onClick={() => cancel.mutate()} className="mt-5 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">Cancel</button></GradientCard></div>;
  }

  return <div className="mx-auto max-w-4xl space-y-5">
    <div className="flex items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Review</p><h1 className="font-display text-2xl font-semibold md:text-3xl">Best moments</h1><p className="mt-1 text-sm text-muted-foreground">Ranked by hook, context, emotion, value, pacing, visual changes, and your prompt.</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{ranked.length} candidates</span></div>
    {preview?.video_url ? <GradientCard glow><div className="mx-auto max-w-[340px] overflow-hidden rounded-2xl bg-black"><video key={preview.order} src={preview.video_url} poster={preview.thumbnail_url} controls playsInline preload="metadata" className="aspect-[9/16] w-full object-contain" /></div></GradientCard> : null}
    <div className="space-y-3">{ranked.map((clip,index) => { const active = selected.has(clip.order); return <GradientCard key={clip.order} className={active ? "ring-2 ring-primary/70" : ""}><div className="flex gap-3"><button onClick={() => setPreviewOrder(clip.order)} className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-secondary">{clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="size-full object-cover" /> : null}<span className="absolute inset-0 grid place-items-center bg-black/20"><Play size={20} fill="currentColor" /></span></button><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><div><p className="text-xs text-muted-foreground">#{index + 1} · {clip.duration_s}s</p><p className="mt-1 text-sm font-semibold capitalize">{clip.reason}</p></div><div className="rounded-xl bg-primary/10 px-2.5 py-1 text-center"><div className="text-lg font-bold text-brand-cyan">{clip.score}</div><div className="text-[9px] uppercase text-muted-foreground">score</div></div></div><div className="mt-2 grid grid-cols-4 gap-1">{SCORE_KEYS.map(([key,label]) => <div key={key} className="rounded-lg bg-secondary/70 px-1.5 py-1 text-center"><div className="text-[10px] font-semibold">{clip.score_breakdown?.[key] ?? 0}</div><div className="text-[8px] text-muted-foreground">{label}</div></div>)}</div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => toggle(clip.order)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${active ? "bg-gradient-brand text-primary-foreground" : "border border-border"}`}><Check size={12} /> {active ? "Selected" : "Select"}</button><Link to="/editor/$jobId/$clipOrder" params={{ jobId, clipOrder: String(clip.order) }} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs"><SlidersHorizontal size={12} /> Edit</Link></div></div></div></GradientCard>; })}</div>
    {selected.size ? <div className="sticky bottom-[88px] z-30 rounded-2xl border border-border/70 bg-[#0b1328]/95 p-3 shadow-2xl backdrop-blur"><button onClick={quickExport} disabled={exporting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-brand px-4 py-3 text-sm font-semibold text-primary-foreground">{exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export {selected.size} selected</button></div> : null}
  </div>;
}
