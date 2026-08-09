import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { BackendJob } from "./backend.server";

const SOURCE_VIDEOS_BUCKET = "clipforge-source-videos";
type JobRow = Database["public"]["Tables"]["clipforge_jobs"]["Row"];

async function getAutoUploadAccessToken(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | undefined> {
  const { data, error } = await supabase
    .from("clipforge_youtube_connections")
    .select("access_token, access_token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.access_token || !data.access_token_expires_at) return undefined;
  if (Date.parse(data.access_token_expires_at) - Date.now() <= 120_000) return undefined;
  return data.access_token;
}

async function syncBackendJob(
  supabase: SupabaseClient<Database>,
  userId: string,
  job: JobRow,
  remote: BackendJob,
) {
  if (remote.status === "done" && remote.clips?.length) {
    const { data: existing, error: existingError } = await supabase
      .from("clipforge_clips")
      .select("id, order_index")
      .eq("job_id", job.id);
    if (existingError) throw new Error(existingError.message);

    if (!existing?.length) {
      const rows = remote.clips.map((clip) => ({
        job_id: job.id,
        user_id: userId,
        video_url: clip.video_url,
        thumbnail_url: clip.thumbnail_url,
        duration_s: clip.duration_s,
        order_index: clip.order,
        status: clip.youtube_video_id ? ("uploaded" as const) : ("draft" as const),
        title: `${job.source_title ?? "Clip"} · Highlight ${clip.order + 1}`,
        description: clip.transcript ?? "",
        subtitle_template: "modern",
        subtitle_style: {},
        hashtags: ["#shorts", "#clipforge"],
        tags: ["shorts", "clips", "clipforge"],
      }));
      const { data: inserted, error: insertError } = await supabase
        .from("clipforge_clips")
        .insert(rows)
        .select("id, order_index, title, description");
      if (insertError) throw new Error(insertError.message);

      const uploads = (inserted ?? []).flatMap((clipRow) => {
        const remoteClip = remote.clips?.find((item) => item.order === clipRow.order_index);
        if (!remoteClip?.youtube_video_id && !remoteClip?.youtube_error) return [];
        return [{
          clip_id: clipRow.id,
          user_id: userId,
          youtube_video_id: remoteClip.youtube_video_id ?? null,
          visibility: "unlisted",
          status: remoteClip.youtube_video_id ? "uploaded" : "failed",
          title: clipRow.title,
          description: clipRow.description,
          simulated: false,
          error_message: remoteClip.youtube_error ?? null,
          uploaded_at: remoteClip.youtube_video_id ? new Date().toISOString() : null,
        }];
      });
      if (uploads.length) {
        const { error: uploadError } = await supabase.from("clipforge_uploads").insert(uploads);
        if (uploadError) throw new Error(uploadError.message);
      }
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
        if (url.hostname !== "youtu.be" && url.hostname !== "youtube.com" && !url.hostname.endsWith(".youtube.com")) {
          ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Enter a valid YouTube URL" });
        }
      } catch {
        ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Enter a valid YouTube URL" });
      }
    } else if (!value.sourceUploadPath) {
      ctx.addIssue({ code: "custom", path: ["sourceUploadPath"], message: "Upload a video first" });
    }
  });

async function createSignedSourceUrl(
  supabase: SupabaseClient<Database>,
  userId: string,
  uploadPath: string,
) {
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
  return signed.signedUrl;
}

export const startJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => StartJobSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId, accessToken } = context;
    let processingUrl = data.sourceUrl;
    if (data.sourceType === "upload") {
      processingUrl = await createSignedSourceUrl(supabase, userId, data.sourceUploadPath!);
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
      const { createBackendJob } = await import("./backend.server");
      const youtubeAccessToken = await getAutoUploadAccessToken(supabase, userId);
      const backend = await createBackendJob({
        sourceUrl: processingUrl,
        clipDuration: data.clipDuration,
        clipCount: data.clipCount,
        userId,
        jobId: job.id,
        accessToken,
        youtubeAccessToken,
        youtubeVisibility: "unlisted",
      });
      if (!backend?.backendJobId) throw new Error("Render worker did not accept the generation job");
      const { error: updateError } = await supabase
        .from("clipforge_jobs")
        .update({ backend_job_id: backend.backendJobId })
        .eq("id", job.id);
      if (updateError) throw new Error(updateError.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Backend dispatch failed";
      await supabase
        .from("clipforge_jobs")
        .update({ status: "failed", stage: "failed", error_message: message })
        .eq("id", job.id);
      throw new Error(message);
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
      const { fetchBackendJob } = await import("./backend.server");
      await Promise.all(
        active.map(async (job) => {
          try {
            const remote = await fetchBackendJob(job.backend_job_id!, context.accessToken);
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

    const { data: clips, error: clipsError } = await context.supabase
      .from("clipforge_clips")
      .select("*")
      .eq("job_id", data.jobId)
      .order("order_index", { ascending: true });
    if (clipsError) throw new Error(clipsError.message);
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
      await cancelBackendJob(job.backend_job_id, context.accessToken);
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
      let processingUrl = source.source_url ?? undefined;
      if (source.source_type === "upload" && source.source_upload_path) {
        processingUrl = await createSignedSourceUrl(context.supabase, context.userId, source.source_upload_path);
      }
      const youtubeAccessToken = await getAutoUploadAccessToken(context.supabase, context.userId);
      const { createBackendJob } = await import("./backend.server");
      const backend = await createBackendJob({
        sourceUrl: processingUrl,
        clipDuration: source.clip_duration,
        clipCount: source.clip_count,
        userId: context.userId,
        jobId: copy.id,
        accessToken: context.accessToken,
        youtubeAccessToken,
        youtubeVisibility: "unlisted",
      });
      if (!backend?.backendJobId) throw new Error("Render worker did not accept the duplicated job");
      await context.supabase
        .from("clipforge_jobs")
        .update({ backend_job_id: backend.backendJobId })
        .eq("id", copy.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Backend dispatch failed";
      await context.supabase
        .from("clipforge_jobs")
        .update({ status: "failed", stage: "failed", error_message: message })
        .eq("id", copy.id);
      throw new Error(message);
    }
    return { jobId: copy.id };
  });

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

    if (!job.backend_job_id) {
      await supabase
        .from("clipforge_jobs")
        .update({ status: "failed", stage: "failed", error_message: "Render worker did not receive this job" })
        .eq("id", job.id);
    } else {
      const { fetchBackendJob } = await import("./backend.server");
      const remote = await fetchBackendJob(job.backend_job_id, context.accessToken);
      if (remote) {
        await syncBackendJob(supabase, userId, job, remote);
      } else {
        await supabase
          .from("clipforge_jobs")
          .update({ status: "failed", stage: "failed", error_message: "Render worker lost this job. Please retry." })
          .eq("id", job.id);
      }
    }

    const { data: updated } = await supabase
      .from("clipforge_jobs")
      .select("*")
      .eq("id", job.id)
      .maybeSingle();
    return { job: updated };
  });
