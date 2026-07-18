import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLIP_DURATIONS } from "@/types/domain";

const StartJobSchema = z.object({
  sourceType: z.enum(["youtube_url", "upload"]),
  sourceUrl: z.string().min(1).max(2048).optional(),
  sourceTitle: z.string().min(1).max(200).optional(),
  clipDuration: z.number().refine((v) => (CLIP_DURATIONS as readonly number[]).includes(v)),
  clipCount: z.number().int().min(1).max(20),
});

export const startJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => StartJobSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        source_type: data.sourceType,
        source_url: data.sourceUrl ?? null,
        source_title: data.sourceTitle ?? "Untitled video",
        clip_duration: data.clipDuration,
        clip_count: data.clipCount,
        status: "queued",
        progress: 0,
        stage: "queued",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Delegate to backend if configured; otherwise mock progression on poll.
    try {
      const { createBackendJob, getBackendConfig } = await import("./backend.server");
      const cfg = getBackendConfig();
      if (cfg.configured) {
        const backend = await createBackendJob({
          sourceUrl: data.sourceUrl,
          clipDuration: data.clipDuration,
          clipCount: data.clipCount,
          userId,
          jobId: job.id,
        });
        if (backend?.backendJobId) {
          await supabase.from("jobs").update({ backend_job_id: backend.backendJobId }).eq("id", job.id);
        }
      }
    } catch (err) {
      console.error("[startJob] backend dispatch failed:", err);
    }

    return { jobId: job.id };
  });

export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { jobs: data ?? [] };
  });

export const getJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ jobId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return { job: null, clips: [] };

    const { data: clips } = await context.supabase
      .from("clips")
      .select("*")
      .eq("job_id", data.jobId)
      .order("order_index", { ascending: true });

    return { job, clips: clips ?? [] };
  });

// Mock stage progression when no backend is configured.
const STAGES = ["queued", "transcribing", "analyzing", "rendering", "done"] as const;

export const pollJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ jobId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job } = await supabase.from("jobs").select("*").eq("id", data.jobId).maybeSingle();
    if (!job || job.status === "done" || job.status === "failed") {
      return { job };
    }

    const { getBackendConfig, fetchBackendJob } = await import("./backend.server");
    const cfg = getBackendConfig();

    if (cfg.configured) {
      if (!job.backend_job_id) {
        await supabase
          .from("jobs")
          .update({ status: "failed", stage: "failed", error_message: "Backend dispatch failed" })
          .eq("id", job.id);
        const { data: updated } = await supabase.from("jobs").select("*").eq("id", job.id).maybeSingle();
        return { job: updated };
      }
      const remote = await fetchBackendJob(job.backend_job_id);
      if (remote) {
        await supabase
          .from("jobs")
          .update({
            status: remote.status,
            progress: remote.progress,
            stage: remote.status,
            error_message: remote.error ?? null,
          })
          .eq("id", job.id);
        if (remote.status === "done" && remote.clips?.length) {
          const { count } = await supabase
            .from("clips")
            .select("id", { count: "exact", head: true })
            .eq("job_id", job.id);
          if (!count) {
            const rows = remote.clips.map((c) => ({
              job_id: job.id,
              user_id: userId,
              video_url: c.video_url,
              thumbnail_url: c.thumbnail_url,
              duration_s: c.duration_s,
              order_index: c.order,
              status: "draft" as const,
              title: `${job.source_title ?? "Clip"} · Highlight ${c.order + 1}`,
              description: c.transcript ?? "",
              subtitle_template: "modern",
              subtitle_style: {},
              hashtags: ["#shorts", "#viral", "#clipforge"],
              tags: ["shorts", "clips"],
            }));
            await supabase.from("clips").insert(rows);
          }
        }
        const { data: updated } = await supabase.from("jobs").select("*").eq("id", job.id).maybeSingle();
        return { job: updated };
      }
      return { job };
    }

    // Mock progression: advance stage every poll
    const elapsedMs = Date.now() - new Date(job.created_at).getTime();
    const stepMs = 2500;
    const stepIndex = Math.min(STAGES.length - 1, Math.floor(elapsedMs / stepMs));
    const nextStage = STAGES[stepIndex];
    const nextProgress = Math.min(100, Math.floor((stepIndex / (STAGES.length - 1)) * 100));

    await supabase
      .from("jobs")
      .update({ status: nextStage, stage: nextStage, progress: nextProgress })
      .eq("id", job.id);

    // On done, create mock clips
    if (nextStage === "done") {
      const { count } = await supabase
        .from("clips")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id);
      if (!count) {
        const now = Date.now();
        const rows = Array.from({ length: job.clip_count }).map((_, i) => ({
          job_id: job.id,
          user_id: userId,
          duration_s: job.clip_duration,
          order_index: i,
          status: "draft" as const,
          title: `${job.source_title ?? "Clip"} · Highlight ${i + 1}`,
          thumbnail_url: `https://picsum.photos/seed/${job.id.slice(0, 6)}-${i}/720/1280`,
          video_url: null,
          subtitle_template: "modern",
          subtitle_style: {},
          hashtags: ["#shorts", "#viral", "#clipforge"],
          tags: ["shorts", "clips"],
          description: "Auto-generated highlight (simulated).",
          created_at: new Date(now + i).toISOString(),
        }));
        await supabase.from("clips").insert(rows);
      }
    }

    const { data: updated } = await supabase.from("jobs").select("*").eq("id", job.id).maybeSingle();
    return { job: updated };
  });
