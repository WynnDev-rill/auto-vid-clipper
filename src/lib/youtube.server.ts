// Server-only YouTube OAuth + Data API v3 helpers.
import { decryptToken } from "./crypto.server";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "openid",
  "email",
  "profile",
].join(" ");

export function getYouTubeClientConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const configured = Boolean(clientId && clientSecret);
  return { clientId, clientSecret, configured };
}

export function buildYouTubeAuthUrl(redirectUri: string, state: string) {
  const { clientId } = getYouTubeClientConfig();
  if (!clientId) throw new Error("Google OAuth client not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getYouTubeClientConfig();
  if (!clientId || !clientSecret) throw new Error("Google OAuth client not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
    id_token?: string;
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getYouTubeClientConfig();
  if (!clientId || !clientSecret) throw new Error("Google OAuth client not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number; scope: string };
}

export async function getMyChannel(accessToken: string) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Fetching channel failed: ${await res.text()}`);
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error("No YouTube channel found for this account");
  return {
    id: item.id as string,
    title: item.snippet.title as string,
    thumbnail: item.snippet.thumbnails?.default?.url as string | undefined,
  };
}

export async function ensureFreshAccessToken(row: {
  access_token: string | null;
  access_token_expires_at: string | null;
  refresh_token_ciphertext: string;
}) {
  const now = Date.now();
  const expiresAt = row.access_token_expires_at ? Date.parse(row.access_token_expires_at) : 0;
  if (row.access_token && expiresAt - now > 60_000) {
    return { accessToken: row.access_token, expiresAt: new Date(expiresAt).toISOString(), refreshed: false };
  }
  const refreshToken = decryptToken(row.refresh_token_ciphertext);
  const fresh = await refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
  return { accessToken: fresh.access_token, expiresAt: newExpiresAt, refreshed: true };
}
