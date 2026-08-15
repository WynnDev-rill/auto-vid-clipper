import fs from "node:fs";
import path from "node:path";
import { downloadSource } from "./download.js";
import { extractAudio, probeDuration, renderClip } from "./ffmpeg.js";
import { scoreHighlights } from "./highlights.js";
import { throwIfCancelled, updateJob, type Job } from "./store.js";
import { transcribe, type Transcript } from "./whisper.js";

const WORK_DIR = process.env.WORK_DIR || "./.work";

export async function runPipeline(job: Job): Promise<void> {
  const jobDir = path.join(WORK_DIR, job.id);
  try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(jobDir, { recursive: true });
  const publicBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!publicBase) throw new Error("PUBLIC_BASE_URL is not configured on the Render worker");
  const mediaUrl = (file: string) => `${publicBase}/media/${job.id}/${file}`;

  try {
    if (!job.sourceUrl) throw new Error("sourceUrl is required");
    throwIfCancelled(job.id);

    updateJob(job.id, { status: "transcribing", progress: 4, error: undefined });
    const sourceVideo = path.join(jobDir, "source.mp4");
    await downloadSource(job.sourceUrl, sourceVideo);
    throwIfCancelled(job.id);
    const totalDuration = await probeDuration(sourceVideo);
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
      throw new Error("Could not determine source video duration");
    }
    updateJob(job.id, { progress: 18, sourceDurationS: totalDuration });

    const audioPath = path.join(jobDir, "audio.wav");
    let transcript: Transcript = { text: "", words: [], segments: [] };
    try {
      await extractAudio(sourceVideo, audioPath);
      transcript = await transcribe(audioPath);
    } catch (error) {
      console.error("[pipeline] transcription unavailable:", error);
      throw new Error("Could not analyze speech in this video. Retry when a transcription provider is available.");
    }
    throwIfCancelled(job.id);
    updateJob(job.id, { status: "analyzing", progress: 44, sourceDurationS: totalDuration });

    const highlights = await scoreHighlights({
      segments: transcript.segments,
      totalDuration,
      clipDuration: job.clipDuration,
      count: job.clipCount,
      goal: job.goal,
    });
    throwIfCancelled(job.id);
    if (highlights.length === 0) {
      throw new Error("No reliable candidate moments were found. Try a longer video or a different source.");
    }
    updateJob(job.id, { status: "rendering", progress: 58 });

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

      clips.push({
        order: i,
        video_url: mediaUrl(`clip-${i}.mp4`),
        thumbnail_url: mediaUrl(`clip-${i}.jpg`),
        duration_s: Math.max(1, Math.round(h.end_s - h.start_s)),
        transcript: clipTranscript,
        score: h.score,
        reason: h.reason,
        signals: h.signals,
      });

      const completedClips = i + 1;
      const averageClipMs = (Date.now() - renderStartedAt) / completedClips;
      updateJob(job.id, {
        progress: 58 + Math.floor((completedClips / highlights.length) * 40),
        clips: [...clips],
        completedClips,
        estimatedRemainingS: Math.max(0, Math.round((averageClipMs * (highlights.length - completedClips)) / 1000)),
      });
    }

    try { fs.unlinkSync(sourceVideo); } catch {}
    try { fs.unlinkSync(audioPath); } catch {}
    updateJob(job.id, { status: "done", progress: 100, clips, estimatedRemainingS: 0 });
  } catch (err) {
    if (err instanceof Error && err.name === "JobCancelledError") {
      updateJob(job.id, { status: "cancelled", progress: 0, error: undefined, estimatedRemainingS: 0 });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] job ${job.id} failed:`, err);
    updateJob(job.id, { status: "failed", error: message, estimatedRemainingS: 0 });
  }
}
