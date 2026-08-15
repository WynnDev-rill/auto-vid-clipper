export type TranscriptSegment = { start: number; end: number; text: string };
export type TranscriptResult = { text: string; segments: TranscriptSegment[]; provider: string };
export type PersonalProvider = "auto" | "groq" | "openrouter" | "gemini" | "custom";
export type PersonalAiSettings = { provider: PersonalProvider; baseUrl?: string; hasKey: boolean };
export type PersonalAiTest = { provider: string; chatModel?: string; speechModel?: string; message: string };

const META_KEY = "clipforge-personal-ai-v4";
const WEB_KEY = "clipforge-personal-ai-secret-v4";
const SECRET_NAME = "personal-ai-key";
const OVH_STT_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/audio/transcriptions";
const OVH_ANON_MAX_BYTES = 10 * 1024 * 1024;
let puterPromise: Promise<any> | null = null;
let ovhSpeechCooldownUntil = 0;
const modelCache = new Map<string, { at: number; chat?: string; speech?: string }>();

function nativeBridge() {
  return (window as unknown as { ClipForgeNative?: { storeSecret?: (name: string, value: string) => boolean; getSecret?: (name: string) => string; deleteSecret?: (name: string) => boolean } }).ClipForgeNative;
}
function getSecret() {
  try { const value = nativeBridge()?.getSecret?.(SECRET_NAME); if (value) return value; } catch {}
  return localStorage.getItem(WEB_KEY) || "";
}
function setSecret(value: string) {
  try { if (nativeBridge()?.storeSecret?.(SECRET_NAME, value)) { localStorage.removeItem(WEB_KEY); return; } } catch {}
  localStorage.setItem(WEB_KEY, value);
}
function removeSecret() {
  try { nativeBridge()?.deleteSecret?.(SECRET_NAME); } catch {}
  localStorage.removeItem(WEB_KEY);
}
export function getPersonalAiSettings(): PersonalAiSettings {
  let meta: Omit<PersonalAiSettings, "hasKey"> = { provider: "auto" };
  try { meta = { ...meta, ...(JSON.parse(localStorage.getItem(META_KEY) || "{}") as Partial<PersonalAiSettings>) }; } catch {}
  return { provider: meta.provider || "auto", baseUrl: meta.baseUrl || "", hasKey: Boolean(getSecret()) };
}
export function savePersonalAiSettings(input: { provider: PersonalProvider; baseUrl?: string; apiKey?: string }) {
  localStorage.setItem(META_KEY, JSON.stringify({ provider: input.provider, baseUrl: input.baseUrl?.trim() || "" }));
  if (input.apiKey?.trim()) setSecret(input.apiKey.trim());
  modelCache.clear();
  return getPersonalAiSettings();
}
export function clearPersonalAiSettings() { localStorage.removeItem(META_KEY); removeSecret(); modelCache.clear(); }

async function loadPuter() {
  const current = (window as unknown as { puter?: any }).puter;
  if (current?.ai) return current;
  if (!puterPromise) puterPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-clipforge-puter="1"]');
    if (existing) { existing.addEventListener("load", () => resolve((window as any).puter), { once: true }); existing.addEventListener("error", () => reject(new Error("Puter AI unavailable")), { once: true }); return; }
    const script = document.createElement("script"); script.src = "https://js.puter.com/v2/"; script.async = true; script.dataset.clipforgePuter = "1";
    script.onload = () => resolve((window as any).puter); script.onerror = () => reject(new Error("Puter AI unavailable")); document.head.appendChild(script);
  });
  const puter = await puterPromise;
  if (!puter?.ai) throw new Error("Puter AI unavailable");
  return puter;
}
function textFromChat(value: any): string {
  if (typeof value === "string") return value;
  const content = value?.message?.content ?? value?.choices?.[0]?.message?.content ?? value?.text ?? value?.result;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : item?.text || "").join("\n");
  return "";
}
function normalizeSegments(raw: any, text: string): TranscriptSegment[] {
  const source = raw?.segments ?? raw?.result?.segments ?? raw?.transcription?.segments ?? [];
  if (!Array.isArray(source)) return [];
  return source.map((item: any) => ({ start: Number(item.start ?? item.start_time ?? item.startTime ?? 0), end: Number(item.end ?? item.end_time ?? item.endTime ?? 0), text: String(item.text ?? item.transcript ?? "").trim() })).filter((item) => item.text && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start);
}

async function transcribeOvhAnonymous(source: Blob): Promise<TranscriptResult> {
  if (Date.now() < ovhSpeechCooldownUntil) throw new Error("OVH anonymous speech is cooling down");
  if (source.size > OVH_ANON_MAX_BYTES) throw new Error("OVH anonymous speech payload is too large");
  const ext = source.type.includes("webm") ? "webm" : source.type.includes("wav") ? "wav" : source.type.includes("mpeg") ? "mp3" : "mp4";
  const form = new FormData();
  form.append("file", source, `clipforge.${ext}`);
  form.append("model", "whisper-large-v3");
  form.append("temperature", "0");
  form.append("diarize", "false");
  form.append("timestamp_granularities[]", "segment");
  form.append("response_format", "verbose_json");
  try {
    const response = await fetch(OVH_STT_URL, { method: "POST", headers: { Accept: "application/json" }, body: form });
    if (response.status === 429) { ovhSpeechCooldownUntil = Date.now() + 35_000; throw new Error("OVH anonymous speech is rate limited"); }
    if (!response.ok) throw new Error(`OVH anonymous speech failed (${response.status})`);
    const data = await response.json() as any, text = String(data?.text || "").trim();
    if (!text) throw new Error("OVH anonymous speech returned no transcript");
    return { text, segments: normalizeSegments(data, text), provider: "ovh-anonymous:whisper-large-v3" };
  } catch (error) {
    if (error instanceof TypeError) ovhSpeechCooldownUntil = Date.now() + 5 * 60_000;
    throw error;
  }
}

function resolveProvider(provider: PersonalProvider, key: string, baseUrl?: string): Exclude<PersonalProvider, "auto"> {
  if (provider !== "auto") return provider;
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("sk-or-v1-")) return "openrouter";
  if (key.startsWith("AIza")) return "gemini";
  if (baseUrl) return "custom";
  throw new Error("Could not detect this API key. Choose its provider once in Settings.");
}
function modelScore(id: string) {
  const s = id.toLowerCase();
  let score = 0;
  if (s.includes("flash")) score += 50;
  if (s.includes("llama-3.3")) score += 48;
  if (s.includes("gpt-oss")) score += 45;
  if (s.includes("qwen")) score += 40;
  if (s.includes("mini") || s.includes("small") || s.includes("8b") || s.includes("20b")) score += 18;
  if (s.includes("preview") || s.includes("deprecated")) score -= 12;
  return score;
}
async function resolveModels(provider: Exclude<PersonalProvider, "auto">, key: string, baseUrl?: string, force = false) {
  const cacheKey = `${provider}:${baseUrl || ""}:${key.slice(0, 8)}`;
  const cached = modelCache.get(cacheKey); if (!force && cached && Date.now() - cached.at < 10 * 60_000) return cached;
  let chat: string | undefined, speech: string | undefined;
  if (provider === "groq") {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } }); if (!r.ok) throw new Error(`Groq rejected the key (${r.status})`);
    const ids = ((await r.json()) as any).data?.map((m: any) => String(m.id)) ?? [];
    speech = ids.filter((id: string) => id.toLowerCase().includes("whisper")).sort((a: string,b: string) => Number(b.toLowerCase().includes("turbo")) - Number(a.toLowerCase().includes("turbo")))[0];
    chat = ids.filter((id: string) => !/(whisper|tts|guard|moderation)/i.test(id)).sort((a: string,b: string) => modelScore(b) - modelScore(a))[0];
  } else if (provider === "openrouter") {
    const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${key}` } }); if (!r.ok) throw new Error(`OpenRouter rejected the key (${r.status})`);
    const models = ((await r.json()) as any).data ?? [];
    const free = models.filter((m: any) => Number(m?.pricing?.prompt ?? 1) === 0 && Number(m?.pricing?.completion ?? 1) === 0 && (!m?.architecture?.input_modalities || m.architecture.input_modalities.includes("text")));
    const pool = free.length ? free : models.filter((m: any) => String(m.id).endsWith(":free"));
    chat = pool.sort((a: any,b: any) => (Number(b.context_length || 0) - Number(a.context_length || 0)) || (modelScore(String(b.id)) - modelScore(String(a.id))))[0]?.id;
  } else if (provider === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`); if (!r.ok) throw new Error(`Gemini rejected the key (${r.status})`);
    const models = ((await r.json()) as any).models ?? [];
    const ids = models.filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m: any) => String(m.name).replace(/^models\//, ""));
    chat = ids.sort((a: string,b: string) => modelScore(b) - modelScore(a))[0];
  } else {
    const base = String(baseUrl || "").replace(/\/$/, ""); if (!/^https:\/\//i.test(base)) throw new Error("Custom provider needs an HTTPS OpenAI-compatible Base URL.");
    const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } }); if (!r.ok) throw new Error(`Custom provider rejected the key (${r.status})`);
    const ids = ((await r.json()) as any).data?.map((m: any) => String(m.id)) ?? [];
    chat = ids.filter((id: string) => !/whisper/i.test(id)).sort((a: string,b: string) => modelScore(b) - modelScore(a))[0]; speech = ids.find((id: string) => /whisper|transcrib|speech/i.test(id));
  }
  if (!chat && !speech) throw new Error("No usable model was found for this provider.");
  const result = { at: Date.now(), chat, speech }; modelCache.set(cacheKey, result); return result;
}
async function personalChat(prompt: string, forceModels = false) {
  const meta = getPersonalAiSettings(), key = getSecret(); if (!key) throw new Error("No personal API fallback is configured.");
  const provider = resolveProvider(meta.provider, key, meta.baseUrl), models = await resolveModels(provider, key, meta.baseUrl, forceModels); if (!models.chat) throw new Error(`${provider} has no suitable chat model.`);
  if (provider === "gemini") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(models.chat)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.15, responseMimeType: "application/json" } }) });
    if (!r.ok) throw new Error(`Gemini model failed (${r.status})`); const data = await r.json() as any; return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
  }
  const base = provider === "groq" ? "https://api.groq.com/openai/v1" : provider === "openrouter" ? "https://openrouter.ai/api/v1" : String(meta.baseUrl).replace(/\/$/, "");
  const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(provider === "openrouter" ? { "X-Title": "ClipForge" } : {}) }, body: JSON.stringify({ model: models.chat, messages: [{ role: "system", content: "Return only valid JSON when JSON is requested." }, { role: "user", content: prompt }], temperature: 0.15, response_format: { type: "json_object" } }) });
  if (!r.ok) throw new Error(`${provider} model failed (${r.status})`); return textFromChat(await r.json());
}
async function personalTranscribe(source: Blob, forceModels = false): Promise<TranscriptResult> {
  const meta = getPersonalAiSettings(), key = getSecret(); if (!key) throw new Error("No personal API fallback is configured.");
  const provider = resolveProvider(meta.provider, key, meta.baseUrl), models = await resolveModels(provider, key, meta.baseUrl, forceModels);
  if (provider !== "groq" && provider !== "custom") throw new Error(`${provider} does not expose a compatible speech-to-text endpoint in ClipForge.`);
  const base = provider === "groq" ? "https://api.groq.com/openai/v1" : String(meta.baseUrl).replace(/\/$/, "");
  const form = new FormData(); form.append("file", source, "clipforge-source.mp4"); form.append("model", models.speech || "whisper-1"); form.append("response_format", "verbose_json");
  const r = await fetch(`${base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form }); if (!r.ok) throw new Error(`${provider} transcription failed (${r.status})`);
  const data = await r.json() as any, text = String(data.text || data.transcription || ""); return { text, segments: normalizeSegments(data, text), provider: `${provider}:${models.speech || "auto"}` };
}

export async function transcribeRemote(source: string | Blob): Promise<TranscriptResult> {
  let blob: Blob | undefined = typeof source === "string" ? undefined : source;
  if (blob && blob.size <= OVH_ANON_MAX_BYTES) {
    try { return await transcribeOvhAnonymous(blob); }
    catch (error) { console.warn("[ai-router] OVH anonymous speech failed", error); }
  }
  try {
    const puter = await loadPuter(); const raw = await puter.ai.speech2txt(source); const text = String(raw?.text ?? raw?.transcription ?? raw?.result?.text ?? raw?.result ?? (typeof raw === "string" ? raw : ""));
    if (text.trim()) return { text: text.trim(), segments: normalizeSegments(raw, text), provider: "puter" };
  } catch (error) { console.warn("[ai-router] Puter speech failed", error); }
  if (getPersonalAiSettings().hasKey) {
    if (!blob) { const r = await fetch(source as string); if (!r.ok) throw new Error("Could not read the video for personal transcription."); blob = await r.blob(); }
    try { return await personalTranscribe(blob); } catch (first) { console.warn("[ai-router] personal speech first attempt failed", first); return personalTranscribe(blob, true); }
  }
  throw new Error("Remote speech services are temporarily unavailable. Add one optional API key in Settings for emergency fallback, or try again later.");
}

export async function completeJson(prompt: string, media?: string | Blob): Promise<{ content: string; provider: string }> {
  try {
    const puter = await loadPuter(); const raw = media ? await puter.ai.chat(prompt, media, { stream: false }) : await puter.ai.chat(prompt, { stream: false }); const content = textFromChat(raw); if (content.trim()) return { content, provider: "puter" };
  } catch (error) { console.warn("[ai-router] Puter chat failed", error); }
  try {
    const r = await fetch("/api/community-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) }); if (r.ok) { const data = await r.json() as { content?: string; provider?: string }; if (data.content) return { content: data.content, provider: data.provider || "community" }; }
  } catch (error) { console.warn("[ai-router] community pool failed", error); }
  if (getPersonalAiSettings().hasKey) {
    try { return { content: await personalChat(prompt), provider: "personal" }; } catch (first) { console.warn("[ai-router] personal chat first attempt failed", first); return { content: await personalChat(prompt, true), provider: "personal" }; }
  }
  throw new Error("All remote AI providers are busy right now.");
}

export async function testPersonalAi(input: { provider: PersonalProvider; baseUrl?: string; apiKey?: string }): Promise<PersonalAiTest> {
  if (input.apiKey?.trim()) savePersonalAiSettings(input); else savePersonalAiSettings({ provider: input.provider, baseUrl: input.baseUrl });
  const key = getSecret(); if (!key) throw new Error("Enter an API key first.");
  const provider = resolveProvider(input.provider, key, input.baseUrl), models = await resolveModels(provider, key, input.baseUrl, true);
  if (!models.chat && !models.speech) throw new Error("No usable model found.");
  return { provider, chatModel: models.chat, speechModel: models.speech, message: models.chat ? "Connected. Free/compatible models are selected automatically." : "Connected for speech fallback." };
}
