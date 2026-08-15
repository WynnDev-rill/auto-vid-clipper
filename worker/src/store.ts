import fs from "node:fs";
import path from "node:path";

export type ClipResult = {
  order: number;
  video_url: string;
  thumbnail_url: string;
  duration_s: number;
  transcript?: string;
  score?: number;
  reason?: string;
  signals?: string[];
};

export type JobStatus =
  | "queued"
  | "transcribing"
  | "analyzing"
  | "rendering"
  | "cancel_requested"
  | "cancelled"
  | "done"
  | "failed";

export type Job = {
  id: string;
  appJobId: string;
  userId: string;
  sourceUrl?: string;
  clipDuration: number;
  clipCount: number;
  goal?: string;
  status: JobStatus;
  progress: number;
  clips: ClipResult[];
  error?: string;
  createdAt: number;
  startedAt: number;
  updatedAt: number;
  stageStartedAt: number;
  sourceDurationS?: number;
  completedClips: number;
  estimatedRemainingS?: number;
};

const WORK_DIR = path.resolve(process.env.WORK_DIR || "./.work");
const STORE_DIR = path.resolve(process.env.STATE_DIR || path.join(path.dirname(WORK_DIR), ".clipforge-state"));
const STORE_FILE = path.join(STORE_DIR, "jobs.json");
fs.mkdirSync(STORE_DIR, { recursive: true });

function loadJobs(): Map<string, Job> {
  try {
    const rows = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as Job[];
    return new Map(rows.map((job) => [job.id, job]));
  } catch {
    return new Map();
  }
}

const jobs = loadJobs();

function persist() {
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...jobs.values()], null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

// A Render restart cannot resume FFmpeg mid-command, but it can safely restart
// the deterministic pipeline from the source URL. Preserve pending jobs rather
// than silently converting every restart into a permanent user-facing failure.
for (const job of jobs.values()) {
  if (["transcribing", "analyzing", "rendering"].includes(job.status)) {
    jobs.set(job.id, {
      ...job,
      status: "queued",
      progress: 1,
      clips: [],
      completedClips: 0,
      estimatedRemainingS: undefined,
      updatedAt: Date.now(),
      stageStartedAt: Date.now(),
    });
  } else if (job.status === "cancel_requested") {
    jobs.set(job.id, {
      ...job,
      status: "cancelled",
      estimatedRemainingS: 0,
      updatedAt: Date.now(),
      stageStartedAt: Date.now(),
    });
  }
}
if (jobs.size) persist();

export function createJob(
  init: Omit<Job, "status" | "progress" | "clips" | "createdAt" | "startedAt" | "updatedAt" | "stageStartedAt" | "completedClips">,
): Job {
  const now = Date.now();
  const job: Job = {
    ...init,
    status: "queued",
    progress: 0,
    clips: [],
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    stageStartedAt: now,
    completedClips: 0,
  };
  jobs.set(job.id, job);
  persist();
  return job;
}

export function getJob(id: string) {
  return jobs.get(id);
}

export function listRecoverableJobs() {
  return [...jobs.values()].filter((job) => job.status === "queued" && Boolean(job.sourceUrl));
}

export function updateJob(id: string, patch: Partial<Job>) {
  const current = jobs.get(id);
  if (!current) return;
  const stageChanged = patch.status && patch.status !== current.status;
  jobs.set(id, {
    ...current,
    ...patch,
    updatedAt: Date.now(),
    stageStartedAt: stageChanged ? Date.now() : current.stageStartedAt,
  });
  persist();
}

export function requestCancellation(id: string): boolean {
  const job = jobs.get(id);
  if (!job || ["done", "failed", "cancelled"].includes(job.status)) return false;
  updateJob(id, { status: "cancel_requested" });
  return true;
}

export function throwIfCancelled(id: string) {
  if (jobs.get(id)?.status === "cancel_requested") {
    const error = new Error("Job cancelled");
    error.name = "JobCancelledError";
    throw error;
  }
}
