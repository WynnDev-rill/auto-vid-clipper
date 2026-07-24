import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WhisperProvider = "auto" | "groq" | "openai" | "openrouter";

export type WhisperProviderInfo = {
  configured: boolean;
  provider: WhisperProvider;
  lastUsedProvider: "groq" | "openai" | "openrouter" | null;
  lastUsedAt: number | null;
  available: { groq: boolean; openai: boolean; openrouter: boolean };
  autoOrder: Array<"groq" | "openai" | "openrouter">;
};

async function callBackend(pathname: string, init?: RequestInit) {
  const url = process.env.CLIPFORGE_BACKEND_URL;
  const secret = process.env.CLIPFORGE_BACKEND_SECRET;
  if (!url) return null;
  const res = await fetch(`${url.replace(/\/$/, "")}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Backend ${pathname} failed: ${await res.text()}`);
  return res.json();
}

export const getWhisperProviderInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<WhisperProviderInfo> => {
    const empty: WhisperProviderInfo = {
      configured: false,
      provider: "auto",
      lastUsedProvider: null,
      lastUsedAt: null,
      available: { groq: false, openai: false, openrouter: false },
      autoOrder: ["groq", "openai", "openrouter"],
    };
    try {
      const data = await callBackend("/settings/whisper-provider");
      if (!data) return empty;
      return { ...empty, configured: true, ...data };
    } catch (err) {
      console.error("[getWhisperProviderInfo] failed:", err);
      return empty;
    }
  });

export const setWhisperProviderPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ provider: z.enum(["auto", "groq", "openai", "openrouter"]) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; provider: WhisperProvider }> => {
    const result = await callBackend("/settings/whisper-provider", {
      method: "POST",
      body: JSON.stringify({ provider: data.provider }),
    });
    if (!result) throw new Error("Backend worker is not configured (CLIPFORGE_BACKEND_URL missing)");
    return { ok: true, provider: result.provider as WhisperProvider };
  });
