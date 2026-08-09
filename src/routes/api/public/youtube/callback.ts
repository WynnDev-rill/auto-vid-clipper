import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/youtube/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) return redirectHtml(`/settings?yt_error=${encodeURIComponent(error)}`);
        if (!code || !state) return redirectHtml(`/settings?yt_error=missing_code`);

        const [userId] = state.split(".");
        if (!userId) return redirectHtml(`/settings?yt_error=bad_state`);

        try {
          const { exchangeCodeForTokens, getMyChannel } = await import("@/lib/youtube.server");
          const { encryptToken } = await import("@/lib/crypto.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const redirectUri = `${url.origin}/api/public/youtube/callback`;
          const tokens = await exchangeCodeForTokens(code, redirectUri);
          if (!tokens.refresh_token) return redirectHtml(`/settings?yt_error=no_refresh_token`);
          const channel = await getMyChannel(tokens.access_token);
          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

          const { error: upErr } = await supabaseAdmin.from("clipforge_youtube_connections").upsert({
            user_id: userId,
            channel_id: channel.id,
            channel_title: channel.title,
            channel_thumbnail: channel.thumbnail ?? null,
            refresh_token_ciphertext: encryptToken(tokens.refresh_token),
            access_token: tokens.access_token,
            access_token_expires_at: expiresAt,
            scopes: tokens.scope,
          });
          if (upErr) return redirectHtml(`/settings?yt_error=${encodeURIComponent(upErr.message)}`);
          return redirectHtml(`/settings?yt_connected=1`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown_error";
          return redirectHtml(`/settings?yt_error=${encodeURIComponent(msg.slice(0, 100))}`);
        }
      },
    },
  },
});

function redirectHtml(to: string) {
  return new Response(
    `<!doctype html><meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)})</script>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
