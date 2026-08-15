// Server-only client for the external FFmpeg/Whisper backend.
// ClipForge has a dedicated Render worker, so production no longer depends on
// an optional Lovable-only environment variable just to dispatch real jobs.

const DEFAULT_BACKEND_URL = "https://auto-vid-clipper.onrender.com";

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
    score?: number;
    reason?: string;
    signals?: string[];
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
  const url = process.env.CLIPFORGE_BACKEND_URL || DEFAULT_BACKEND_URL;
  const secret = process.env.CLIPFORGE_BACKEND_SECRET;
  return { url, secret, configured: Boolean(url) };
}

function authorization(accessToken?: string, secret?: string) {
  const token = accessToken || secret;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createBackendJob(input: {
  sourceUrl?: string;
  uploadKey?: string;
  clipDuration: number;
  clipCount: number;
  goal?: string;
  userId: string;
  jobId: string;
  accessToken?: string;
}): Promise<{ backendJobId: string } | null> {
  const { url, secret, configured } = getBackendConfig();
  if (!configured || !url) return null;
  const { accessToken, ...payload } = input;
  const res = await fetch(`${url.replace(/\/$/, "")}/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authorization(accessToken, secret),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Backend create job failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return { backendJobId: data.id };
}

export async function fetchBackendJob(
  backendJobId: string,
  accessToken?: string,
): Promise<BackendJob | null> {
  const { url, secret, configured } = getBackendConfig();
  if (!configured || !url) return null;
  const res = await fetch(`${url.replace(/\/$/, "")}/jobs/${backendJobId}`, {
    headers: authorization(accessToken, secret),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backend fetch job failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as BackendJob;
}

export async function cancelBackendJob(
  backendJobId: string,
  accessToken?: string,
): Promise<void> {
  const { url, secret, configured } = getBackendConfig();
  if (!configured || !url) return;
  const res = await fetch(`${url.replace(/\/$/, "")}/jobs/${backendJobId}/cancel`, {
    method: "POST",
    headers: authorization(accessToken, secret),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 409)
    throw new Error(`Backend cancel job failed (${res.status}): ${await res.text()}`);
}
