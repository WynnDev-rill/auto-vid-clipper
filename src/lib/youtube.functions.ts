import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getYouTubeConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clipforge_youtube_connections")
      .select("channel_id, channel_title, channel_thumbnail, scopes, access_token_expires_at, created_at, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const expiresAt = data?.access_token_expires_at ? Date.parse(data.access_token_expires_at) : 0;
    const ready = Boolean(data && expiresAt - Date.now() > 120_000);
    return {
      connection: data,
      ready,
      needsReconnect: Boolean(data && !ready),
    };
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
