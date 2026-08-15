import { loadJobs, saveJob, listJobsForDevice as listPersistentJobs, deleteJobRow } from "./database.js";
import type { Job } from "./types.js";

const jobs = new Map<string, Job>();

export async function initStore() {
  for (const job of await loadJobs()) jobs.set(job.id, job);
  for (const job of jobs.values()) {
    if (["downloading", "transcribing", "analyzing", "rendering"].includes(job.status)) {
      Object.assign(job, {
        status: "queued",
        progress: Math.min(job.progress || 1, 8),
        completedClips: 0,
        estimatedRemainingS: undefined,
        updatedAt: Date.now(),
        stageStartedAt: Date.now(),
      } satisfies Partial<Job>);
      void saveJob(job).catch((error) => console.error("[store] recovery persist failed", error));
    } else if (job.status === "cancel_requested") {
      job.status = "cancelled";
      job.updatedAt = Date.now();
      job.stageStartedAt = Date.now();
      void saveJob(job).catch((error) => console.error("[store] cancel recovery persist failed", error));
    }
  }
}

function persist(job: Job) {
  void saveJob(job).catch((error) => console.error(`[store] persist failed for ${job.id}:`, error));
}

export function createJob(init: Omit<Job, "status" | "progress" | "clips" | "createdAt" | "startedAt" | "updatedAt" | "stageStartedAt" | "completedClips">) {
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
  persist(job);
  return job;
}

export function getJob(id: string) { return jobs.get(id); }

export async function listJobsForDevice(deviceId: string) {
  const persisted = await listPersistentJobs(deviceId);
  for (const job of persisted) jobs.set(job.id, job);
  return persisted;
}

export function listRecoverableJobs() {
  return [...jobs.values()].filter((job) => job.status === "queued" && Boolean(job.sourceUrl || job.uploadId));
}

export function updateJob(id: string, patch: Partial<Job>) {
  const current = jobs.get(id);
  if (!current) return;
  const stageChanged = patch.status && patch.status !== current.status;
  const next: Job = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
    stageStartedAt: stageChanged ? Date.now() : current.stageStartedAt,
  };
  jobs.set(id, next);
  persist(next);
  return next;
}

export function requestCancellation(id: string) {
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

export async function deleteJob(id: string) {
  jobs.delete(id);
  await deleteJobRow(id);
}
