import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const YOUTUBE_PROVIDER_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

export async function persistYouTubeProviderSession(session: Session) {
  const accessToken = session.provider_token;
  if (!accessToken) {
    throw new Error("Google did not return a YouTube access token. Reconnect YouTube and approve the requested permissions.");
  }

  const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not access your YouTube channel (${response.status}): ${body.slice(0, 180)}`);
  }

  const payload = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        thumbnails?: { default?: { url?: string } };
      };
    }>;
  };
  const channel = payload.items?.[0];
  if (!channel?.id) {
    throw new Error("This Google account does not have an accessible YouTube channel.");
  }

  const accessTokenExpiresAt = new Date(Date.now() + 50 * 60 * 1000).toISOString();
  const { error } = await supabase.from("clipforge_youtube_connections").upsert(
    {
      user_id: session.user.id,
      channel_id: channel.id,
      channel_title: channel.snippet?.title ?? "YouTube channel",
      channel_thumbnail: channel.snippet?.thumbnails?.default?.url ?? null,
      refresh_token_ciphertext: "provider-refresh-not-stored",
      access_token: accessToken,
      access_token_expires_at: accessTokenExpiresAt,
      scopes: YOUTUBE_PROVIDER_SCOPES,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`Could not save YouTube connection: ${error.message}`);

  return {
    channelId: channel.id,
    channelTitle: channel.snippet?.title ?? "YouTube channel",
    expiresAt: accessTokenExpiresAt,
  };
}
