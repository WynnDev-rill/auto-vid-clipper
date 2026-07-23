// Server-only client for the external FFmpeg/Whisper backend.
// When CLIPFORGE_BACKEND_URL is not set we return null so callers can fall
// back to a local mock progression.

export type BackendJob = {
  id: string;
  status:
    | "queued"
    | "transcribing"
    | "analyzing"
    | "rendering"
    | "cancel_requested"
    | "cancelled"
    | "done"
    | "failed";
  progress: number;
  clips?: Array<{
    order: number;
    video_url: string;
    thumbnail_url: string;
    duration_s: number;
    transcript?: string;
  }>;
  error?: string;
  startedAt?: number;
  updatedAt?: number;
  stageStartedAt?: number;
  sourceDurationS?: number;
  completedClips?: number;
  totalClips?: number;
  estimatedRemainingS?: number;
};

export function getBackendConfig() {
  const url = process.env.CLIPFORGE_BACKEND_URL;
  const secret = process.env.CLIPFORGE_BACKEND_SECRET;
  return { url, secret, configured: Boolean(url) };
}

export async function createBackendJob(input: {
  sourceUrl?: string;
  uploadKey?: string;
  clipDuration: number;
  clipCount: number;
  userId: string;
  jobId: string;
}): Promise<{ backendJobId: string } | null> {
  const { url, secret, configured } = getBackendConfig();
  if (!configured || !url) return null;
  const res = await fetch(`${url.replace(/\/$/, "")}/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Backend create job failed: ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return { backendJobId: data.id };
}

export async function fetchBackendJob(backendJobId: string): Promise<BackendJob | null> {
  const { url, secret, configured } = getBackendConfig();
  if (!configured || !url) return null;
  const res = await fetch(`${url.replace(/\/$/, "")}/jobs/${backendJobId}`, {
    headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backend fetch job failed: ${await res.text()}`);
  return (await res.json()) as BackendJob;
}

export async function cancelBackendJob(backendJobId: string): Promise<void> {
  const { url, secret, configured } = getBackendConfig();
  if (!configured || !url) return;
  const res = await fetch(`${url.replace(/\/$/, "")}/jobs/${backendJobId}/cancel`, {
    method: "POST",
    headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 409)
    throw new Error(`Backend cancel job failed: ${await res.text()}`);
}
