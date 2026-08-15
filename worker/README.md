# ClipForge Worker V3

ClipForge's long-running video processor. It is independent of Supabase and does not require AI-provider API keys.

## Pipeline

1. Resolve URL sources with **yt-dlp** or accept direct uploads.
2. Extract mono 16 kHz audio with **FFmpeg**.
3. Transcribe locally with **whisper.cpp**.
4. Detect scene changes and silence with FFmpeg.
5. Rank candidate moments locally using hook, context, emotion, information value, pacing, visual changes, prompt relevance, and diversity.
6. Render lightweight previews for review.
7. Render full-quality output only after the user selects/exports a moment.

## HTTP API

The app creates a random installation ID and sends it in `X-Device-Id`. No account or provider key is required.

- `GET /health`
- `PUT /uploads/:id`
- `POST /jobs`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/retry`
- `POST /jobs/:id/cancel`
- `DELETE /jobs/:id`
- `POST /jobs/:id/export`
- `GET /media/:id`

Job status moves through `queued → downloading → transcribing → analyzing → rendering → done`, with `failed` and `cancelled` terminal states.

## Storage

If `DATABASE_URL` is configured, jobs, uploads, transcripts, previews and exports are stored in PostgreSQL and survive worker restarts. Media is chunked so the worker only uses local disk as temporary scratch space.

Without `DATABASE_URL`, V3 falls back to local state/media storage. This is convenient for local development but should not be considered durable on ephemeral hosts.

## Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

No OpenAI, Groq, OpenRouter, Lovable or Supabase credentials are needed.

## Deployment

The worker runs on Node and can be packaged for Cloud Run, Render, Railway, Fly.io or a VPS. `worker/Dockerfile` is included. For production, use a restart-safe job/worker environment plus persistent PostgreSQL/object storage where available.
