import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { queryOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import {
  Sparkles,
  Loader2,
  ChevronRight,
  Wand2,
  Type,
  XCircle,
  RotateCcw,
  ListTodo,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { GradientCard } from "@/components/gradient-card";
import { GradientProgress } from "@/components/gradient-progress";
import { SubtitlePreview } from "@/components/subtitle-preview";
import { cancelJob, duplicateJob, getJob, pollJob } from "@/lib/jobs.functions";
import { updateClip, generateMetadata } from "@/lib/clips.functions";
import { SUBTITLE_TEMPLATES, DEFAULT_SUBTITLE_STYLE, type SubtitleTemplate } from "@/types/domain";

export const Route = createFileRoute("/_authenticated/clips/$jobId")({
  head: () => ({ meta: [{ title: "Clip editor — ClipForge AI" }] }),
  component: ClipEditor,
});

function ClipEditor() {
  const { jobId } = useParams({ from: "/_authenticated/clips/$jobId" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getJobFn = useServerFn(getJob);
  const pollFn = useServerFn(pollJob);
  const updateClipFn = useServerFn(updateClip);
  const genMetaFn = useServerFn(generateMetadata);
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
      const s = q.state.data?.job?.status;
      return s && !["done", "failed", "cancelled"].includes(s) ? 2000 : false;
    },
  });
  const q = useQuery(qo);
  const job = q.data?.job;
  const clips = q.data?.clips ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = clips.find((c) => c.id === selectedId) ?? clips[0];

  useEffect(() => {
    if (!selectedId && clips[0]) setSelectedId(clips[0].id);
  }, [clips, selectedId]);

  const mutateClip = useMutation({
    mutationFn: (vars: { clipId: string; patch: Record<string, unknown> }) =>
      updateClipFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", jobId] }),
  });

  const generateMeta = useMutation({
    mutationFn: (clipId: string) => genMetaFn({ data: { clipId } }),
    onSuccess: () => {
      toast.success("Metadata generated");
      qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "AI failed"),
  });

  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { jobId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", jobId] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not cancel job"),
  });
  const duplicate = useMutation({
    mutationFn: () => duplicateFn({ data: { jobId } }),
    onSuccess: (result) => navigate({ to: "/clips/$jobId", params: { jobId: result.jobId } }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not retry job"),
  });

  if (q.isPending) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (q.isError || !job) {
    return (
      <GradientCard>
        <p className="text-sm text-destructive">
          {q.isError ? "Could not load this job." : "Job not found."}
        </p>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => q.refetch()}
            className="rounded-full bg-gradient-brand px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Try again
          </button>
          <Link to="/jobs" className="rounded-full border border-border px-4 py-2 text-xs">
            All jobs
          </Link>
        </div>
      </GradientCard>
    );
  }

  if (job.status === "failed" || job.status === "cancelled") {
    return (
      <div className="space-y-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{job.status}</p>
          <h1 className="font-display text-2xl font-semibold">{job.source_title ?? "Clip job"}</h1>
        </div>
        <GradientCard>
          <XCircle className="text-destructive" />
          <p className="mt-3 font-semibold">
            {job.status === "cancelled"
              ? "This job was cancelled."
              : "Generation could not finish."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {job.error_message ?? "Retry the job or adjust its settings."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => duplicate.mutate()}
              disabled={duplicate.isPending}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-brand px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              <RotateCcw size={14} /> Retry with same settings
            </button>
            <Link to="/create" className="rounded-full border border-border px-4 py-2 text-xs">
              Adjust settings
            </Link>
            <Link
              to="/jobs"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs"
            >
              <ListTodo size={14} /> All jobs
            </Link>
          </div>
        </GradientCard>
      </div>
    );
  }

  const isProcessing = job.status !== "done" && job.status !== "failed";

  if (isProcessing) {
    return (
      <div className="space-y-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Generating</p>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">
            {job.source_title ?? "Your clips"}
          </h1>
        </div>
        <GradientCard glow>
          <p className="text-sm capitalize text-muted-foreground">
            Stage: {job.stage ?? job.status}
          </p>
          <p className="mt-2 font-display text-4xl font-bold text-gradient-brand">
            {job.progress}%
          </p>
          <div className="mt-4">
            <GradientProgress value={job.progress} />
          </div>
          <p className="mt-3 text-sm text-brand-cyan">
            {job.estimated_remaining_s
              ? `About ${Math.max(1, Math.ceil(job.estimated_remaining_s / 60))} min remaining`
              : "Calculating time remaining…"}
          </p>
          <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
            {[
              "Transcribing audio",
              "Detecting highlights",
              "Rendering vertical",
              "Auto subtitles",
            ].map((s) => (
              <li key={s} className="flex items-center gap-2">
                <Sparkles size={12} className="text-brand-purple" /> {s}
              </li>
            ))}
          </ul>
          <button
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending || job.status === "cancel_requested"}
            className="mt-5 rounded-full border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive disabled:opacity-50"
          >
            {job.status === "cancel_requested" ? "Cancelling…" : "Cancel job"}
          </button>
        </GradientCard>
      </div>
    );
  }

  const style =
    (selected?.subtitle_style as Partial<typeof DEFAULT_SUBTITLE_STYLE> | undefined) &&
    Object.keys(selected!.subtitle_style ?? {}).length
      ? { ...DEFAULT_SUBTITLE_STYLE, ...(selected!.subtitle_style as object) }
      : (SUBTITLE_TEMPLATES.find((t) => t.id === (selected?.subtitle_template as SubtitleTemplate))
          ?.style ?? DEFAULT_SUBTITLE_STYLE);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Editor</p>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Your clips</h1>
        </div>
      </div>

      {/* Clip picker */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {clips.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={`shrink-0 overflow-hidden rounded-2xl border-2 transition ${
              selected?.id === c.id ? "border-primary shadow-glow" : "border-transparent"
            }`}
          >
            <img src={c.thumbnail_url ?? ""} alt="" className="h-32 w-20 object-cover" />
          </button>
        ))}
      </div>

      {selected ? (
        <>
          <GradientCard>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <SubtitlePreview style={style} />
            </motion.div>
          </GradientCard>

          {/* Subtitle template */}
          <GradientCard>
            <div className="flex items-center gap-2">
              <Type size={16} className="text-brand-cyan" />
              <p className="text-sm font-semibold">Subtitle template</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              {SUBTITLE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    mutateClip.mutate({
                      clipId: selected.id,
                      patch: { subtitle_template: t.id, subtitle_style: t.style },
                    })
                  }
                  className={`rounded-2xl border p-3 text-left text-xs transition ${
                    selected.subtitle_template === t.id
                      ? "border-transparent bg-gradient-brand text-primary-foreground shadow-glow"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="font-semibold">{t.name}</div>
                  <div
                    className={
                      selected.subtitle_template === t.id ? "opacity-80" : "text-muted-foreground"
                    }
                  >
                    {t.description}
                  </div>
                </button>
              ))}
            </div>
          </GradientCard>

          {/* Metadata */}
          <GradientCard>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Title, description, hashtags</p>
              <button
                onClick={() => generateMeta.mutate(selected.id)}
                disabled={generateMeta.isPending}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-brand px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
              >
                {generateMeta.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Wand2 size={12} />
                )}
                AI generate
              </button>
            </div>
            <div className="mt-3 space-y-3">
              <input
                key={`${selected.id}-title`}
                defaultValue={selected.title ?? ""}
                onBlur={(e) =>
                  e.target.value !== (selected.title ?? "") &&
                  mutateClip.mutate({ clipId: selected.id, patch: { title: e.target.value } })
                }
                placeholder="Clip title"
                className="w-full rounded-2xl border border-input bg-input/30 px-4 py-3 text-sm outline-none focus:border-primary"
              />
              <textarea
                key={`${selected.id}-desc`}
                defaultValue={selected.description ?? ""}
                onBlur={(e) =>
                  e.target.value !== (selected.description ?? "") &&
                  mutateClip.mutate({ clipId: selected.id, patch: { description: e.target.value } })
                }
                rows={3}
                placeholder="Description"
                className="w-full rounded-2xl border border-input bg-input/30 px-4 py-3 text-sm outline-none focus:border-primary"
              />
              <input
                key={`${selected.id}-tags`}
                defaultValue={selected.hashtags?.join(" ") ?? ""}
                onBlur={(e) => {
                  const arr = e.target.value.split(/\s+/).filter(Boolean).slice(0, 15);
                  mutateClip.mutate({ clipId: selected.id, patch: { hashtags: arr } });
                }}
                placeholder="#hashtags separated by space"
                className="w-full rounded-2xl border border-input bg-input/30 px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </GradientCard>

          <Link
            to="/upload/$clipId"
            params={{ clipId: selected.id }}
            className="flex items-center justify-between rounded-2xl bg-gradient-brand px-5 py-4 text-sm font-semibold text-primary-foreground shadow-glow"
          >
            Continue to upload <ChevronRight size={18} />
          </Link>
        </>
      ) : null}
    </div>
  );
}
