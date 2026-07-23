ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stage_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_duration_s DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS estimated_remaining_s INTEGER,
  ADD COLUMN IF NOT EXISTS completed_clips INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS jobs_user_status_created_idx
  ON public.jobs (user_id, status, created_at DESC);
