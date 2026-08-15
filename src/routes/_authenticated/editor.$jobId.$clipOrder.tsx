import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { exportMoment, getJob, getPreferences, saveUrl, type ExportOptions } from "@/lib/clipforge-client";

export const Route = createFileRoute("/_authenticated/editor/$jobId/$clipOrder")({ head: () => ({ meta: [{ title: "Edit moment — ClipForge" }] }), component: Editor });
function Editor() {
  const { jobId, clipOrder } = useParams({ from: "/_authenticated/editor/$jobId/$clipOrder" });
  const order = Number(clipOrder);
  const query = useQuery({ queryKey: ["clipforge-job", jobId], queryFn: () => getJob(jobId) });
  const [options, setOptions] = useState<ExportOptions>({ clipOrder: order, trimStart: 0, trimEnd: 0, ...getPreferences() });
  const job = query.data, clip = job?.clips.find((item) => item.order === order);
  const render = useMutation({ mutationFn: () => exportMoment(jobId, options), onSuccess: (result) => { saveUrl(result.url, `ClipForge-Moment-${order + 1}.mp4`); toast.success("Final video rendered and download started"); }, onError: (e) => toast.error(e instanceof Error ? e.message : "Could not export video") });
  if (query.isPending) return <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  if (!job || !clip) return <GradientCard><p className="text-sm text-destructive">Moment not found.</p></GradientCard>;
  return <div className="mx-auto max-w-3xl space-y-5">
    <div className="flex items-center gap-3"><Link to="/clips/$jobId" params={{ jobId }} className="grid size-10 place-items-center rounded-xl border border-border"><ArrowLeft size={17} /></Link><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Moment {order + 1}</p><h1 className="font-display text-2xl font-semibold">Edit & export</h1></div></div>
    <div className="grid gap-5 md:grid-cols-[320px_1fr]">
      <GradientCard glow className="h-fit"><div className="mx-auto overflow-hidden rounded-2xl bg-black"><video src={clip.video_url} poster={clip.thumbnail_url} controls playsInline className="aspect-[9/16] w-full object-contain" /></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">Moment score</span><span className="font-semibold text-brand-cyan">{clip.score}/100</span></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{clip.reason}</p></GradientCard>
      <div className="space-y-4">
        <GradientCard><h2 className="font-display font-semibold">Format</h2><div className="mt-3 grid grid-cols-3 gap-2">{(["9:16","1:1","16:9"] as const).map((ratio) => <button key={ratio} onClick={() => setOptions((c) => ({ ...c, aspectRatio: ratio }))} className={`rounded-xl border px-2 py-3 text-sm ${options.aspectRatio === ratio ? "border-primary bg-primary/10" : "border-border"}`}>{ratio}</button>)}</div></GradientCard>
        <GradientCard><h2 className="font-display font-semibold">Trim</h2><p className="mt-1 text-xs text-muted-foreground">Fine-tune up to 5 seconds around detected boundaries.</p>{(["trimStart","trimEnd"] as const).map((key) => <label key={key} className="mt-4 block"><div className="mb-2 flex justify-between text-xs"><span>{key === "trimStart" ? "Start" : "End"} adjustment</span><span>{Number(options[key] || 0) > 0 ? "+" : ""}{options[key] || 0}s</span></div><input type="range" min={-5} max={5} step={0.5} value={options[key] || 0} onChange={(e) => setOptions((c) => ({ ...c, [key]: Number(e.target.value) }))} className="w-full accent-[oklch(0.68_0.22_295)]" /></label>)}</GradientCard>
        <GradientCard><h2 className="font-display font-semibold">Captions & framing</h2><label className="mt-3 block"><span className="mb-1.5 block text-xs text-muted-foreground">Caption style</span><select disabled={!options.captions} value={options.captionStyle} onChange={(e) => setOptions((c) => ({ ...c, captionStyle: e.target.value as ExportOptions["captionStyle"] }))} className="w-full rounded-xl border border-input bg-input/30 px-3 py-2.5 text-sm disabled:opacity-40"><option value="modern">Modern</option><option value="bold">Bold</option><option value="minimal">Minimal</option></select></label><label className="mt-3 block"><span className="mb-1.5 block text-xs text-muted-foreground">Framing</span><select value={options.cropMode} onChange={(e) => setOptions((c) => ({ ...c, cropMode: e.target.value as ExportOptions["cropMode"] }))} className="w-full rounded-xl border border-input bg-input/30 px-3 py-2.5 text-sm"><option value="safe">Safe · full subject visible</option><option value="fill">Fill · crop to output frame</option></select></label><div className="mt-4 space-y-2"><Toggle label="Burn captions into video" value={options.captions} onChange={(value) => setOptions((c) => ({ ...c, captions: value }))} /><Toggle label="Normalize loudness" value={options.normalizeAudio} onChange={(value) => setOptions((c) => ({ ...c, normalizeAudio: value }))} /></div></GradientCard>
        <button onClick={() => render.mutate()} disabled={render.isPending} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-4 py-4 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60">{render.isPending ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}{render.isPending ? "Rendering final video…" : "Render & download"}</button>
        <button onClick={() => saveUrl(clip.video_url, `ClipForge-Preview-${order + 1}.mp4`)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm"><Download size={15} /> Download preview only</button>
      </div>
    </div>
  </div>;
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <button onClick={() => onChange(!value)} className="flex w-full items-center justify-between rounded-xl border border-border bg-card/40 px-3 py-2.5 text-sm"><span>{label}</span><span className={`h-6 w-11 rounded-full p-1 ${value ? "bg-primary" : "bg-secondary"}`}><span className={`block size-4 rounded-full bg-white transition ${value ? "translate-x-5" : ""}`} /></span></button>; }
