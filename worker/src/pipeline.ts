import fs from "node:fs";
import path from "node:path";
import { downloadSource } from "./download.js";
import { extractAudio, probeDuration, renderClip } from "./ffmpeg.js";
import { scoreHighlights } from "./highlights.js";
import { throwIfCancelled, updateJob, type Job } from "./store.js";
import { transcribe, type Transcript } from "./whisper.js";
import { uploadVideoToYouTube } from "./youtube.js";

const WORK_DIR = process.env.WORK_DIR || "./.work";

export async function runPipeline(job: Job): Promise<void> {
  const jobDir = path.join(WORK_DIR, job.id);
  fs.mkdirSync(jobDir, { recursive: true });
  const publicBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!publicBase) throw new Error("PUBLIC_BASE_URL is not configured on the Render worker");
  const mediaUrl = (file: string) => `${publicBase}/media/${job.id}/${file}`;

  try {
    if (!job.sourceUrl) throw new Error("sourceUrl is required");
    throwIfCancelled(job.id);

    updateJob(job.id, { status: "transcribing", progress: 5 });
    const sourceVideo = path.join(jobDir, "source.mp4");
    await downloadSource(job.sourceUrl, sourceVideo);
    throwIfCancelled(job.id);
    const totalDuration = await probeDuration(sourceVideo);
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
      throw new Error("Could not determine source video duration");
    }
    updateJob(job.id, { progress: 20, sourceDurationS: totalDuration });

    const audioPath = path.join(jobDir, "audio.wav");
    let transcript: Transcript = { text: "", words: [], segments: [] };
    try {
      await extractAudio(sourceVideo, audioPath);
      transcript = await transcribe(audioPath);
    } catch (error) {
      // Transcription improves clip selection and subtitles, but it must not make
      // the entire video pipeline unusable when every provider is unavailable.
      console.error("[pipeline] transcription unavailable, continuing without subtitles:", error);
    }
    throwIfCancelled(job.id);
    updateJob(job.id, { status: "analyzing", progress: 45, sourceDurationS: totalDuration });

    const highlights = await scoreHighlights({
      segments: transcript.segments,
      totalDuration,
      clipDuration: job.clipDuration,
      count: job.clipCount,
    });
    throwIfCancelled(job.id);
    if (highlights.length === 0) throw new Error("No usable clip ranges were produced");
    updateJob(job.id, { status: "rendering", progress: 60 });

    const clips: Job["clips"] = [];
    const renderStartedAt = Date.now();
    for (let i = 0; i < highlights.length; i++) {
      throwIfCancelled(job.id);
      const h = highlights[i];
      const mp4 = path.join(jobDir, `clip-${i}.mp4`);
      const jpg = path.join(jobDir, `clip-${i}.jpg`);
      await renderClip({
        sourceVideo,
        outMp4: mp4,
        outJpg: jpg,
        startS: h.start_s,
        endS: h.end_s,
        words: transcript.words,
      });

      const clipTranscript = transcript.words
        .filter((word) => word.end > h.start_s && word.start < h.end_s)
        .map((word) => word.word)
        .join(" ")
        .trim();

      const result: Job["clips"][number] = {
        order: i,
        video_url: mediaUrl(`clip-${i}.mp4`),
        thumbnail_url: mediaUrl(`clip-${i}.jpg`),
        duration_s: Math.max(1, Math.round(h.end_s - h.start_s)),
        transcript: clipTranscript,
      };

      if (job.youtubeAccessToken) {
        try {
          result.youtube_video_id = await uploadVideoToYouTube({
            accessToken: job.youtubeAccessToken,
            filePath: mp4,
            title: `ClipForge Highlight ${i + 1}`,
            description: `${clipTranscript}${clipTranscript ? "\n\n" : ""}#Shorts #ClipForge`,
            visibility: job.youtubeVisibility ?? "unlisted",
          });
        } catch (error) {
          result.youtube_error = error instanceof Error ? error.message : String(error);
          console.error(`[pipeline] YouTube upload failed for clip ${i}:`, error);
        }
      }

      clips.push(result);
      const completedClips = i + 1;
      const averageClipMs = (Date.now() - renderStartedAt) / completedClips;
      updateJob(job.id, {
        progress: 60 + Math.floor((completedClips / highlights.length) * 38),
        clips: [...clips],
        completedClips,
        estimatedRemainingS: Math.max(
          0,
          Math.round((averageClipMs * (highlights.length - completedClips)) / 1000),
        ),
      });
    }

    try { fs.unlinkSync(sourceVideo); } catch {}
    try { fs.unlinkSync(audioPath); } catch {}

    updateJob(job.id, { status: "done", progress: 100, clips, estimatedRemainingS: 0 });
  } catch (err) {
    if (err instanceof Error && err.name === "JobCancelledError") {
      updateJob(job.id, {
        status: "cancelled",
        progress: 0,
        error: undefined,
        estimatedRemainingS: 0,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] job ${job.id} failed:`, err);
    updateJob(job.id, { status: "failed", error: message, estimatedRemainingS: 0 });
  }
}
