import "dotenv/config";
import path from "node:path";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { runPipeline } from "./pipeline.js";
import { createJob, getJob } from "./store.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.BACKEND_SECRET;
const WORK_DIR = process.env.WORK_DIR || "./.work";

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!SECRET) return next(); // dev mode
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== SECRET) return res.status(401).json({ error: "unauthorized" });
  next();
}

const CreateJobSchema = z.object({
  sourceUrl: z.string().url().optional(),
  uploadKey: z.string().optional(),
  clipDuration: z.number().int().min(5).max(180),
  clipCount: z.number().int().min(1).max(20),
  userId: z.string(),
  jobId: z.string(),
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/jobs", requireAuth, (req, res) => {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const job = createJob({
    id: nanoid(12),
    appJobId: parsed.data.jobId,
    userId: parsed.data.userId,
    sourceUrl: parsed.data.sourceUrl,
    clipDuration: parsed.data.clipDuration,
    clipCount: parsed.data.clipCount,
  });
  // Fire and forget.
  runPipeline(job).catch((err) => console.error("[pipeline] unhandled:", err));
  res.json({ id: job.id });
});

app.get("/jobs/:id", requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    clips: job.clips,
    error: job.error,
  });
});

// Serve rendered artifacts. Public on purpose — video_url/thumbnail_url are
// consumed directly by browsers and YouTube's upload fetcher.
app.use("/media", express.static(path.resolve(WORK_DIR), {
  fallthrough: false,
  maxAge: "1h",
}));

app.listen(PORT, () => {
  console.log(`[clipforge-worker] listening on :${PORT}`);
});
