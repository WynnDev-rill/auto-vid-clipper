import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getYouTubeConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("clipforge_youtube_connections")
      .select("channel_id, channel_title, channel_thumbnail, scopes, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { getYouTubeClientConfig } = await import("./youtube.server");
    return { connection: data, oauthConfigured: getYouTubeClientConfig().configured };
  });

export const startYouTubeConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const { buildYouTubeAuthUrl, getYouTubeClientConfig } = await import("./youtube.server");
    if (!getYouTubeClientConfig().configured) return { url: null, configured: false as const };
    const redirectUri = `${data.origin.replace(/\/$/, "")}/api/public/youtube/callback`;
    const state = `${context.userId}.${crypto.randomUUID()}`;
    return { url: buildYouTubeAuthUrl(redirectUri, state), configured: true as const };
  });

export const disconnectYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("clipforge_youtube_connections")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
