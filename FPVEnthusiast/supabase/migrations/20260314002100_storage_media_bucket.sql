-- supabase/migrations/20260314_storage_media_bucket.sql
-- Ensure the 'media' storage bucket exists and is publicly readable
-- so marketplace listing images render correctly in the app.

-- 1. Create the bucket if it does not already exist.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,           -- public = getPublicUrl works without signing
  10485760,       -- 10 MB per file
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'image/gif',  'image/heic', 'image/heif',
    'video/mp4',  'video/quicktime', 'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Public read policy: anyone can read objects in this bucket.
DROP POLICY IF EXISTS "media_public_read" ON storage.objects;
CREATE POLICY "media_public_read"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'media' );

-- 3. Authenticated upload: any signed-in user can insert (upload) objects.
DROP POLICY IF EXISTS "media_auth_upload" ON storage.objects;
CREATE POLICY "media_auth_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK ( bucket_id = 'media' );

-- 4. Owner update / delete: users can only mutate their own objects.
--    Objects are stored under paths like  marketplace/<listing_id>/...
--    or  media/<user_id>/...  so we match on the owner metadata.
DROP POLICY IF EXISTS "media_owner_update" ON storage.objects;
CREATE POLICY "media_owner_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING ( bucket_id = 'media' AND owner = auth.uid() );

DROP POLICY IF EXISTS "media_owner_delete" ON storage.objects;
CREATE POLICY "media_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING ( bucket_id = 'media' AND owner = auth.uid() );

-- Verify
SELECT
  id,
  name,
  public,
  (file_size_limit / 1048576)::text || ' MB' AS max_file_size
FROM storage.buckets
WHERE id = 'media';
