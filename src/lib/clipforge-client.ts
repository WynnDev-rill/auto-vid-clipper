export type ScoreBreakdown = { hook: number; context: number; emotion: number; value: number; pacing: number; visual: number; prompt: number };
export type ClipMoment = { order: number; video_url: string; thumbnail_url: string; duration_s: number; transcript?: string; start_s: number; end_s: number; score: number; score_breakdown: ScoreBreakdown; reason: string; signals: string[] };
export type ClipJob = {
  id: string; sourceTitle?: string; status: "queued" | "downloading" | "transcribing" | "analyzing" | "rendering" | "cancel_requested" | "cancelled" | "done" | "failed";
  progress: number; clips: ClipMoment[]; error?: string; createdAt: number; startedAt: number; updatedAt: number; stageStartedAt: number; sourceDurationS?: number; completedClips?: number; totalClips?: number; estimatedRemainingS?: number;
};
export type ExportOptions = { clipOrder: number; trimStart?: number; trimEnd?: number; aspectRatio: "9:16" | "1:1" | "16:9"; captionStyle: "modern" | "bold" | "minimal"; captions: boolean; normalizeAudio: boolean; cropMode: "safe" | "fill" };

const DEFAULT_API = "https://auto-vid-clipper.onrender.com";
const API = String(import.meta.env.VITE_CLIPFORGE_BACKEND_URL || DEFAULT_API).replace(/\/$/, "");
const DEVICE_KEY = "clipforge-device-id-v3";
const PREF_KEY = "clipforge-preferences-v3";
export type Preferences = { aspectRatio: "9:16" | "1:1" | "16:9"; captionStyle: "modern" | "bold" | "minimal"; captions: boolean; normalizeAudio: boolean; cropMode: "safe" | "fill" };
export const DEFAULT_PREFERENCES: Preferences = { aspectRatio: "9:16", captionStyle: "modern", captions: true, normalizeAudio: true, cropMode: "safe" };

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replaceAll("-", "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
    id = `cf_${random}`.slice(0, 72);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
export function getPreferences(): Preferences { try { return { ...DEFAULT_PREFERENCES, ...(JSON.parse(localStorage.getItem(PREF_KEY) || "{}") as Partial<Preferences>) }; } catch { return DEFAULT_PREFERENCES; } }
export function setPreferences(patch: Partial<Preferences>) { const next = { ...getPreferences(), ...patch }; localStorage.setItem(PREF_KEY, JSON.stringify(next)); return next; }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { "X-Device-Id": getDeviceId(), ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) } });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data?.error || `ClipForge backend error (${response.status})`);
  return data as T;
}

export function createJob(input: { sourceUrl?: string; uploadId?: string; sourceTitle?: string; clipDuration: number; clipCount: number; goal?: string }) {
  return api<{ id: string }>("/jobs", { method: "POST", body: JSON.stringify({ ...input, deviceId: getDeviceId() }) });
}
export function uploadVideo(file: File, onProgress?: (percent: number) => void) {
  const uploadId = `up_${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 60);
  return new Promise<{ id: string; size: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("PUT", `${API}/uploads/${encodeURIComponent(uploadId)}`); xhr.setRequestHeader("X-Device-Id", getDeviceId()); xhr.setRequestHeader("X-File-Name", file.name); xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100)); };
    xhr.onerror = () => reject(new Error("Upload connection failed"));
    xhr.onload = () => { try { const data = JSON.parse(xhr.responseText || "{}") as { id?: string; size?: number; error?: string }; if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || `Upload failed (${xhr.status})`); resolve({ id: data.id || uploadId, size: Number(data.size || file.size) }); } catch (error) { reject(error); } };
    xhr.send(file);
  });
}
export function getJob(jobId: string) { return api<ClipJob>(`/jobs/${encodeURIComponent(jobId)}`); }
export function listJobs() { return api<{ jobs: ClipJob[] }>(`/jobs?deviceId=${encodeURIComponent(getDeviceId())}`); }
export function retryJob(jobId: string) { return api<{ id: string }>(`/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }); }
export function cancelJob(jobId: string) { return api<{ ok: true }>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }); }
export function deleteJob(jobId: string) { return api<{ ok: true }>(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }); }
export function exportMoment(jobId: string, options: ExportOptions) { return api<{ exportId: string; url: string }>(`/jobs/${encodeURIComponent(jobId)}/export`, { method: "POST", body: JSON.stringify(options) }); }
export function saveUrl(url: string, name: string) {
  const native = (window as unknown as { ClipForgeNative?: { downloadFile?: (url: string, name: string) => void } }).ClipForgeNative;
  if (native?.downloadFile) { native.downloadFile(url, name); return; }
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.target = "_blank"; anchor.rel = "noopener"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
}
