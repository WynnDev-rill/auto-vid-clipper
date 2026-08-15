import { completeJson, transcribeRemote, type TranscriptResult, type TranscriptSegment } from "./ai-router";
import { deleteSource, deleteStoredJob, getSource, getStoredJob, listStoredJobs, putJob, putSource } from "./local-store";

export type ScoreBreakdown = { hook: number; context: number; emotion: number; value: number; pacing: number; visual: number; prompt: number };
export type ClipMoment = { order: number; video_url: string; thumbnail_url: string; duration_s: number; transcript?: string; start_s: number; end_s: number; score: number; score_breakdown: ScoreBreakdown; reason: string; signals: string[]; caption_segments?: TranscriptSegment[] };
export type ClipJob = {
  id: string; sourceTitle?: string; status: "queued" | "downloading" | "transcribing" | "analyzing" | "rendering" | "cancel_requested" | "cancelled" | "done" | "failed";
  progress: number; clips: ClipMoment[]; error?: string; createdAt: number; startedAt: number; updatedAt: number; stageStartedAt: number; sourceDurationS?: number; completedClips?: number; totalClips?: number; estimatedRemainingS?: number;
};
export type ExportOptions = { clipOrder: number; trimStart?: number; trimEnd?: number; aspectRatio: "9:16" | "1:1" | "16:9"; captionStyle: "modern" | "bold" | "minimal"; captions: boolean; normalizeAudio: boolean; cropMode: "safe" | "fill" };
export type Preferences = { aspectRatio: "9:16" | "1:1" | "16:9"; captionStyle: "modern" | "bold" | "minimal"; captions: boolean; normalizeAudio: boolean; cropMode: "safe" | "fill" };

type StoredJob = ClipJob & { sourceKind: "url" | "upload"; sourceRef: string; resolvedUrl?: string; sourceMime?: string; goal?: string; clipDuration: number; clipCount: number; transcript?: TranscriptResult };
type AiCandidate = { start?: number; end?: number; reason?: string; hook?: number; context?: number; emotion?: number; value?: number; pacing?: number; visual?: number; prompt?: number; score?: number; signals?: string[] };

const PREF_KEY = "clipforge-preferences-v4";
export const DEFAULT_PREFERENCES: Preferences = { aspectRatio: "9:16", captionStyle: "modern", captions: true, normalizeAudio: true, cropMode: "safe" };
const running = new Map<string, Promise<void>>();
const sourceUrls = new Map<string, string>();
const downloadBlobs = new Map<string, Blob>();
let ffmpegPromise: Promise<any> | null = null;

export function getPreferences(): Preferences { try { return { ...DEFAULT_PREFERENCES, ...(JSON.parse(localStorage.getItem(PREF_KEY) || "{}") as Partial<Preferences>) }; } catch { return DEFAULT_PREFERENCES; } }
export function setPreferences(patch: Partial<Preferences>) { const next = { ...getPreferences(), ...patch }; localStorage.setItem(PREF_KEY, JSON.stringify(next)); return next; }

function clamp(value: unknown, min = 0, max = 100) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : min; }
function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  if (/moov atom|ffprobe|invalid data|avformat|codec|wasm|ffmpeg/i.test(message)) return "The video could not be read completely. Try the URL again or upload the video file directly.";
  return message.length > 260 ? `${message.slice(0, 257)}…` : message;
}
function now() { return Date.now(); }
async function patchJob(id: string, patch: Partial<StoredJob>) {
  const job = await getStoredJob<StoredJob>(id); if (!job) throw new Error("Project no longer exists.");
  const next = { ...job, ...patch, updatedAt: now() }; await putJob(next); return next;
}
async function isCancelled(id: string) { const job = await getStoredJob<StoredJob>(id); return !job || job.status === "cancel_requested" || job.status === "cancelled"; }
function withFragment(url: string, start: number, end: number) { const clean = url.replace(/#.*$/, ""); return `${clean}#t=${Math.max(0,start).toFixed(2)},${Math.max(start,end).toFixed(2)}`; }
async function sourcePreviewUrl(job: StoredJob) {
  if (job.sourceKind === "url") return job.resolvedUrl || job.sourceRef;
  const cached = sourceUrls.get(job.sourceRef); if (cached) return cached;
  const source = await getSource(job.sourceRef); if (!source) return "";
  const url = URL.createObjectURL(source.blob); sourceUrls.set(job.sourceRef, url); return url;
}
async function hydrate(job: StoredJob): Promise<ClipJob> {
  const sourceUrl = await sourcePreviewUrl(job);
  return { ...job, clips: job.clips.map((clip) => ({ ...clip, video_url: sourceUrl ? withFragment(sourceUrl, clip.start_s, clip.end_s) : "" })) };
}

export async function uploadVideo(file: File, onProgress?: (percent: number) => void) {
  const id = `src_${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 60); onProgress?.(5);
  await putSource({ id, name: file.name, type: file.type || "video/mp4", size: file.size, blob: file, createdAt: now() }); onProgress?.(100);
  return { id, size: file.size };
}
export async function createJob(input: { sourceUrl?: string; uploadId?: string; sourceTitle?: string; clipDuration: number; clipCount: number; goal?: string }) {
  if (!input.sourceUrl && !input.uploadId) throw new Error("Choose a video first.");
  const id = `job_${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 60), time = now();
  const job: StoredJob = { id, sourceTitle: input.sourceTitle, sourceKind: input.uploadId ? "upload" : "url", sourceRef: input.uploadId || input.sourceUrl || "", goal: input.goal, clipDuration: input.clipDuration, clipCount: input.clipCount, status: "queued", progress: 1, clips: [], createdAt: time, startedAt: time, updatedAt: time, stageStartedAt: time };
  await putJob(job); void ensureProcessing(id); return { id };
}

async function resolveUrl(raw: string) {
  const response = await fetch(`/api/resolve?url=${encodeURIComponent(raw)}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({})) as { url?: string; title?: string; duration?: number; error?: string };
  if (!response.ok || !data.url) throw new Error(data.error || "ClipForge could not resolve this video URL.");
  return data;
}
async function mediaDuration(input: string | Blob) {
  return new Promise<number>((resolve) => {
    const video = document.createElement("video"), url = typeof input === "string" ? input : URL.createObjectURL(input); video.preload = "metadata"; video.muted = true; video.playsInline = true;
    const finish = (value: number) => { if (typeof input !== "string") URL.revokeObjectURL(url); video.remove(); resolve(value); };
    const timer = window.setTimeout(() => finish(0), 12_000); video.onloadedmetadata = () => { clearTimeout(timer); finish(Number.isFinite(video.duration) ? video.duration : 0); }; video.onerror = () => { clearTimeout(timer); finish(0); }; video.src = url;
  });
}
function pseudoSegments(transcript: TranscriptResult, duration: number): TranscriptSegment[] {
  if (transcript.segments.length) return transcript.segments;
  const sentences = transcript.text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean); if (!sentences.length) return [];
  const totalChars = sentences.reduce((sum,s) => sum + s.length, 0) || 1; let cursor = 0;
  return sentences.map((text) => { const span = duration * (text.length / totalChars), item = { start: cursor, end: Math.min(duration, cursor + Math.max(1.2, span)), text }; cursor = item.end; return item; });
}
function transcriptForPrompt(segments: TranscriptSegment[], fallback: string) {
  if (!segments.length) return fallback.slice(0, 80_000);
  const lines = segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`); let out = "";
  for (const line of lines) { if (out.length + line.length > 100_000) break; out += `${line}\n`; } return out;
}
function parseJson(text: string): any {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(clean); } catch {}
  const first = clean.indexOf("{"); const last = clean.lastIndexOf("}"); if (first >= 0 && last > first) try { return JSON.parse(clean.slice(first,last+1)); } catch {}
  const a = clean.indexOf("["); const b = clean.lastIndexOf("]"); if (a >= 0 && b > a) try { return { candidates: JSON.parse(clean.slice(a,b+1)) }; } catch {}
  return null;
}
function overlap(a: {start_s:number;end_s:number}, b: {start_s:number;end_s:number}) { return Math.max(0, Math.min(a.end_s,b.end_s) - Math.max(a.start_s,b.start_s)) / Math.max(1, Math.min(a.end_s-a.start_s,b.end_s-b.start_s)); }
function signalsFor(text: string, goal: string) {
  const lower = text.toLowerCase(), signals: string[] = [];
  if (/[!?]/.test(text) || /\b(why|how|never|secret|ternyata|kenapa|bagaimana|jangan|ini dia)\b/i.test(text)) signals.push("strong hook");
  if (/\b(wow|haha|gila|kaget|marah|sedih|senang|amazing|crazy|love|hate)\b/i.test(text)) signals.push("emotion");
  if (/\b(because|therefore|step|reason|karena|jadi|caranya|alasan|pertama|kedua)\b/i.test(text) || /\d/.test(text)) signals.push("useful detail");
  const keys = goal.toLowerCase().split(/\W+/).filter((x) => x.length > 3); if (keys.some((k) => lower.includes(k))) signals.push("matches prompt"); return signals;
}
function heuristicCandidates(segments: TranscriptSegment[], duration: number, count: number, target: number, goal: string): ClipMoment[] {
  if (!segments.length) {
    const step = Math.max(target, duration / Math.max(1,count)); return Array.from({ length: Math.min(count, Math.max(1, Math.floor(duration / Math.max(1,target)))) }, (_,i) => { const start = Math.min(Math.max(0,duration-target), i*step), end = Math.min(duration,start+target); return makeMoment(i,start,end,"Balanced section",[],goal,""); });
  }
  const scored = segments.map((segment) => { const sig = signalsFor(segment.text, goal), words = segment.text.split(/\s+/).length, density = words / Math.max(1,segment.end-segment.start); return { segment, score: 45 + sig.length*12 + Math.min(12,density*3) }; }).sort((a,b) => b.score-a.score);
  const chosen: ClipMoment[] = [];
  for (const item of scored) {
    const center = (item.segment.start + item.segment.end) / 2, start = Math.max(0, Math.min(Math.max(0,duration-target), center-target*0.42)), end = Math.min(duration,start+target);
    if (chosen.some((c) => overlap(c,{start_s:start,end_s:end}) > .45)) continue;
    const text = segments.filter((s) => s.end >= start && s.start <= end).map((s) => s.text).join(" "); chosen.push(makeMoment(chosen.length,start,end,item.segment.text.slice(0,120) || "Strong section",signalsFor(text,goal),goal,text)); if (chosen.length >= count) break;
  }
  return chosen;
}
function makeMoment(order: number, start: number, end: number, reason: string, signals: string[], goal: string, text: string, raw?: AiCandidate, segments: TranscriptSegment[] = []): ClipMoment {
  const localSignals = signals.length ? signals : signalsFor(text,goal), promptHit = localSignals.includes("matches prompt");
  const breakdown: ScoreBreakdown = { hook: clamp(raw?.hook ?? 48 + (localSignals.includes("strong hook") ? 30 : 0)), context: clamp(raw?.context ?? 68), emotion: clamp(raw?.emotion ?? 42 + (localSignals.includes("emotion") ? 35 : 0)), value: clamp(raw?.value ?? 52 + (localSignals.includes("useful detail") ? 28 : 0)), pacing: clamp(raw?.pacing ?? 65), visual: clamp(raw?.visual ?? 50), prompt: clamp(raw?.prompt ?? (goal ? (promptHit ? 88 : 55) : 70)) };
  const computed = Math.round(breakdown.hook*.2 + breakdown.context*.15 + breakdown.emotion*.13 + breakdown.value*.17 + breakdown.pacing*.12 + breakdown.visual*.08 + breakdown.prompt*.15);
  return { order, video_url: "", thumbnail_url: "", duration_s: Math.max(1,Math.round((end-start)*10)/10), transcript: text.trim(), start_s: Math.max(0,start), end_s: Math.max(start+1,end), score: clamp(raw?.score ?? computed), score_breakdown: breakdown, reason: reason || "Strong self-contained moment", signals: raw?.signals?.length ? raw.signals : localSignals, caption_segments: segments.filter((s) => s.end >= start && s.start <= end) };
}
async function rankCandidates(source: string | Blob, transcript: TranscriptResult, duration: number, count: number, target: number, goal: string) {
  const segments = pseudoSegments(transcript,duration), timeline = transcriptForPrompt(segments,transcript.text);
  const prompt = `You are ClipForge's moment selector. Choose ${count} distinct, self-contained short-form moments from a ${duration.toFixed(1)} second video. Target about ${target}s each (15-90s is acceptable). ${goal ? `User priority: ${goal}.` : "Prioritize hook, clear context, payoff, emotion/useful value and non-repetition."}\nReturn JSON only as {"candidates":[{"start":number,"end":number,"reason":string,"hook":0-100,"context":0-100,"emotion":0-100,"value":0-100,"pacing":0-100,"visual":0-100,"prompt":0-100,"score":0-100,"signals":[string]}]}. Do not invent timestamps outside the video. Timeline/transcript:\n${timeline}`;
  try {
    const ai = await completeJson(prompt, transcript.text.trim() ? undefined : source), parsed = parseJson(ai.content), raw: AiCandidate[] = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    const result: ClipMoment[] = [];
    for (const c of raw) {
      const start = Math.max(0, Math.min(duration-1, Number(c.start ?? 0))), proposedEnd = Number(c.end ?? start+target), end = Math.min(duration, Math.max(start+8, proposedEnd)); if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (result.some((x) => overlap(x,{start_s:start,end_s:end}) > .55)) continue;
      const text = segments.filter((s) => s.end >= start && s.start <= end).map((s) => s.text).join(" "); result.push(makeMoment(result.length,start,end,String(c.reason || "Strong moment"),c.signals || [],goal,text,c,segments)); if (result.length >= count) break;
    }
    if (result.length >= Math.min(3,count)) return result.sort((a,b) => b.score-a.score).map((x,i) => ({...x,order:i}));
  } catch (error) { console.warn("[clipforge] remote ranking unavailable; using deterministic fallback", error); }
  return heuristicCandidates(segments,duration,count,target,goal).map((x) => ({ ...x, caption_segments: segments.filter((s) => s.end >= x.start_s && s.start <= x.end_s) }));
}
async function processJob(id: string) {
  try {
    let job = await getStoredJob<StoredJob>(id); if (!job || await isCancelled(id)) return;
    let source: string | Blob;
    if (job.sourceKind === "url") {
      job = await patchJob(id,{ status:"downloading",progress:8,stageStartedAt:now(),error:undefined }); const resolved = await resolveUrl(job.sourceRef); if (await isCancelled(id)) return;
      job = await patchJob(id,{ resolvedUrl:resolved.url,sourceTitle:resolved.title || job.sourceTitle,sourceDurationS:Number(resolved.duration || 0) || undefined,progress:20 }); source = resolved.url;
    } else {
      const record = await getSource(job.sourceRef); if (!record) throw new Error("The local source video is no longer available on this device."); source = record.blob; job = await patchJob(id,{sourceMime:record.type,progress:20});
    }
    let duration = job.sourceDurationS || await mediaDuration(source); if (!duration || !Number.isFinite(duration)) duration = Math.max(job.clipDuration*job.clipCount,60);
    job = await patchJob(id,{ status:"transcribing",progress:28,stageStartedAt:now(),sourceDurationS:duration }); const transcript = await transcribeRemote(source); if (await isCancelled(id)) return;
    job = await patchJob(id,{ transcript,progress:58,status:"analyzing",stageStartedAt:now() }); const clips = await rankCandidates(source,transcript,duration,job.clipCount,job.clipDuration,job.goal || ""); if (await isCancelled(id)) return;
    await patchJob(id,{ status:"rendering",progress:88,stageStartedAt:now(),clips,totalClips:clips.length,completedClips:clips.length });
    await patchJob(id,{ status:"done",progress:100,clips,totalClips:clips.length,completedClips:clips.length,estimatedRemainingS:0 });
  } catch (error) { console.error("[clipforge] analysis failed", error); const existing = await getStoredJob<StoredJob>(id); if (existing && !["cancelled","cancel_requested"].includes(existing.status)) await patchJob(id,{ status:"failed",progress:100,error:cleanError(error) }); }
}
function ensureProcessing(id: string) { const existing = running.get(id); if (existing) return existing; const task = processJob(id).finally(() => running.delete(id)); running.set(id,task); return task; }

export async function getJob(jobId: string) { const job = await getStoredJob<StoredJob>(jobId); if (!job) throw new Error("Project not found."); if (!["done","failed","cancelled","cancel_requested"].includes(job.status)) void ensureProcessing(jobId); return hydrate(job); }
export async function listJobs() { const jobs = await listStoredJobs<StoredJob>(); jobs.sort((a,b) => b.createdAt-a.createdAt); return { jobs: jobs as ClipJob[] }; }
export async function retryJob(jobId: string) { const job = await patchJob(jobId,{ status:"queued",progress:1,error:undefined,clips:[],transcript:undefined,startedAt:now(),stageStartedAt:now() }); void ensureProcessing(jobId); return { id: job.id }; }
export async function cancelJob(jobId: string) { await patchJob(jobId,{status:"cancelled",progress:100,estimatedRemainingS:0}); return { ok:true as const }; }
export async function deleteJob(jobId: string) { const job = await getStoredJob<StoredJob>(jobId); if (job?.sourceKind === "upload") { const url = sourceUrls.get(job.sourceRef); if (url) URL.revokeObjectURL(url); sourceUrls.delete(job.sourceRef); await deleteSource(job.sourceRef); } await deleteStoredJob(jobId); return {ok:true as const}; }

function nativeMediaBridge() {
  return (window as unknown as { ClipForgeNative?: { downloadSource?: (id:string,url:string)=>boolean; getSourceDownloadStatus?: (id:string)=>string; readSourceChunk?: (id:string,offset:number,length:number)=>string; cleanupSource?: (id:string)=>boolean; beginDownload?: (name:string,mime:string)=>string; appendDownloadChunk?: (token:string,data:string)=>boolean; finishDownload?: (token:string)=>boolean; downloadFile?: (url:string,name:string)=>void } }).ClipForgeNative;
}
function b64ToBytes(data: string) { const raw = atob(data), bytes = new Uint8Array(raw.length); for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i); return bytes; }
function bytesToB64(bytes: Uint8Array) { let out=""; const step=0x8000; for (let i=0;i<bytes.length;i+=step) out += String.fromCharCode(...bytes.subarray(i,i+step)); return btoa(out); }
async function nativeFetchBlob(id: string, url: string) {
  const native = nativeMediaBridge(); if (!native?.downloadSource || !native.getSourceDownloadStatus || !native.readSourceChunk) throw new Error("This video host blocks direct download. Try uploading the file instead.");
  if (!native.downloadSource(id,url)) throw new Error("Could not start local video download.");
  let size=0;
  for (let i=0;i<240;i++) { await new Promise((r) => setTimeout(r,500)); const state = JSON.parse(native.getSourceDownloadStatus(id) || "{}") as {status?:string;size?:number;error?:string}; if (state.status === "error") throw new Error(state.error || "Local video download failed."); if (state.status === "done") { size=Number(state.size||0); break; } }
  if (!size) throw new Error("Local video download timed out."); const chunks: Uint8Array[]=[]; const chunkSize=768*1024;
  for (let offset=0;offset<size;offset+=chunkSize) { const data=native.readSourceChunk(id,offset,Math.min(chunkSize,size-offset)); if (!data) throw new Error("Could not read the downloaded video."); chunks.push(b64ToBytes(data)); }
  try { native.cleanupSource?.(id); } catch {} return new Blob(chunks,{type:"video/mp4"});
}
async function sourceBlob(job: StoredJob) {
  if (job.sourceKind === "upload") { const source=await getSource(job.sourceRef); if (!source) throw new Error("The local source video is missing."); return source.blob; }
  const url=job.resolvedUrl || job.sourceRef;
  try { const r=await fetch(url); if (!r.ok) throw new Error(String(r.status)); return await r.blob(); } catch { return nativeFetchBlob(`cf_${job.id}`,url); }
}
async function blobUrl(url: string, type: string) { const r=await fetch(url); if (!r.ok) throw new Error(`Could not load local video engine (${r.status})`); return URL.createObjectURL(new Blob([await r.arrayBuffer()],{type})); }
async function getFfmpeg() {
  if (!ffmpegPromise) ffmpegPromise=(async()=>{
    const mod = await import(/* @vite-ignore */ "https://esm.sh/@ffmpeg/ffmpeg@0.12.15"); const ffmpeg = new mod.FFmpeg();
    const coreURL=await blobUrl("https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js","text/javascript"), wasmURL=await blobUrl("https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm","application/wasm"); await ffmpeg.load({coreURL,wasmURL}); return ffmpeg;
  })(); return ffmpegPromise;
}
function srtTime(seconds: number) { const ms=Math.max(0,Math.round(seconds*1000)), h=Math.floor(ms/3600000), m=Math.floor(ms%3600000/60000), s=Math.floor(ms%60000/1000), x=ms%1000; return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(x).padStart(3,"0")}`; }
function buildSrt(clip: ClipMoment, start: number, end: number) {
  const segs=(clip.caption_segments || []).filter((s)=>s.end>=start&&s.start<=end); if (!segs.length && clip.transcript) return `1\n00:00:00,000 --> ${srtTime(Math.max(1,end-start))}\n${clip.transcript}\n`;
  return segs.map((s,i)=>`${i+1}\n${srtTime(Math.max(0,s.start-start))} --> ${srtTime(Math.min(end-start,Math.max(.2,s.end-start)))}\n${s.text}\n`).join("\n");
}
function videoFilter(options: ExportOptions) {
  const dims=options.aspectRatio==="9:16"?[1080,1920]:options.aspectRatio==="1:1"?[1080,1080]:[1920,1080], [w,h]=dims;
  return options.cropMode==="fill" ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}` : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
}
function captionStyle(style: ExportOptions["captionStyle"]) { return style==="bold"?"FontSize=22,Bold=1,Outline=3,Shadow=1,Alignment=2,MarginV=110":style==="minimal"?"FontSize=16,Outline=1,Shadow=0,Alignment=2,MarginV=90":"FontSize=19,Bold=1,Outline=2,Shadow=1,Alignment=2,MarginV=105"; }
async function localRender(job: StoredJob, clip: ClipMoment, options: ExportOptions) {
  const ffmpeg=await getFfmpeg(), source=await sourceBlob(job), input=`input-${job.id}.bin`, output=`output-${job.id}-${clip.order}.mp4`, captions=`captions-${job.id}-${clip.order}.srt`;
  const bytes=new Uint8Array(await source.arrayBuffer()); await ffmpeg.writeFile(input,bytes);
  const start=Math.max(0,clip.start_s+Number(options.trimStart||0)), end=Math.min(job.sourceDurationS||clip.end_s+10,Math.max(start+1,clip.end_s+Number(options.trimEnd||0))), duration=end-start;
  let vf=videoFilter(options); if (options.captions) { await ffmpeg.writeFile(captions,new TextEncoder().encode(buildSrt(clip,start,end))); vf += `,subtitles=${captions}:force_style='${captionStyle(options.captionStyle)}'`; }
  const base=["-ss",String(start),"-i",input,"-t",String(duration),"-vf",vf]; if (options.normalizeAudio) base.push("-af","loudnorm=I=-16:LRA=11:TP=-1.5"); base.push("-c:v","libx264","-preset","ultrafast","-crf","22","-c:a","aac","-b:a","160k","-movflags","+faststart",output);
  try { await ffmpeg.exec(base); } catch (error) { if (!options.captions) throw error; const retry=["-ss",String(start),"-i",input,"-t",String(duration),"-vf",videoFilter(options)]; if (options.normalizeAudio) retry.push("-af","loudnorm=I=-16:LRA=11:TP=-1.5"); retry.push("-c:v","libx264","-preset","ultrafast","-crf","22","-c:a","aac","-b:a","160k","-movflags","+faststart",output); await ffmpeg.exec(retry); }
  const out=await ffmpeg.readFile(output) as Uint8Array; try { await ffmpeg.deleteFile(input); await ffmpeg.deleteFile(output); if (options.captions) await ffmpeg.deleteFile(captions); } catch {}
  return new Blob([out],{type:"video/mp4"});
}
export async function exportMoment(jobId: string, options: ExportOptions) { const job=await getStoredJob<StoredJob>(jobId); if (!job) throw new Error("Project not found."); const clip=job.clips.find((c)=>c.order===options.clipOrder); if (!clip) throw new Error("Moment not found."); try { const blob=await localRender(job,clip,options), url=URL.createObjectURL(blob); downloadBlobs.set(url,blob); return {exportId:`local_${Date.now()}`,url}; } catch (error) { console.error("[clipforge] local export failed",error); throw new Error(cleanError(error)); } }
export async function exportSubtitles(jobId: string, input: { clipOrder:number;trimStart?:number;trimEnd?:number }) { const job=await getStoredJob<StoredJob>(jobId); if (!job) throw new Error("Project not found."); const clip=job.clips.find((c)=>c.order===input.clipOrder); if (!clip) throw new Error("Moment not found."); const start=Math.max(0,clip.start_s+Number(input.trimStart||0)),end=Math.max(start+1,clip.end_s+Number(input.trimEnd||0)),blob=new Blob([buildSrt(clip,start,end)],{type:"application/x-subrip"}),url=URL.createObjectURL(blob); downloadBlobs.set(url,blob); return {url}; }
async function saveBlobNative(blob: Blob,name: string) { const native=nativeMediaBridge(); if (!native?.beginDownload||!native.appendDownloadChunk||!native.finishDownload) return false; const token=native.beginDownload(name,blob.type||"application/octet-stream"); if (!token) return false; const bytes=new Uint8Array(await blob.arrayBuffer()),chunk=512*1024; for(let i=0;i<bytes.length;i+=chunk) if(!native.appendDownloadChunk(token,bytesToB64(bytes.subarray(i,i+chunk)))) throw new Error("Could not save file"); return native.finishDownload(token); }
export function saveUrl(url: string,name: string) { const blob=downloadBlobs.get(url); if (blob) { void (async()=>{ try { if(await saveBlobNative(blob,name)) return; } catch {} const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove(); })(); return; } const native=nativeMediaBridge(); if(native?.downloadFile&&/^https:\/\//i.test(url)){native.downloadFile(url,name);return;} const a=document.createElement("a");a.href=url;a.download=name;a.target="_blank";a.rel="noopener";document.body.appendChild(a);a.click();a.remove(); }
