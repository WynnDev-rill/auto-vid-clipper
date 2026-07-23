import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const StartJobSchema = z
  .object({
    sourceType: z.enum(["youtube_url", "upload"]),
    sourceUrl: z.string().min(1).max(2048).optional(),
    sourceTitle: z.string().min(1).max(200).optional(),
    clipDuration: z.number().int().min(5).max(180),
    clipCount: z.number().int().min(1).max(20),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === "youtube_url") {
      if (!value.sourceUrl) {
        ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "YouTube URL is required" });
        return;
      }
      try {
        const url = new URL(value.sourceUrl);
        if (
          url.hostname !== "youtu.be" &&
          url.hostname !== "youtube.com" &&
          !url.hostname.endsWith(".youtube.com")
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["sourceUrl"],
            message: "Enter a valid YouTube URL",
          });
        }
      } catch {
        ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Enter a valid YouTube URL" });
      }
    }
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
          await supabase
            .from("jobs")
            .update({ backend_job_id: backend.backendJobId })
            .eq("id", job.id);
        }
      }
    } catch (err) {
      console.error("[startJob] backend dispatch failed:", err);
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          stage: "failed",
          error_message: err instanceof Error ? err.message : "Backend dispatch failed",
        })
        .eq("id", job.id);
    }

    return { jobId: job.id };
  });

export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    let { data, error } = await context.supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const active = (data ?? []).filter(
      (job) => job.backend_job_id && !["done", "failed", "cancelled"].includes(job.status),
    );
    if (active.length) {
      const { fetchBackendJob, getBackendConfig } = await import("./backend.server");
      if (getBackendConfig().configured) {
        await Promise.all(
          active.map(async (job) => {
            try {
              const remote = await fetchBackendJob(job.backend_job_id!);
              if (!remote) return;
              await context.supabase
                .from("jobs")
                .update({
                  status: remote.status,
                  stage: remote.status,
                  progress: remote.progress,
                  error_message: remote.error ?? null,
                  estimated_remaining_s: remote.estimatedRemainingS ?? null,
                  completed_clips: remote.completedClips ?? 0,
                  last_heartbeat_at: remote.updatedAt
                    ? new Date(remote.updatedAt).toISOString()
                    : new Date().toISOString(),
                })
                .eq("id", job.id);
            } catch (err) {
              console.error("[listJobs] sync failed:", err);
            }
          }),
        );
        const refreshed = await context.supabase
          .from("jobs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        data = refreshed.data;
        error = refreshed.error;
        if (error) throw new Error(error.message);
      }
    }
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

export const cancelJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ jobId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: job } = await context.supabase
      .from("jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    if (["done", "failed", "cancelled"].includes(job.status))
      throw new Error("This job can no longer be cancelled");
    await context.supabase
      .from("jobs")
      .update({ status: "cancel_requested", stage: "cancel_requested" })
      .eq("id", job.id);
    if (job.backend_job_id) {
      const { cancelBackendJob } = await import("./backend.server");
      await cancelBackendJob(job.backend_job_id);
    } else {
      await context.supabase
        .from("jobs")
        .update({ status: "cancelled", stage: "cancelled" })
        .eq("id", job.id);
    }
    return { ok: true };
  });

export const duplicateJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ jobId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: source } = await context.supabase
      .from("jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!source) throw new Error("Job not found");
    const { data: copy, error } = await context.supabase
      .from("jobs")
      .insert({
        user_id: context.userId,
        source_type: source.source_type,
        source_url: source.source_url,
        source_title: source.source_title,
        clip_duration: source.clip_duration,
        clip_count: source.clip_count,
        status: "queued",
        stage: "queued",
        progress: 0,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    try {
      const { createBackendJob, getBackendConfig } = await import("./backend.server");
      if (getBackendConfig().configured) {
        const backend = await createBackendJob({
          sourceUrl: source.source_url ?? undefined,
          clipDuration: source.clip_duration,
          clipCount: source.clip_count,
          userId: context.userId,
          jobId: copy.id,
        });
        if (backend)
          await context.supabase
            .from("jobs")
            .update({ backend_job_id: backend.backendJobId })
            .eq("id", copy.id);
      }
    } catch (err) {
      await context.supabase
        .from("jobs")
        .update({
          status: "failed",
          stage: "failed",
          error_message: err instanceof Error ? err.message : "Backend dispatch failed",
        })
        .eq("id", copy.id);
    }
    return { jobId: copy.id };
  });

// Mock stage progression when no backend is configured.
const STAGES = ["queued", "transcribing", "analyzing", "rendering", "done"] as const;

export const pollJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ jobId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || ["done", "failed", "cancelled"].includes(job.status)) {
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
        const { data: updated } = await supabase
          .from("jobs")
          .select("*")
          .eq("id", job.id)
          .maybeSingle();
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
            estimated_remaining_s: remote.estimatedRemainingS ?? null,
            source_duration_s: remote.sourceDurationS ?? null,
            completed_clips: remote.completedClips ?? 0,
            started_at: remote.startedAt
              ? new Date(remote.startedAt).toISOString()
              : job.started_at,
            stage_started_at: remote.stageStartedAt
              ? new Date(remote.stageStartedAt).toISOString()
              : job.stage_started_at,
            last_heartbeat_at: remote.updatedAt
              ? new Date(remote.updatedAt).toISOString()
              : new Date().toISOString(),
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
        const { data: updated } = await supabase
          .from("jobs")
          .select("*")
          .eq("id", job.id)
          .maybeSingle();
        return { job: updated };
      }
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          stage: "failed",
          error_message: "Processing worker lost this job. Please retry.",
        })
        .eq("id", job.id);
      const { data: missing } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", job.id)
        .maybeSingle();
      return { job: missing };
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

    const { data: updated } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", job.id)
      .maybeSingle();
    return { job: updated };
  });
