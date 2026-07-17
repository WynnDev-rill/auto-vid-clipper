# ClipForge AI — Build Plan

Full Android-first SaaS UI for turning long videos into vertical shorts and uploading to YouTube. Real auth + YouTube upload; heavy AI/FFmpeg work delegated to your backend URL. All AI text (titles, descriptions, hashtags) via Lovable AI Gateway — no user API keys.

## Stack decisions (from your answers)

- **Video processing**: your external backend. UI calls `POST {BACKEND_URL}/jobs`, polls `GET /jobs/:id`. Until you provide the URL, requests are mocked with a `MOCK_MODE` flag so the whole flow is demoable.
- **AI text**: Lovable AI Gateway (`google/gemini-3-flash-preview`) via server functions. No OpenAI/Whisper key fields in Settings — replaced with connection statuses.
- **Auth**: Lovable Cloud (Supabase) for app login + Google sign-in. Separate YouTube OAuth flow using **your** Google Cloud OAuth client (needs `youtube.upload` scope — Lovable-managed Google login can't grant this).
- **DB**: Supabase tables for jobs, clips, uploads, settings.

## Design

Dark-first, mobile-first. Deep navy background, purple→blue gradient accents, rounded-2xl cards, subtle glow shadows, animated progress bars (Framer Motion), bottom nav on mobile / collapsible sidebar on wider screens. Font pair: Space Grotesk (display) + Inter (body). Semantic tokens in `src/styles.css`; no hardcoded colors in components.

## Routes (TanStack Start)

Public:
- `/` — landing (hero, features, CTA)
- `/auth` — email + Google sign-in

Protected under `_authenticated/`:
- `/dashboard` — channel card, stats, active jobs, recent uploads
- `/create` — source video (URL or upload), duration + count picker
- `/clips/$jobId` — clip editor: preview, subtitle template + style, title/desc/hashtags (AI-generated, editable), thumbnail editor
- `/upload/$clipId` — visibility, schedule, tags, upload/draft/schedule actions
- `/history` — filterable list, re-upload / download / delete
- `/analytics` — usage metrics with recharts
- `/settings` — Google + YouTube connection cards, theme, notifications, logout

Server routes:
- `/api/public/youtube/callback` — YouTube OAuth callback (exchanges code, stores refresh token)

## Data model (Supabase migration)

- `profiles` (id → auth.users, display_name, avatar_url)
- `youtube_connections` (user_id, channel_id, channel_title, access_token_expires_at, refresh_token_ciphertext, scopes)
- `jobs` (id, user_id, source_type, source_url, clip_duration, clip_count, status, progress, backend_job_id, created_at)
- `clips` (id, job_id, user_id, title, description, hashtags[], subtitle_template, subtitle_style jsonb, thumbnail_url, video_url, duration_s, status)
- `uploads` (id, clip_id, user_id, youtube_video_id, visibility, scheduled_for, status, uploaded_at)
- `user_settings` (user_id, theme, notifications_enabled)

RLS: owner-only on all tables. Refresh tokens stored **encrypted** with a `YOUTUBE_TOKEN_ENC_KEY` secret (AES-256-GCM helper in `*.server.ts`).

## Server functions

- `startJob({ sourceUrl|uploadKey, duration, count })` → POSTs to backend (or mocks), inserts `jobs` row.
- `pollJob(jobId)` → GETs backend status, upserts `clips`.
- `generateMetadata(clipId)` → Lovable AI: returns title/description/hashtags/tags (Zod-validated structured output).
- `generateThumbnailText(clipId)` → Lovable AI: 3 punchy thumbnail headline options.
- `saveClipEdits(clipId, patch)`
- `uploadToYouTube(clipId, { visibility, scheduledFor, title, description, tags })` → refresh access token, YouTube Data API v3 `videos.insert` (resumable upload), records `uploads` row.
- `disconnectYouTube()`
- All protected with `requireSupabaseAuth`.

## Secrets you'll add later (via secure form when we reach that step)

- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (your Google Cloud project)
- `YOUTUBE_TOKEN_ENC_KEY` (generated for you)
- `CLIPFORGE_BACKEND_URL`, `CLIPFORGE_BACKEND_SECRET` (your FFmpeg/Whisper worker)

Until secrets exist, YouTube connect + backend calls show a clean "Setup needed" state instead of erroring.

## Mocks

- `MOCK_MODE=true` when `CLIPFORGE_BACKEND_URL` unset: job progresses through `queued → transcribing → analyzing → rendering → done` on a timer; clips get placeholder vertical video + generated poster.
- YouTube upload in mock mode returns a fake video id and marks upload as "simulated".

## Coding structure

```
src/
  components/          shell, nav, cards, progress, subtitle-preview, thumbnail-editor, forms
  routes/              file-based routes above
  lib/
    *.functions.ts     server functions (client-safe imports)
    *.server.ts        crypto, youtube client, backend client
    ai-gateway.server.ts
  hooks/               useYouTubeConnection, useJobPolling, useMobile
  types/               shared zod schemas + TS types
```

TypeScript strict, Zod on every server function input, react-hook-form for forms, TanStack Query for reads/mutations, Framer Motion for transitions.

## Build order (single turn)

1. Enable Lovable Cloud + provision `LOVABLE_API_KEY`.
2. Migration for tables + RLS + grants + encryption helper.
3. Design tokens (`src/styles.css`), root layout with bottom nav / sidebar, protected layout.
4. Landing + auth pages (Google + email).
5. Dashboard, Create, Clip editor, Upload, History, Analytics, Settings pages.
6. Server functions (all mocked-friendly, real where possible).
7. YouTube OAuth server route + connect/disconnect UI.
8. `head()` metadata per public route, hero image for OG on landing.

## Explicitly deferred

- Real FFmpeg cutting, Whisper transcription, speaker-active zoom, silence removal, transition rendering — all live on **your** backend; the app hands off + polls.
- Advanced thumbnail canvas (Fabric.js-style) — v1 ships a template picker + text overlay editor; freeform canvas can come later.
- Push notifications — v1 shows in-app toasts only.

Approve and I'll build it.