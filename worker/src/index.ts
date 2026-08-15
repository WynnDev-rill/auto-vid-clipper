import "dotenv/config";
import path from "node:path";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { runPipeline } from "./pipeline.js";
import {
  getSettingsSnapshot,
  getWhisperProvider,
  setWhisperProvider,
  type WhisperProvider,
} from "./settings.js";
import { createJob, getJob, listRecoverableJobs, requestCancellation } from "./store.js";
import { listProviderAvailability } from "./whisper.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.BACKEND_SECRET;
const WORK_DIR = process.env.WORK_DIR || "./.work";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://fxebamfwewsvtscrbwxk.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_c81UMY86mgZXNuvM5hB4Ng_RroHC9Kc";

type AuthResult = { legacy: boolean; userId?: string };

async function authenticate(req: express.Request): Promise<AuthResult | null> {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  if (SECRET && token === SECRET) return { legacy: true };

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { id?: string };
    return user.id ? { legacy: false, userId: user.id } : null;
  } catch (error) {
    console.error("[auth] Supabase token verification failed:", error);
    return null;
  }
}

// Keep the worker backward-compatible with projects created by older APKs.
// The V2 Create screen itself uses the narrower 15–90s / 5–15 candidate defaults.
const CreateJobSchema = z.object({
  sourceUrl: z.string().url().optional(),
  uploadKey: z.string().optional(),
  clipDuration: z.number().int().min(5).max(180),
  clipCount: z.number().int().min(1).max(20),
  goal: z.string().trim().max(240).optional(),
  userId: z.string().min(1),
  jobId: z.string().min(1),
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: "2.0.0",
    providers: listProviderAvailability(),
    publicBaseUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL),
    supabaseAuthConfigured: Boolean(SUPABASE_URL && SUPABASE_KEY),
  });
});

app.post("/jobs", async (req, res) => {
  const auth = await authenticate(req);
  if (!auth) return res.status(401).json({ error: "unauthorized" });
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!auth.legacy && auth.userId !== parsed.data.userId) {
    return res.status(403).json({ error: "user mismatch" });
  }

  const job = createJob({
    id: nanoid(12),
    appJobId: parsed.data.jobId,
    userId: parsed.data.userId,
    sourceUrl: parsed.data.sourceUrl,
    clipDuration: parsed.data.clipDuration,
    clipCount: parsed.data.clipCount,
    goal: parsed.data.goal,
  });
  runPipeline(job).catch((err) => console.error("[pipeline] unhandled:", err));
  return res.json({ id: job.id });
});

app.get("/jobs/:id", async (req, res) => {
  const auth = await authenticate(req);
  if (!auth) return res.status(401).json({ error: "unauthorized" });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  if (!auth.legacy && auth.userId !== job.userId) return res.status(403).json({ error: "forbidden" });
  return res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    clips: job.clips,
    error: job.error,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    stageStartedAt: job.stageStartedAt,
    sourceDurationS: job.sourceDurationS,
    completedClips: job.completedClips,
    totalClips: job.clipCount,
    estimatedRemainingS: job.estimatedRemainingS,
  });
});

app.post("/jobs/:id/cancel", async (req, res) => {
  const auth = await authenticate(req);
  if (!auth) return res.status(401).json({ error: "unauthorized" });
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  if (!auth.legacy && auth.userId !== job.userId) return res.status(403).json({ error: "forbidden" });
  if (!requestCancellation(job.id)) return res.status(409).json({ error: "job cannot be cancelled" });
  return res.json({ ok: true });
});

app.get("/settings/whisper-provider", async (req, res) => {
  const auth = await authenticate(req);
  if (!auth) return res.status(401).json({ error: "unauthorized" });
  const snapshot = getSettingsSnapshot();
  return res.json({
    provider: snapshot.whisperProvider,
    lastUsedProvider: snapshot.lastUsedProvider ?? null,
    lastUsedAt: snapshot.lastUsedAt ?? null,
    available: listProviderAvailability(),
    autoOrder: ["groq", "openai", "openrouter"],
  });
});

const WhisperProviderSchema = z.object({ provider: z.enum(["auto", "groq", "openai", "openrouter"]) });

app.post("/settings/whisper-provider", async (req, res) => {
  const auth = await authenticate(req);
  if (!auth) return res.status(401).json({ error: "unauthorized" });
  const parsed = WhisperProviderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  setWhisperProvider(parsed.data.provider as WhisperProvider);
  return res.json({ ok: true, provider: getWhisperProvider() });
});

app.use(
  "/media",
  express.static(path.resolve(WORK_DIR), {
    fallthrough: false,
    maxAge: "1h",
  }),
);

app.listen(PORT, () => {
  console.log(`[clipforge-worker] listening on :${PORT}`);
  const recoverable = listRecoverableJobs();
  if (recoverable.length) console.log(`[clipforge-worker] restarting ${recoverable.length} interrupted job(s)`);
  for (const job of recoverable) {
    runPipeline(job).catch((err) => console.error(`[pipeline] recovery failed for ${job.id}:`, err));
  }
});
