INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'source-videos',
  'source-videos',
  false,
  524288000,
  ARRAY['video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "users upload own source videos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'source-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "users read own source videos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'source-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "users delete own source videos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'source-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_upload_path TEXT;
