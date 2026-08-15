import "dotenv/config";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { cleanupOldMedia, initDatabase, storeMediaStream, writeMediaToResponse } from "./database.js";
import { exportSubtitles, renderExport, runPipeline } from "./pipeline.js";
import { createJob, deleteJob, getJob, initStore, listJobsForDevice, listRecoverableJobs, requestCancellation, updateJob } from "./store.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 600 * 1024 * 1024);
const ID = /^[A-Za-z0-9_-]{6,80}$/;

app.use(cors({ origin: true, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "X-Device-Id", "X-File-Name"] }));
function deviceId(req: express.Request) { return String(req.header("x-device-id") || req.query.deviceId || "").trim(); }
function owns(req: express.Request, job: ReturnType<typeof getJob>) { const id = deviceId(req); return Boolean(job && id && job.deviceId === id); }

app.get("/health", (_req, res) => res.json({ ok: true, version: "3.0.0", transcription: "local-whisper-cpp", highlightRanking: "local-multisignal", downloader: "yt-dlp", persistentState: Boolean(process.env.DATABASE_URL) }));

app.put("/uploads/:id", async (req, res) => {
  const uploadId = String(req.params.id || ""), owner = deviceId(req);
  if (!ID.test(uploadId) || !ID.test(owner)) return res.status(400).json({ error: "Invalid upload or device id" });
  const declared = Number(req.header("content-length") || 0);
  if (declared > MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Video exceeds upload limit" });
  const fileName = String(req.header("x-file-name") || `${uploadId}.mp4`).replace(/[^A-Za-z0-9._ -]/g, "-").slice(0, 140);
  const contentType = String(req.header("content-type") || "application/octet-stream");
  try {
    const result = await storeMediaStream(`upload:${uploadId}`, fileName, contentType, req, MAX_UPLOAD_BYTES);
    return res.json({ id: uploadId, size: result.size });
  } catch (error) {
    console.error("[upload] failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Upload failed" });
  }
});

app.use(express.json({ limit: "1mb" }));
const CreateJobSchema = z.object({
  deviceId: z.string().regex(ID), sourceUrl: z.string().url().max(2048).optional(), uploadId: z.string().regex(ID).optional(), sourceTitle: z.string().max(200).optional(),
  clipDuration: z.number().int().min(12).max(120).default(35), clipCount: z.number().int().min(4).max(20).default(10), goal: z.string().trim().max(300).optional(),
}).refine((value) => Boolean(value.sourceUrl || value.uploadId), "A video URL or upload is required");

app.post("/jobs", (req, res) => {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid job" });
  const job = createJob({ id: nanoid(12), deviceId: parsed.data.deviceId, sourceUrl: parsed.data.sourceUrl, uploadId: parsed.data.uploadId, sourceTitle: parsed.data.sourceTitle, clipDuration: parsed.data.clipDuration, clipCount: parsed.data.clipCount, goal: parsed.data.goal });
  void runPipeline(job).catch((error) => console.error("[pipeline] unhandled", error));
  return res.status(202).json({ id: job.id });
});

app.get("/jobs", async (req, res) => {
  const owner = deviceId(req);
  if (!ID.test(owner)) return res.status(400).json({ error: "Invalid device id" });
  const jobs = await listJobsForDevice(owner);
  return res.json({ jobs: jobs.map(publicJob) });
});
app.get("/jobs/:id", (req, res) => { const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: "not found" }); if (!owns(req, job)) return res.status(403).json({ error: "forbidden" }); return res.json(publicJob(job)); });
app.post("/jobs/:id/retry", (req, res) => {
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: "not found" }); if (!owns(req, job)) return res.status(403).json({ error: "forbidden" });
  if (!["done", "failed", "cancelled"].includes(job.status)) return res.status(409).json({ error: "Job is already active" });
  const now = Date.now(); updateJob(job.id, { status: "queued", progress: 0, clips: [], completedClips: 0, error: undefined, startedAt: now, stageStartedAt: now, estimatedRemainingS: undefined });
  const refreshed = getJob(job.id)!; void runPipeline(refreshed).catch((error) => console.error(`[pipeline] retry failed ${job.id}`, error));
  return res.status(202).json({ id: job.id });
});
app.post("/jobs/:id/cancel", (req, res) => { const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: "not found" }); if (!owns(req, job)) return res.status(403).json({ error: "forbidden" }); if (!requestCancellation(job.id)) return res.status(409).json({ error: "Job cannot be cancelled" }); return res.json({ ok: true }); });
app.delete("/jobs/:id", async (req, res) => { const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: "not found" }); if (!owns(req, job)) return res.status(403).json({ error: "forbidden" }); if (!["done", "failed", "cancelled"].includes(job.status)) requestCancellation(job.id); await deleteJob(job.id); return res.json({ ok: true }); });

const ExportSchema = z.object({ clipOrder: z.number().int().min(0).max(30), trimStart: z.number().min(-5).max(5).optional(), trimEnd: z.number().min(-5).max(5).optional(), aspectRatio: z.enum(["9:16", "1:1", "16:9"]).default("9:16"), captionStyle: z.enum(["modern", "bold", "minimal"]).default("modern"), captions: z.boolean().default(true), normalizeAudio: z.boolean().default(true), cropMode: z.enum(["safe", "fill"]).default("safe") });
app.post("/jobs/:id/export", async (req, res) => {
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: "not found" }); if (!owns(req, job)) return res.status(403).json({ error: "forbidden" }); if (job.status !== "done") return res.status(409).json({ error: "Analysis must finish before export" });
  const parsed = ExportSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid export options" });
  try { return res.json(await renderExport({ jobId: job.id, ...parsed.data })); }
  catch (error) { console.error("[export] failed", error); return res.status(500).json({ error: error instanceof Error ? error.message : "Export failed" }); }
});

const SubtitleSchema = z.object({ clipOrder: z.number().int().min(0).max(30), trimStart: z.number().min(-5).max(5).optional(), trimEnd: z.number().min(-5).max(5).optional() });
app.post("/jobs/:id/subtitles", async (req, res) => {
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: "not found" }); if (!owns(req, job)) return res.status(403).json({ error: "forbidden" }); if (job.status !== "done") return res.status(409).json({ error: "Analysis must finish first" });
  const parsed = SubtitleSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid subtitle options" });
  try { return res.json(await exportSubtitles({ jobId: job.id, ...parsed.data })); }
  catch (error) { console.error("[subtitles] failed", error); return res.status(500).json({ error: error instanceof Error ? error.message : "Subtitle export failed" }); }
});

app.get("/media/:id", async (req, res) => {
  try { const ok = await writeMediaToResponse(req.params.id, res); if (!ok && !res.headersSent) return res.status(404).json({ error: "media not found" }); }
  catch (error) { console.error("[media] failed", error); if (!res.headersSent) res.status(500).json({ error: "Could not read media" }); }
});

function publicJob(job: NonNullable<ReturnType<typeof getJob>>) {
  return { id: job.id, sourceTitle: job.sourceTitle, status: job.status, progress: job.progress, clips: job.clips, error: job.error, createdAt: job.createdAt, startedAt: job.startedAt, updatedAt: job.updatedAt, stageStartedAt: job.stageStartedAt, sourceDurationS: job.sourceDurationS, completedClips: job.completedClips, totalClips: job.clipCount, estimatedRemainingS: job.estimatedRemainingS };
}

async function start() {
  await initDatabase(); await initStore(); await cleanupOldMedia(Number(process.env.MEDIA_RETENTION_DAYS || 7)).catch((error) => console.error("[cleanup] failed", error));
  app.listen(PORT, () => {
    console.log(`[clipforge-worker] v3 listening on :${PORT}`);
    const recoverable = listRecoverableJobs();
    if (recoverable.length) console.log(`[clipforge-worker] resuming ${recoverable.length} interrupted job(s)`);
    for (const job of recoverable) void runPipeline(job).catch((error) => console.error(`[pipeline] recovery failed ${job.id}`, error));
  });
}
start().catch((error) => { console.error("[clipforge-worker] startup failed", error); process.exit(1); });
