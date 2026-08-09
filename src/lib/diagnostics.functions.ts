import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLIPFORGE_SUPABASE_URL } from "@/integrations/supabase/config";

export const getDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const env = {
      SUPABASE_URL: true,
      SUPABASE_PUBLISHABLE_KEY: true,
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      GOOGLE_OAUTH_CLIENT_ID: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
      GOOGLE_OAUTH_CLIENT_SECRET: Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET),
      YOUTUBE_TOKEN_ENC_KEY: Boolean(process.env.YOUTUBE_TOKEN_ENC_KEY),
      CLIPFORGE_BACKEND_URL: Boolean(process.env.CLIPFORGE_BACKEND_URL),
      CLIPFORGE_BACKEND_SECRET: Boolean(process.env.CLIPFORGE_BACKEND_SECRET),
      LOVABLE_API_KEY: Boolean(process.env.LOVABLE_API_KEY),
    };

    const clientIdMasked = process.env.GOOGLE_OAUTH_CLIENT_ID
      ? `${process.env.GOOGLE_OAUTH_CLIENT_ID.slice(0, 12)}…${process.env.GOOGLE_OAUTH_CLIENT_ID.slice(-14)}`
      : null;
    const backendUrl = process.env.CLIPFORGE_BACKEND_URL ?? null;

    const { data: connRls, error: rlsErr } = await context.supabase
      .from("clipforge_youtube_connections")
      .select("channel_id, channel_title, scopes, access_token_expires_at, created_at, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();

    let adminRow: null | {
      channel_id: string | null;
      channel_title: string | null;
      created_at: string;
      updated_at: string;
    } = null;
    let adminErr: string | null = null;
    if (env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("clipforge_youtube_connections")
          .select("channel_id, channel_title, created_at, updated_at")
          .eq("user_id", context.userId)
          .maybeSingle();
        if (error) adminErr = error.message;
        adminRow = data ?? null;
      } catch (e) {
        adminErr = e instanceof Error ? e.message : "admin_client_error";
      }
    }

    let apiProbe:
      | { ok: true; channelId: string; channelTitle: string; refreshed: boolean }
      | { ok: false; error: string }
      | { ok: null; reason: string } = { ok: null, reason: "no_connection" };

    if (connRls) {
      try {
        const { data: full } = await context.supabase
          .from("clipforge_youtube_connections")
          .select("access_token, access_token_expires_at, refresh_token_ciphertext")
          .eq("user_id", context.userId)
          .maybeSingle();
        if (!full) throw new Error("row_disappeared");
        const { ensureFreshAccessToken, getMyChannel } = await import("./youtube.server");
        const fresh = await ensureFreshAccessToken({
          access_token: full.access_token,
          access_token_expires_at: full.access_token_expires_at,
          refresh_token_ciphertext: full.refresh_token_ciphertext,
        });
        if (fresh.refreshed) {
          await context.supabase
            .from("clipforge_youtube_connections")
            .update({ access_token: fresh.accessToken, access_token_expires_at: fresh.expiresAt })
            .eq("user_id", context.userId);
        }
        const ch = await getMyChannel(fresh.accessToken);
        apiProbe = { ok: true, channelId: ch.id, channelTitle: ch.title, refreshed: fresh.refreshed };
      } catch (e) {
        apiProbe = { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "unknown" };
      }
    }

    return {
      env,
      supabaseUrl: CLIPFORGE_SUPABASE_URL,
      clientIdMasked,
      backendUrl,
      userId: context.userId,
      connection: connRls,
      connectionError: rlsErr?.message ?? null,
      adminRow,
      adminError: adminErr,
      apiProbe,
      simulationMode: !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET,
    };
  });
