
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stage_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_duration_s DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS estimated_remaining_s INTEGER,
  ADD COLUMN IF NOT EXISTS completed_clips INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_upload_path TEXT;

CREATE INDEX IF NOT EXISTS jobs_user_status_created_idx
  ON public.jobs (user_id, status, created_at DESC);

DROP POLICY IF EXISTS "users upload own source videos" ON storage.objects;
CREATE POLICY "users upload own source videos" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'source-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "users read own source videos" ON storage.objects;
CREATE POLICY "users read own source videos" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'source-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "users delete own source videos" ON storage.objects;
CREATE POLICY "users delete own source videos" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'source-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
