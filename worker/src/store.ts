// In-memory job store. Swap for Redis/Postgres for multi-instance deployments.

export type ClipResult = {
  order: number;
  video_url: string;
  thumbnail_url: string;
  duration_s: number;
  transcript?: string;
};

export type JobStatus =
  | "queued"
  | "transcribing"
  | "analyzing"
  | "rendering"
  | "done"
  | "failed";

export type Job = {
  id: string;
  appJobId: string;
  userId: string;
  sourceUrl?: string;
  clipDuration: number;
  clipCount: number;
  status: JobStatus;
  progress: number;
  clips: ClipResult[];
  error?: string;
  createdAt: number;
};

const jobs = new Map<string, Job>();

export function createJob(init: Omit<Job, "status" | "progress" | "clips" | "createdAt">): Job {
  const job: Job = {
    ...init,
    status: "queued",
    progress: 0,
    clips: [],
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string) {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Job>) {
  const cur = jobs.get(id);
  if (!cur) return;
  jobs.set(id, { ...cur, ...patch });
}
