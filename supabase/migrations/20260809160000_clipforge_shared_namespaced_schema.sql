-- ClipForge shares this Supabase project with other apps. Every ClipForge-owned
-- object is namespaced; this migration intentionally never replaces auth.users
-- triggers or generic public tables used by other apps.

CREATE OR REPLACE FUNCTION public.clipforge_update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TABLE IF NOT EXISTS public.clipforge_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clipforge_user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'dark',
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clipforge_youtube_connections (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id TEXT,
  channel_title TEXT,
  channel_thumbnail TEXT,
  refresh_token_ciphertext TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scopes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clipforge_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('youtube_url', 'upload')),
  source_url TEXT,
  source_upload_path TEXT,
  source_title TEXT,
  clip_duration INT NOT NULL,
  clip_count INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0,
  stage TEXT,
  backend_job_id TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  stage_started_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  source_duration_s DOUBLE PRECISION,
  estimated_remaining_s INTEGER,
  completed_clips INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clipforge_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.clipforge_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  subtitle_template TEXT NOT NULL DEFAULT 'modern',
  subtitle_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_url TEXT,
  thumbnail_text TEXT,
  video_url TEXT,
  duration_s INT,
  order_index INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clipforge_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID NOT NULL REFERENCES public.clipforge_clips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  youtube_video_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT,
  description TEXT,
  simulated BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clipforge_profiles, public.clipforge_user_settings,
  public.clipforge_youtube_connections, public.clipforge_jobs, public.clipforge_clips, public.clipforge_uploads
  TO authenticated;

ALTER TABLE public.clipforge_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clipforge_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clipforge_youtube_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clipforge_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clipforge_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clipforge_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clipforge own profile" ON public.clipforge_profiles;
CREATE POLICY "clipforge own profile" ON public.clipforge_profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "clipforge own settings" ON public.clipforge_user_settings;
CREATE POLICY "clipforge own settings" ON public.clipforge_user_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "clipforge own youtube connection" ON public.clipforge_youtube_connections;
CREATE POLICY "clipforge own youtube connection" ON public.clipforge_youtube_connections FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "clipforge own jobs" ON public.clipforge_jobs;
CREATE POLICY "clipforge own jobs" ON public.clipforge_jobs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "clipforge own clips" ON public.clipforge_clips;
CREATE POLICY "clipforge own clips" ON public.clipforge_clips FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "clipforge own uploads" ON public.clipforge_uploads;
CREATE POLICY "clipforge own uploads" ON public.clipforge_uploads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS clipforge_jobs_user_created_idx ON public.clipforge_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clipforge_jobs_user_status_created_idx ON public.clipforge_jobs (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS clipforge_clips_user_created_idx ON public.clipforge_clips (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clipforge_clips_job_idx ON public.clipforge_clips (job_id);
CREATE INDEX IF NOT EXISTS clipforge_uploads_user_created_idx ON public.clipforge_uploads (user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clipforge_profiles_updated') THEN
    CREATE TRIGGER clipforge_profiles_updated BEFORE UPDATE ON public.clipforge_profiles FOR EACH ROW EXECUTE FUNCTION public.clipforge_update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clipforge_user_settings_updated') THEN
    CREATE TRIGGER clipforge_user_settings_updated BEFORE UPDATE ON public.clipforge_user_settings FOR EACH ROW EXECUTE FUNCTION public.clipforge_update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clipforge_youtube_connections_updated') THEN
    CREATE TRIGGER clipforge_youtube_connections_updated BEFORE UPDATE ON public.clipforge_youtube_connections FOR EACH ROW EXECUTE FUNCTION public.clipforge_update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clipforge_jobs_updated') THEN
    CREATE TRIGGER clipforge_jobs_updated BEFORE UPDATE ON public.clipforge_jobs FOR EACH ROW EXECUTE FUNCTION public.clipforge_update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clipforge_clips_updated') THEN
    CREATE TRIGGER clipforge_clips_updated BEFORE UPDATE ON public.clipforge_clips FOR EACH ROW EXECUTE FUNCTION public.clipforge_update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clipforge_uploads_updated') THEN
    CREATE TRIGGER clipforge_uploads_updated BEFORE UPDATE ON public.clipforge_uploads FOR EACH ROW EXECUTE FUNCTION public.clipforge_update_updated_at_column();
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clipforge-source-videos', 'clipforge-source-videos', false, 524288000, ARRAY['video/mp4', 'video/quicktime'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "clipforge users upload own source videos" ON storage.objects;
CREATE POLICY "clipforge users upload own source videos" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'clipforge-source-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "clipforge users read own source videos" ON storage.objects;
CREATE POLICY "clipforge users read own source videos" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'clipforge-source-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "clipforge users delete own source videos" ON storage.objects;
CREATE POLICY "clipforge users delete own source videos" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'clipforge-source-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

REVOKE EXECUTE ON FUNCTION public.clipforge_update_updated_at_column() FROM PUBLIC, anon, authenticated;
