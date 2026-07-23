# ClipForge Worker

Real video-to-shorts pipeline for ClipForge AI. Runs outside Cloudflare Workers
because it needs FFmpeg, filesystem access, and long-running HTTP.

## Pipeline

1. **Download** the source video (YouTube URL via `@distube/ytdl-core`, or a
   direct URL / uploaded file).
2. **Transcribe** the audio with OpenAI Whisper (`whisper-1`), with word-level
   timestamps.
3. **Score highlights** by sending transcript segments to Lovable AI Gateway
   (Gemini) and asking for the top N viral moments with `start_s` / `end_s`.
4. **Render** each highlight with FFmpeg:
   - Extract `[start_s, end_s]`
   - Crop/scale to 9:16 (1080x1920), keeping the center of the source frame
   - Burn subtitles from the Whisper words (ASS with karaoke-style highlight)
   - Emit an MP4 + a JPG thumbnail
5. **Serve** the artifacts from `GET /media/:jobId/:file`.

## HTTP contract

Matches `src/lib/backend.server.ts` in the Lovable app.

```
POST /jobs                        Authorization: Bearer $BACKEND_SECRET
  { sourceUrl, clipDuration, clipCount, userId, jobId }
  -> 200 { id }

GET  /jobs/:id                    Authorization: Bearer $BACKEND_SECRET
  -> 200 { id, status, progress, clips?: [{ order, video_url, thumbnail_url, duration_s, transcript }], error? }
```

`status` moves through: `queued` → `transcribing` → `analyzing` → `rendering` → `done` (or `failed`).

## Setup

```bash
cp .env.example .env    # fill OPENAI_API_KEY, LOVABLE_API_KEY, BACKEND_SECRET
npm install
npm run dev
```

Requires `ffmpeg` + `ffprobe` on `$PATH` (Docker image includes them).

## Deploy

Any host that runs Node 20 + ffmpeg with persistent disk works: Render,
Railway, Fly.io, a VPS. The `Dockerfile` is ready to push.

Once deployed, set two env vars on the Lovable app:

- `CLIPFORGE_BACKEND_URL` — e.g. `https://clipforge-worker.example.com`
- `CLIPFORGE_BACKEND_SECRET` — same value as the worker's `BACKEND_SECRET`

## Notes

- Job state is persisted atomically in `$STATE_DIR/jobs.json` (outside the
  publicly served `$WORK_DIR`). Active jobs are marked failed after a restart
  so callers can retry them rather than polling work that is no longer running.
  Multi-instance deployments should use a shared Redis or Postgres store instead.
- Rendered clips live on the worker's disk under `$WORK_DIR/<jobId>/`. Clean
  them up on a cron or move to S3/R2 if you need durable storage.
