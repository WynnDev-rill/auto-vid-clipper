import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { BackendJob } from "./backend.server";

const SOURCE_VIDEOS_BUCKET = "clipforge-source-videos";
type JobRow = Database["public"]["Tables"]["clipforge_jobs"]["Row"];

async function syncBackendJob(
  supabase: SupabaseClient<Database>,
  userId: string,
  job: JobRow,
  remote: BackendJob,
) {
  if (remote.status === "done" && remote.clips?.length) {
    const { count, error: countError } = await supabase
      .from("clipforge_clips")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id);
    if (countError) throw new Error(countError.message);
    if (!count) {
      const rows = remote.clips.map((clip) => ({
        job_id: job.id,
        user_id: userId,
        video_url: clip.video_url,
        thumbnail_url: clip.thumbnail_url,
        duration_s: clip.duration_s,
        order_index: clip.order,
        status: "draft" as const,
        title: `${job.source_title ?? "Clip"} · Highlight ${clip.order + 1}`,
        description: clip.transcript ?? "",
        subtitle_template: "modern",
        subtitle_style: {},
        hashtags: ["#shorts", "#viral", "#clipforge"],
        tags: ["shorts", "clips"],
      }));
      const { error } = await supabase.from("clipforge_clips").insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  const { error } = await supabase
    .from("clipforge_jobs")
    .update({
      status: remote.status,
      stage: remote.status,
      progress: remote.progress,
      error_message: remote.error ?? null,
      estimated_remaining_s: remote.estimatedRemainingS ?? null,
      source_duration_s: remote.sourceDurationS ?? null,
      completed_clips: remote.completedClips ?? 0,
      started_at: remote.startedAt ? new Date(remote.startedAt).toISOString() : job.started_at,
      stage_started_at: remote.stageStartedAt
        ? new Date(remote.stageStartedAt).toISOString()
        : job.stage_started_at,
      last_heartbeat_at: remote.updatedAt
        ? new Date(remote.updatedAt).toISOString()
        : new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error) throw new Error(error.message);
}

const StartJobSchema = z
  .object({
    sourceType: z.enum(["youtube_url", "upload"]),
    sourceUrl: z.string().min(1).max(2048).optional(),
    sourceUploadPath: z.string().min(1).max(1024).optional(),
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
          ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Enter a valid YouTube URL" });
        }
      } catch {
        ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Enter a valid YouTube URL" });
      }
    } else if (!value.sourceUploadPath) {
      ctx.addIssue({ code: "custom", path: ["sourceUploadPath"], message: "Upload a video first" });
    }
  });

export const startJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => StartJobSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let processingUrl = data.sourceUrl;

    if (data.sourceType === "upload") {
      const uploadPath = data.sourceUploadPath!;
      if (!uploadPath.startsWith(`${userId}/`) || uploadPath.includes("..")) {
        throw new Error("Invalid uploaded video path");
      }

      const fileName = uploadPath.slice(uploadPath.lastIndexOf("/") + 1);
      const { data: files, error: listError } = await supabase.storage
        .from(SOURCE_VIDEOS_BUCKET)
        .list(userId, { search: fileName, limit: 2 });
      if (listError) throw new Error(`Could not verify uploaded video: ${listError.message}`);
      if (!files?.some((file) => file.name === fileName)) {
        throw new Error("The video upload did not complete. Please select the file again.");
      }

      const { data: signed, error: signError } = await supabase.storage
        .from(SOURCE_VIDEOS_BUCKET)
        .createSignedUrl(uploadPath, 24 * 60 * 60);
      if (signError) throw new Error(`Could not read uploaded video: ${signError.message}`);
      processingUrl = signed.signedUrl;
    }

    const { data: job, error } = await supabase
      .from("clipforge_jobs")
      .insert({
        user_id: userId,
        source_type: data.sourceType,
        source_url: data.sourceType === "youtube_url" ? data.sourceUrl : null,
        source_upload_path: data.sourceUploadPath ?? null,
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

    try {
      const { createBackendJob, getBackendConfig } = await import("./backend.server");
      if (getBackendConfig().configured) {
        const backend = await createBackendJob({
          sourceUrl: processingUrl,
          clipDuration: data.clipDuration,
          clipCount: data.clipCount,
          userId,
          jobId: job.id,
        });
        if (backend?.backendJobId) {
          await supabase
            .from("clipforge_jobs")
            .update({ backend_job_id: backend.backendJobId })
            .eq("id", job.id);
        }
      }
    } catch (err) {
      console.error("[startJob] backend dispatch failed:", err);
      await supabase
        .from("clipforge_jobs")
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
      .from("clipforge_jobs")
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
              if (remote) await syncBackendJob(context.supabase, context.userId, job, remote);
            } catch (err) {
              console.error("[listJobs] sync failed:", err);
            }
          }),
        );
        const refreshed = await context.supabase
          .from("clipforge_jobs")
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
      .from("clipforge_jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return { job: null, clips: [] };

    const { data: clips } = await context.supabase
      .from("clipforge_clips")
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
      .from("clipforge_jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    if (["done", "failed", "cancelled"].includes(job.status)) {
      throw new Error("This job can no longer be cancelled");
    }

    await context.supabase
      .from("clipforge_jobs")
      .update({ status: "cancel_requested", stage: "cancel_requested" })
      .eq("id", job.id);
    if (job.backend_job_id) {
      const { cancelBackendJob } = await import("./backend.server");
      await cancelBackendJob(job.backend_job_id);
    } else {
      await context.supabase
        .from("clipforge_jobs")
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
      .from("clipforge_jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!source) throw new Error("Job not found");

    const { data: copy, error } = await context.supabase
      .from("clipforge_jobs")
      .insert({
        user_id: context.userId,
        source_type: source.source_type,
        source_url: source.source_url,
        source_upload_path: source.source_upload_path,
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
        let processingUrl = source.source_url ?? undefined;
        if (source.source_type === "upload" && source.source_upload_path) {
          const { data: signed, error: signError } = await context.supabase.storage
            .from(SOURCE_VIDEOS_BUCKET)
            .createSignedUrl(source.source_upload_path, 24 * 60 * 60);
          if (signError) throw new Error(`Could not read uploaded video: ${signError.message}`);
          processingUrl = signed.signedUrl;
        }
        const backend = await createBackendJob({
          sourceUrl: processingUrl,
          clipDuration: source.clip_duration,
          clipCount: source.clip_count,
          userId: context.userId,
          jobId: copy.id,
        });
        if (backend) {
          await context.supabase
            .from("clipforge_jobs")
            .update({ backend_job_id: backend.backendJobId })
            .eq("id", copy.id);
        }
      }
    } catch (err) {
      await context.supabase
        .from("clipforge_jobs")
        .update({
          status: "failed",
          stage: "failed",
          error_message: err instanceof Error ? err.message : "Backend dispatch failed",
        })
        .eq("id", copy.id);
    }
    return { jobId: copy.id };
  });

const STAGES = ["queued", "transcribing", "analyzing", "rendering", "done"] as const;

export const pollJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ jobId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job } = await supabase
      .from("clipforge_jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || ["done", "failed", "cancelled"].includes(job.status)) return { job };

    const { getBackendConfig, fetchBackendJob } = await import("./backend.server");
    const cfg = getBackendConfig();
    if (cfg.configured) {
      if (!job.backend_job_id) {
        await supabase
          .from("clipforge_jobs")
          .update({ status: "failed", stage: "failed", error_message: "Backend dispatch failed" })
          .eq("id", job.id);
        const { data: updated } = await supabase
          .from("clipforge_jobs")
          .select("*")
          .eq("id", job.id)
          .maybeSingle();
        return { job: updated };
      }

      const remote = await fetchBackendJob(job.backend_job_id);
      if (remote) {
        await syncBackendJob(supabase, userId, job, remote);
        const { data: updated } = await supabase
          .from("clipforge_jobs")
          .select("*")
          .eq("id", job.id)
          .maybeSingle();
        return { job: updated };
      }

      await supabase
        .from("clipforge_jobs")
        .update({
          status: "failed",
          stage: "failed",
          error_message: "Processing worker lost this job. Please retry.",
        })
        .eq("id", job.id);
      const { data: missing } = await supabase
        .from("clipforge_jobs")
        .select("*")
        .eq("id", job.id)
        .maybeSingle();
      return { job: missing };
    }

    const elapsedMs = Date.now() - new Date(job.created_at).getTime();
    const stepMs = 2500;
    const stepIndex = Math.min(STAGES.length - 1, Math.floor(elapsedMs / stepMs));
    const nextStage = STAGES[stepIndex];
    const nextProgress = Math.min(100, Math.floor((stepIndex / (STAGES.length - 1)) * 100));

    await supabase
      .from("clipforge_jobs")
      .update({ status: nextStage, stage: nextStage, progress: nextProgress })
      .eq("id", job.id);

    if (nextStage === "done") {
      const { count } = await supabase
        .from("clipforge_clips")
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
        await supabase.from("clipforge_clips").insert(rows);
      }
    }

    const { data: updated } = await supabase
      .from("clipforge_jobs")
      .select("*")
      .eq("id", job.id)
      .maybeSingle();
    return { job: updated };
  });
