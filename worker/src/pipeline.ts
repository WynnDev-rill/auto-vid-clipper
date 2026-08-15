import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { analyzeMediaSignals } from "./media-analysis.js";
import { materializeMedia, storeMediaBuffer, storeMediaFile } from "./database.js";
import { downloadSource } from "./download.js";
import { extractAudio, probeDuration, renderClip } from "./ffmpeg.js";
import { scoreHighlights } from "./highlights.js";
import { getJob, throwIfCancelled, updateJob } from "./store.js";
import { transcribe } from "./transcribe.js";
import type { AspectRatio, CaptionStyle, Job, Transcript, Word } from "./types.js";

const WORK_DIR = path.resolve(process.env.WORK_DIR || "./.work");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://auto-vid-clipper.onrender.com").replace(/\/$/, "");
function mediaUrl(id: string) { return `${PUBLIC_BASE_URL}/media/${encodeURIComponent(id)}`; }

async function materializeSource(job: Job, destination: string) {
  if (job.uploadId) { await materializeMedia(`upload:${job.uploadId}`, destination); return; }
  if (!job.sourceUrl) throw new Error("Video source is missing");
  await downloadSource(job.sourceUrl, destination);
}

export async function runPipeline(job: Job) {
  const jobDir = path.join(WORK_DIR, job.id);
  fs.rmSync(jobDir, { recursive: true, force: true });
  fs.mkdirSync(jobDir, { recursive: true });
  try {
    throwIfCancelled(job.id);
    updateJob(job.id, { status: "downloading", progress: 3, error: undefined, clips: [], completedClips: 0 });
    const sourceVideo = path.join(jobDir, "source.mp4");
    await materializeSource(job, sourceVideo);
    throwIfCancelled(job.id);
    const totalDuration = await probeDuration(sourceVideo);
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) throw new Error("Could not read the source video duration");
    updateJob(job.id, { progress: 14, sourceDurationS: totalDuration });

    updateJob(job.id, { status: "transcribing", progress: 18 });
    const audioPath = path.join(jobDir, "audio.wav");
    await extractAudio(sourceVideo, audioPath);
    const transcript = await transcribe(audioPath);
    throwIfCancelled(job.id);
    const transcriptMediaId = `transcript:${job.id}`;
    await storeMediaBuffer(transcriptMediaId, `${job.id}.json`, "application/json", Buffer.from(JSON.stringify(transcript)));
    updateJob(job.id, { progress: 43, transcriptMediaId });

    updateJob(job.id, { status: "analyzing", progress: 47 });
    const mediaSignals = await analyzeMediaSignals(sourceVideo);
    const highlights = scoreHighlights({ segments: transcript.segments, totalDuration, clipDuration: job.clipDuration, count: job.clipCount, goal: job.goal, media: mediaSignals });
    if (!highlights.length) throw new Error("No reliable moments were found. Try a longer video or a different source.");
    throwIfCancelled(job.id);

    updateJob(job.id, { status: "rendering", progress: 58 });
    const clips: Job["clips"] = [];
    const renderStarted = Date.now();
    for (let index = 0; index < highlights.length; index++) {
      throwIfCancelled(job.id);
      const highlight = highlights[index];
      const mp4 = path.join(jobDir, `preview-${index}.mp4`), jpg = path.join(jobDir, `preview-${index}.jpg`);
      await renderClip({ sourceVideo, outMp4: mp4, outJpg: jpg, startS: highlight.start_s, endS: highlight.end_s, words: transcript.words, aspectRatio: "9:16", captionStyle: "modern", captions: true, normalizeAudio: true, cropMode: "safe", preview: true });
      const videoId = `preview:${job.id}:${index}:video`, thumbId = `preview:${job.id}:${index}:thumb`;
      await Promise.all([
        storeMediaFile(videoId, mp4, "video/mp4", `ClipForge-${job.id}-${index + 1}.mp4`),
        storeMediaFile(thumbId, jpg, "image/jpeg", `ClipForge-${job.id}-${index + 1}.jpg`),
      ]);
      clips.push({
        order: index, video_url: mediaUrl(videoId), thumbnail_url: mediaUrl(thumbId), duration_s: Math.max(1, Math.round(highlight.end_s - highlight.start_s)),
        transcript: highlight.text, start_s: highlight.start_s, end_s: highlight.end_s, score: highlight.score,
        score_breakdown: highlight.score_breakdown, reason: highlight.reason, signals: highlight.signals,
      });
      const completed = index + 1, averageMs = (Date.now() - renderStarted) / completed;
      updateJob(job.id, { clips: [...clips], completedClips: completed, progress: 58 + Math.floor((completed / highlights.length) * 40), estimatedRemainingS: Math.max(0, Math.round((averageMs * (highlights.length - completed)) / 1000)) });
      try { fs.unlinkSync(mp4); } catch {} try { fs.unlinkSync(jpg); } catch {}
    }
    updateJob(job.id, { status: "done", progress: 100, clips, estimatedRemainingS: 0 });
  } catch (error) {
    if (error instanceof Error && error.name === "JobCancelledError") { updateJob(job.id, { status: "cancelled", progress: 0, error: undefined, estimatedRemainingS: 0 }); return; }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pipeline] ${job.id} failed:`, error);
    updateJob(job.id, { status: "failed", error: message, estimatedRemainingS: 0 });
  } finally { fs.rmSync(jobDir, { recursive: true, force: true }); }
}

async function loadTranscript(job: Job, directory: string) {
  if (!job.transcriptMediaId) throw new Error("Transcript is unavailable for this project");
  const transcriptPath = path.join(directory, "transcript.json");
  await materializeMedia(job.transcriptMediaId, transcriptPath);
  return JSON.parse(fs.readFileSync(transcriptPath, "utf8")) as Transcript;
}

export async function renderExport(input: { jobId: string; clipOrder: number; trimStart?: number; trimEnd?: number; aspectRatio: AspectRatio; captionStyle: CaptionStyle; captions: boolean; normalizeAudio: boolean; cropMode: "safe" | "fill" }) {
  const job = getJob(input.jobId);
  if (!job) throw new Error("Project not found");
  const clip = job.clips.find((item) => item.order === input.clipOrder);
  if (!clip) throw new Error("Moment not found");
  const exportId = nanoid(10), exportDir = path.join(WORK_DIR, `${job.id}-export-${exportId}`);
  fs.mkdirSync(exportDir, { recursive: true });
  try {
    const sourceVideo = path.join(exportDir, "source.mp4");
    const [transcript] = await Promise.all([loadTranscript(job, exportDir), materializeSource(job, sourceVideo)]);
    const start = Math.max(0, clip.start_s + Math.max(-5, Math.min(5, input.trimStart ?? 0)));
    const end = Math.max(start + 3, clip.end_s + Math.max(-5, Math.min(5, input.trimEnd ?? 0)));
    const mp4 = path.join(exportDir, "final.mp4"), jpg = path.join(exportDir, "final.jpg");
    await renderClip({ sourceVideo, outMp4: mp4, outJpg: jpg, startS: start, endS: end, words: transcript.words, aspectRatio: input.aspectRatio, captionStyle: input.captionStyle, captions: input.captions, normalizeAudio: input.normalizeAudio, cropMode: input.cropMode, preview: false });
    const mediaId = `export:${job.id}:${exportId}`;
    await storeMediaFile(mediaId, mp4, "video/mp4", `ClipForge-${job.id}-${input.clipOrder + 1}.mp4`);
    return { exportId, url: mediaUrl(mediaId) };
  } finally { fs.rmSync(exportDir, { recursive: true, force: true }); }
}

function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000), milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function buildSrt(words: Word[], start: number, end: number) {
  const inClip = words.filter((word) => word.end > start && word.start < end).map((word) => ({ ...word, start: Math.max(0, word.start - start), end: Math.min(end - start, word.end - start) }));
  const blocks: string[] = [];
  for (let i = 0, block = 1; i < inClip.length; i += 7, block++) {
    const group = inClip.slice(i, i + 7); if (!group.length) continue;
    const text = group.map((word) => word.word).join(" ").replace(/\s+([,.!?;:])/g, "$1");
    blocks.push(`${block}\n${srtTime(group[0].start)} --> ${srtTime(group[group.length - 1].end)}\n${text}`);
  }
  return blocks.join("\n\n") + "\n";
}

export async function exportSubtitles(input: { jobId: string; clipOrder: number; trimStart?: number; trimEnd?: number }) {
  const job = getJob(input.jobId);
  if (!job) throw new Error("Project not found");
  const clip = job.clips.find((item) => item.order === input.clipOrder);
  if (!clip) throw new Error("Moment not found");
  const directory = path.join(WORK_DIR, `${job.id}-srt-${nanoid(6)}`); fs.mkdirSync(directory, { recursive: true });
  try {
    const transcript = await loadTranscript(job, directory);
    const start = Math.max(0, clip.start_s + Math.max(-5, Math.min(5, input.trimStart ?? 0)));
    const end = Math.max(start + 3, clip.end_s + Math.max(-5, Math.min(5, input.trimEnd ?? 0)));
    const mediaId = `srt:${job.id}:${clip.order}:${nanoid(8)}`;
    await storeMediaBuffer(mediaId, `ClipForge-Moment-${clip.order + 1}.srt`, "application/x-subrip; charset=utf-8", Buffer.from(buildSrt(transcript.words, start, end), "utf8"));
    return { url: mediaUrl(mediaId) };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
