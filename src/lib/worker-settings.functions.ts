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

const DEFAULT_BACKEND_URL = "https://auto-vid-clipper.onrender.com";

async function callBackend(pathname: string, accessToken: string, init?: RequestInit) {
  const url = process.env.CLIPFORGE_BACKEND_URL || DEFAULT_BACKEND_URL;
  const res = await fetch(`${url.replace(/\/$/, "")}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Backend ${pathname} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export const getWhisperProviderInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhisperProviderInfo> => {
    const empty: WhisperProviderInfo = {
      configured: false,
      provider: "auto",
      lastUsedProvider: null,
      lastUsedAt: null,
      available: { groq: false, openai: false, openrouter: false },
      autoOrder: ["groq", "openai", "openrouter"],
    };
    try {
      const data = await callBackend("/settings/whisper-provider", context.accessToken);
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
  .handler(async ({ data, context }): Promise<{ ok: boolean; provider: WhisperProvider }> => {
    const result = await callBackend("/settings/whisper-provider", context.accessToken, {
      method: "POST",
      body: JSON.stringify({ provider: data.provider }),
    });
    return { ok: true, provider: result.provider as WhisperProvider };
  });
