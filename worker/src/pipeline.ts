import fs from "node:fs";
import path from "node:path";
import { downloadSource } from "./download.js";
import { extractAudio, probeDuration, renderClip } from "./ffmpeg.js";
import { scoreHighlights } from "./highlights.js";
import { updateJob, type Job } from "./store.js";
import { transcribe } from "./whisper.js";

const WORK_DIR = process.env.WORK_DIR || "./.work";

export async function runPipeline(job: Job): Promise<void> {
  const jobDir = path.join(WORK_DIR, job.id);
  fs.mkdirSync(jobDir, { recursive: true });
  const publicBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const mediaUrl = (file: string) => `${publicBase}/media/${job.id}/${file}`;

  try {
    if (!job.sourceUrl) throw new Error("sourceUrl is required");

    // 1. Download
    updateJob(job.id, { status: "transcribing", progress: 5 });
    const sourceVideo = path.join(jobDir, "source.mp4");
    await downloadSource(job.sourceUrl, sourceVideo);
    updateJob(job.id, { progress: 20 });

    // 2. Whisper
    const audioPath = path.join(jobDir, "audio.wav");
    await extractAudio(sourceVideo, audioPath);
    const transcript = await transcribe(audioPath);
    const totalDuration = await probeDuration(sourceVideo);
    updateJob(job.id, { status: "analyzing", progress: 45 });

    // 3. Highlights
    const highlights = await scoreHighlights({
      segments: transcript.segments,
      totalDuration,
      clipDuration: job.clipDuration,
      count: job.clipCount,
    });
    if (highlights.length === 0) throw new Error("No highlights produced");
    updateJob(job.id, { status: "rendering", progress: 60 });

    // 4. Render each clip
    const clips: Job["clips"] = [];
    for (let i = 0; i < highlights.length; i++) {
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
        .filter((w) => w.end > h.start_s && w.start < h.end_s)
        .map((w) => w.word)
        .join(" ")
        .trim();
      clips.push({
        order: i,
        video_url: mediaUrl(`clip-${i}.mp4`),
        thumbnail_url: mediaUrl(`clip-${i}.jpg`),
        duration_s: Math.round(h.end_s - h.start_s),
        transcript: clipTranscript,
      });
      updateJob(job.id, {
        progress: 60 + Math.floor(((i + 1) / highlights.length) * 38),
        clips: [...clips],
      });
    }

    // 5. Cleanup source + audio (keep rendered clips for serving)
    try { fs.unlinkSync(sourceVideo); } catch {}
    try { fs.unlinkSync(audioPath); } catch {}

    updateJob(job.id, { status: "done", progress: 100, clips });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] job ${job.id} failed:`, err);
    updateJob(job.id, { status: "failed", error: message });
  }
}
