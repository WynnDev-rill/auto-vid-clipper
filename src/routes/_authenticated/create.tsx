import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Link as LinkIcon, Loader2, Sparkles, Upload as UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { startJob } from "@/lib/jobs.functions";
import {
  MAX_SOURCE_VIDEO_BYTES,
  prepareSourceUpload,
  SOURCE_VIDEOS_BUCKET,
  SOURCE_VIDEO_TYPES,
} from "@/lib/source-uploads.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/create")({
  head: () => ({ meta: [{ title: "Create — ClipForge" }] }),
  component: Create,
});

function Create() {
  const navigate = useNavigate();
  const start = useServerFn(startJob);
  const prepareUpload = useServerFn(prepareSourceUpload);
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [candidateCount, setCandidateCount] = useState(10);
  const [targetDuration, setTargetDuration] = useState(35);
  const [showOptions, setShowOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");

  async function submit() {
    if (tab === "url" && !url.trim()) {
      toast.error("Paste a video URL first.");
      return;
    }
    if (tab === "upload") {
      if (!file) {
        toast.error("Select an MP4 or MOV video first.");
        return;
      }
      if (file.size > MAX_SOURCE_VIDEO_BYTES) {
        toast.error("The video must be 500 MB or smaller.");
        return;
      }
      if (!SOURCE_VIDEO_TYPES.includes(file.type as (typeof SOURCE_VIDEO_TYPES)[number])) {
        toast.error("Only MP4 and MOV videos are supported.");
        return;
      }
    }

    setBusy(true);
    try {
      let sourceUploadPath: string | undefined;
      if (tab === "upload" && file) {
        setStatus("Preparing upload…");
        const prepared = await prepareUpload({
          data: {
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type as "video/mp4" | "video/quicktime",
          },
        });
        setStatus("Uploading video…");
        const { error } = await supabase.storage
          .from(SOURCE_VIDEOS_BUCKET)
          .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
        if (error) throw new Error(`Video upload failed: ${error.message}`);
        sourceUploadPath = prepared.path;
      }

      setStatus("Starting analysis…");
      const res = await start({
        data: {
          sourceType: tab === "url" ? "youtube_url" : "upload",
          sourceUrl: tab === "url" ? url.trim() : undefined,
          sourceUploadPath,
          sourceTitle: tab === "url" ? url.trim() : file?.name || "Uploaded video",
          clipDuration: targetDuration,
          clipCount: candidateCount,
          goal: goal.trim() || undefined,
        },
      });
      navigate({ to: "/clips/$jobId", params: { jobId: res.jobId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not analyze this video");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="pt-2 text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-gradient-brand shadow-glow">
          <Sparkles size={21} className="text-primary-foreground" />
        </div>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Find the best moments</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          Add a video. ClipForge analyzes it, ranks the strongest moments, then you choose what to keep.
        </p>
      </div>

      <GradientCard glow>
        <div className="flex gap-2 rounded-full bg-secondary p-1">
          <button
            onClick={() => setTab("url")}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${tab === "url" ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground"}`}
          >
            <LinkIcon size={14} className="mr-1 inline" /> URL
          </button>
          <button
            onClick={() => setTab("upload")}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${tab === "upload" ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground"}`}
          >
            <UploadIcon size={14} className="mr-1 inline" /> Upload
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {tab === "url" ? (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="YouTube or direct video URL"
              inputMode="url"
              className="w-full rounded-2xl border border-input bg-input/30 px-4 py-3.5 text-sm outline-none focus:border-primary"
            />
          ) : (
            <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-border/70 bg-card/30 px-4 py-9 text-center transition hover:bg-card/60">
              <UploadIcon size={24} className="mx-auto text-muted-foreground" />
              <p className="mt-2 break-all text-sm font-medium">{file ? file.name : "Choose MP4 / MOV"}</p>
              <p className="text-xs text-muted-foreground">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "Max 500 MB"}</p>
              <input
                type="file"
                accept="video/mp4,video/quicktime,.mp4,.mov"
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
          )}

          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            maxLength={240}
            placeholder="Optional: what should ClipForge look for? e.g. funniest moments, strongest argument, emotional reactions"
            className="w-full resize-none rounded-2xl border border-input bg-input/30 px-4 py-3 text-sm outline-none focus:border-primary"
          />
        </div>
      </GradientCard>

      <GradientCard className="p-0">
        <button
          onClick={() => setShowOptions((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div>
            <p className="text-sm font-semibold">Options</p>
            <p className="text-xs text-muted-foreground">Auto defaults work for most videos</p>
          </div>
          <ChevronDown size={18} className={`transition ${showOptions ? "rotate-180" : ""}`} />
        </button>
        {showOptions ? (
          <div className="space-y-5 border-t border-border/60 px-5 py-4">
            <label className="block">
              <div className="mb-2 flex justify-between text-sm">
                <span>Target moment length</span><span className="font-semibold">~{targetDuration}s</span>
              </div>
              <input type="range" min={15} max={90} step={5} value={targetDuration} onChange={(e) => setTargetDuration(Number(e.target.value))} className="w-full accent-[oklch(0.68_0.22_295)]" />
            </label>
            <label className="block">
              <div className="mb-2 flex justify-between text-sm">
                <span>Candidates to return</span><span className="font-semibold">{candidateCount}</span>
              </div>
              <input type="range" min={5} max={15} value={candidateCount} onChange={(e) => setCandidateCount(Number(e.target.value))} className="w-full accent-[oklch(0.68_0.22_295)]" />
            </label>
          </div>
        ) : null}
      </GradientCard>

      <motion.button
        whileTap={{ scale: 0.985 }}
        disabled={busy}
        onClick={submit}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-4 py-4 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
        {busy ? status || "Analyzing…" : "Analyze video"}
      </motion.button>

      <p className="px-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        Only use videos you own or have permission to process.
      </p>
    </div>
  );
}
