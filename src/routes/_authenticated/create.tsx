import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { motion } from "framer-motion";
import { Link as LinkIcon, Upload as UploadIcon, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { GradientCard } from "@/components/gradient-card";
import { startJob } from "@/lib/jobs.functions";
import { CLIP_DURATION_MAX, CLIP_DURATION_MIN, CLIP_DURATION_PRESETS } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/create")({
  head: () => ({ meta: [{ title: "New clip — ClipForge AI" }] }),
  component: Create,
});

function Create() {
  const navigate = useNavigate();
  const start = useServerFn(startJob);
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (tab === "url" && !url.trim()) {
      toast.error("Paste a YouTube URL first.");
      return;
    }
    if (tab === "upload") {
      toast.info("Direct upload is coming soon. Generate clips from a YouTube URL for now.");
      return;
    }
    setBusy(true);
    try {
      const res = await start({
        data: {
          sourceType: tab === "url" ? "youtube_url" : "upload",
          sourceUrl: tab === "url" ? url.trim() : undefined,
          sourceTitle: title.trim() || (tab === "url" ? url.trim() : "Uploaded video"),
          clipDuration: duration,
          clipCount: count,
        },
      });
      toast.success("Job queued — generating clips…");
      navigate({ to: "/clips/$jobId", params: { jobId: res.jobId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start job");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Create</p>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">New clip generation</h1>
      </div>

      <GradientCard>
        <div className="flex gap-2 rounded-full bg-secondary p-1">
          <button
            onClick={() => setTab("url")}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
              tab === "url" ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <LinkIcon size={14} className="mr-1 inline" /> YouTube URL
          </button>
          <button
            onClick={() => setTab("upload")}
            disabled
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
              tab === "upload"
                ? "bg-gradient-brand text-primary-foreground"
                : "text-muted-foreground"
            }`}
          >
            <UploadIcon size={14} className="mr-1 inline" /> Upload · Soon
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {tab === "url" ? (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              className="w-full rounded-2xl border border-input bg-input/30 px-4 py-3 text-sm outline-none focus:border-primary"
            />
          ) : (
            <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-border/70 bg-card/30 px-4 py-8 text-center transition hover:bg-card/60">
              <UploadIcon size={22} className="mx-auto text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Tap to select MP4 / MOV</p>
              <p className="text-xs text-muted-foreground">Max 500 MB</p>
              <input type="file" accept="video/mp4,video/quicktime" className="hidden" />
            </label>
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Video title (optional)"
            className="w-full rounded-2xl border border-input bg-input/30 px-4 py-3 text-sm outline-none focus:border-primary"
          />

          <p className="pt-2 text-xs uppercase tracking-wide text-muted-foreground">
            I own or have permission to use this video
          </p>
        </div>
      </GradientCard>

      <GradientCard>
        <p className="text-sm font-medium">Clip duration</p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {CLIP_DURATION_PRESETS.map((d) => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={`rounded-2xl border py-3 text-sm font-semibold transition ${
                duration === d
                  ? "border-transparent bg-gradient-brand text-primary-foreground shadow-glow"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}s
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-4">
          <input
            aria-label="Clip duration in seconds"
            type="range"
            min={CLIP_DURATION_MIN}
            max={CLIP_DURATION_MAX}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="min-w-0 flex-1 accent-[oklch(0.68_0.22_295)]"
          />
          <label className="flex items-center gap-1 rounded-xl border border-input bg-input/30 px-2 py-1.5 text-sm">
            <input
              aria-label="Custom clip duration"
              type="number"
              min={CLIP_DURATION_MIN}
              max={CLIP_DURATION_MAX}
              value={duration}
              onChange={(e) =>
                setDuration(
                  Math.min(
                    CLIP_DURATION_MAX,
                    Math.max(CLIP_DURATION_MIN, Number(e.target.value) || CLIP_DURATION_MIN),
                  ),
                )
              }
              className="w-12 bg-transparent text-right font-semibold outline-none"
            />
            <span className="text-muted-foreground">sec</span>
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Choose any duration from 5 seconds to 3 minutes.
        </p>

        <p className="mt-6 text-sm font-medium">Number of clips</p>
        <div className="mt-3 flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={12}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="flex-1 accent-[oklch(0.68_0.22_295)]"
          />
          <div className="w-10 text-right font-display text-xl font-semibold text-gradient-brand">
            {count}
          </div>
        </div>
      </GradientCard>

      <motion.button
        whileTap={{ scale: 0.98 }}
        disabled={busy}
        onClick={submit}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-4 py-4 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
        {busy ? "Starting…" : "Generate clips"}
      </motion.button>
    </div>
  );
}
