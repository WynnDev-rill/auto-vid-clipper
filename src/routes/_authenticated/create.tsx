import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, FileVideo2, Link as LinkIcon, Loader2, Sparkles, Upload as UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { createJob, uploadVideo } from "@/lib/clipforge-client";

export const Route = createFileRoute("/_authenticated/create")({ head: () => ({ meta: [{ title: "Create — ClipForge" }] }), component: Create });
const MAX_BYTES = 600 * 1024 * 1024;
const ACCEPTED = ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"];
const QUICK_GOALS = [["Auto", ""], ["Funny", "funniest moments and reactions"], ["Insight", "strongest insight or useful explanation"], ["Emotion", "most emotional or surprising moments"], ["Hook", "strongest hook and payoff for short-form video"]] as const;

function Create() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"url" | "upload">("url"), [url, setUrl] = useState(""), [file, setFile] = useState<File | null>(null), [goal, setGoal] = useState("");
  const [candidateCount, setCandidateCount] = useState(10), [targetDuration, setTargetDuration] = useState(35), [showOptions, setShowOptions] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [uploadProgress, setUploadProgress] = useState(0);
  async function submit() {
    if (tab === "url" && !url.trim()) return toast.error("Paste a video URL first.");
    if (tab === "upload" && !file) return toast.error("Choose a video first.");
    if (file && file.size > MAX_BYTES) return toast.error("Video must be 600 MB or smaller.");
    if (file && file.type && !ACCEPTED.includes(file.type)) return toast.error("Use MP4, MOV, MKV, or WebM.");
    setBusy(true); setUploadProgress(0);
    try {
      let uploadId: string | undefined;
      if (tab === "upload" && file) { setStatus("Uploading video…"); uploadId = (await uploadVideo(file, setUploadProgress)).id; }
      setStatus("Starting analysis…");
      const result = await createJob({ sourceUrl: tab === "url" ? url.trim() : undefined, uploadId, sourceTitle: tab === "url" ? url.trim() : file?.name, clipDuration: targetDuration, clipCount: candidateCount, goal: goal.trim() || undefined });
      navigate({ to: "/clips/$jobId", params: { jobId: result.id } });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not start analysis"); }
    finally { setBusy(false); setStatus(""); }
  }
  return <div className="mx-auto max-w-2xl space-y-5">
    <div className="pt-1 text-center"><div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-gradient-brand shadow-glow"><Sparkles size={21} className="text-primary-foreground" /></div><h1 className="font-display text-2xl font-semibold md:text-3xl">Find the best moments</h1><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Paste a link or upload a video. ClipForge analyzes speech, pacing and scene changes, ranks the strongest sections, then gives you previews to choose from.</p></div>
    <GradientCard glow>
      <div className="flex gap-2 rounded-full bg-secondary p-1"><button onClick={() => setTab("url")} className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${tab === "url" ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground"}`}><LinkIcon size={14} className="mr-1 inline" /> URL</button><button onClick={() => setTab("upload")} className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${tab === "upload" ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground"}`}><UploadIcon size={14} className="mr-1 inline" /> Upload</button></div>
      <div className="mt-5 space-y-3">
        {tab === "url" ? <div className="relative"><LinkIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube, TikTok, Twitch, Vimeo, or direct video URL" inputMode="url" className="w-full rounded-2xl border border-input bg-input/30 py-3.5 pl-11 pr-4 text-sm outline-none focus:border-primary" /></div> : <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-border/70 bg-card/30 px-4 py-8 text-center"><FileVideo2 size={26} className="mx-auto text-muted-foreground" /><p className="mt-2 break-all text-sm font-medium">{file ? file.name : "Choose a video"}</p><p className="text-xs text-muted-foreground">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "MP4 · MOV · MKV · WebM · max 600 MB"}</p><input type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
        <div><p className="mb-2 text-xs font-medium text-muted-foreground">What should ClipForge prioritize?</p><div className="flex flex-wrap gap-1.5">{QUICK_GOALS.map(([label, value]) => <button key={label} onClick={() => setGoal(value)} className={`rounded-full border px-3 py-1.5 text-xs ${goal === value ? "border-primary/70 bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>{label}</button>)}</div></div>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} maxLength={300} placeholder="Optional: e.g. moments where he explains why the strategy failed" className="w-full resize-none rounded-2xl border border-input bg-input/30 px-4 py-3 text-sm outline-none focus:border-primary" />
      </div>
    </GradientCard>
    <GradientCard className="p-0"><button onClick={() => setShowOptions((v) => !v)} className="flex w-full items-center justify-between px-5 py-4 text-left"><div><p className="text-sm font-semibold">Analysis options</p><p className="text-xs text-muted-foreground">Defaults work for most videos</p></div><ChevronDown size={18} className={showOptions ? "rotate-180" : ""} /></button>{showOptions ? <div className="space-y-5 border-t border-border/60 px-5 py-4"><label className="block"><div className="mb-2 flex justify-between text-sm"><span>Target moment length</span><span className="font-semibold">~{targetDuration}s</span></div><input type="range" min={15} max={90} step={5} value={targetDuration} onChange={(e) => setTargetDuration(Number(e.target.value))} className="w-full accent-[oklch(0.68_0.22_295)]" /></label><label className="block"><div className="mb-2 flex justify-between text-sm"><span>Candidate moments</span><span className="font-semibold">{candidateCount}</span></div><input type="range" min={5} max={15} value={candidateCount} onChange={(e) => setCandidateCount(Number(e.target.value))} className="w-full accent-[oklch(0.68_0.22_295)]" /></label></div> : null}</GradientCard>
    {busy && tab === "upload" && uploadProgress > 0 ? <div className="rounded-2xl border border-border bg-card/70 px-4 py-3"><div className="flex justify-between text-xs"><span>{status}</span><span>{uploadProgress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-gradient-brand" style={{ width: `${uploadProgress}%` }} /></div></div> : null}
    <motion.button whileTap={{ scale: 0.985 }} disabled={busy} onClick={submit} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-4 py-4 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60">{busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}{busy ? status || "Working…" : "Analyze video"}</motion.button>
    <p className="px-3 text-center text-[11px] text-muted-foreground">No login and no API key setup. Only process videos you are allowed to use.</p>
  </div>;
}
