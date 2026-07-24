import fs from "node:fs";
import OpenAI from "openai";
import { getWhisperProvider, setLastUsedProvider, type WhisperProvider } from "./settings.js";

export type Word = { word: string; start: number; end: number };
export type Segment = { text: string; start: number; end: number };
export type Transcript = { text: string; words: Word[]; segments: Segment[] };

type ProviderKey = "groq" | "openai" | "openrouter";

type ProviderConfig = {
  key: ProviderKey;
  label: string;
  envKey: string;
  baseURL: string;
  model: string;
  defaultHeaders?: Record<string, string>;
};

const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  groq: {
    key: "groq",
    label: "Groq",
    envKey: "GROQ_API_KEY",
    baseURL: "https://api.groq.com/openai/v1",
    model: process.env.GROQ_WHISPER_MODEL ?? "whisper-large-v3",
  },
  openai: {
    key: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.OPENAI_WHISPER_MODEL ?? "whisper-1",
  },
  openrouter: {
    key: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    model: process.env.OPENROUTER_WHISPER_MODEL ?? "openai/whisper-1",
    defaultHeaders: {
      "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://clipforge.ai",
      "X-Title": process.env.OPENROUTER_TITLE ?? "ClipForge AI Worker",
    },
  },
};

const AUTO_ORDER: ProviderKey[] = ["groq", "openai", "openrouter"];

export function listProviderAvailability(): Record<ProviderKey, boolean> {
  return {
    groq: Boolean(process.env[PROVIDERS.groq.envKey]),
    openai: Boolean(process.env[PROVIDERS.openai.envKey]),
    openrouter: Boolean(process.env[PROVIDERS.openrouter.envKey]),
  };
}

function isRetryable(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { status?: number; code?: string; name?: string; message?: string };
  const status = anyErr.status;
  if (typeof status === "number") {
    // rate limit, timeout, insufficient balance, server errors
    if (status === 402 || status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }
  const code = (anyErr.code ?? "").toString().toLowerCase();
  if (["etimedout", "econnreset", "econnrefused", "enotfound", "eai_again"].includes(code)) {
    return true;
  }
  if (anyErr.name === "AbortError") return true;
  const msg = (anyErr.message ?? "").toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("rate limit") ||
    msg.includes("insufficient") ||
    msg.includes("balance") ||
    msg.includes("quota") ||
    msg.includes("server error") ||
    msg.includes("bad gateway") ||
    msg.includes("unavailable")
  ) {
    return true;
  }
  return false;
}

function clientFor(cfg: ProviderConfig, apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: cfg.baseURL,
    defaultHeaders: cfg.defaultHeaders,
  });
}

function resolveOrder(preference: WhisperProvider): ProviderKey[] {
  const availability = listProviderAvailability();
  if (preference === "auto") {
    return AUTO_ORDER.filter((k) => availability[k]);
  }
  // Explicit choice: try chosen first, then fall back to remaining available ones
  // so a rate-limited/failed request still completes.
  const chosen = preference as ProviderKey;
  const rest = AUTO_ORDER.filter((k) => k !== chosen && availability[k]);
  return availability[chosen] ? [chosen, ...rest] : rest;
}

async function transcribeWith(cfg: ProviderConfig, audioPath: string): Promise<Transcript> {
  const apiKey = process.env[cfg.envKey];
  if (!apiKey) throw new Error(`${cfg.label} API key (${cfg.envKey}) is not set`);
  const client = clientFor(cfg, apiKey);
  const res = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: cfg.model,
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });
  const raw = res as unknown as {
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
    segments?: Array<{ text: string; start: number; end: number }>;
  };
  return {
    text: raw.text ?? "",
    words: raw.words ?? [],
    segments: raw.segments ?? [],
  };
}

export async function transcribe(audioPath: string): Promise<Transcript> {
  const preference = getWhisperProvider();
  const order = resolveOrder(preference);
  if (order.length === 0) {
    throw new Error(
      "No Whisper provider is configured. Set at least one of GROQ_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY.",
    );
  }

  let lastError: unknown = null;
  for (const key of order) {
    const cfg = PROVIDERS[key];
    try {
      console.log(`[whisper] trying provider=${cfg.key} model=${cfg.model}`);
      const transcript = await transcribeWith(cfg, audioPath);
      setLastUsedProvider(cfg.key);
      return transcript;
    } catch (err) {
      lastError = err;
      const retryable = isRetryable(err);
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[whisper] provider=${cfg.key} failed (retryable=${retryable}): ${msg}`,
      );
      if (!retryable) {
        // Non-retryable (e.g. bad audio, auth error) — still try next provider
        // per requirements: any failure should fall through.
        continue;
      }
    }
  }
  const finalMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`All Whisper providers failed. Last error: ${finalMsg}`);
}
