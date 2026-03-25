-- Ensure group branding buckets exist and are usable for group avatar/banner uploads.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'avatars',
    'avatars',
    true,
    10485760,
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  ),
  (
    'headers',
    'headers',
    true,
    15728640,
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  )
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_auth_upload" ON storage.objects;
CREATE POLICY "avatars_auth_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());

DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());

DROP POLICY IF EXISTS "headers_public_read" ON storage.objects;
CREATE POLICY "headers_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'headers');

DROP POLICY IF EXISTS "headers_auth_upload" ON storage.objects;
CREATE POLICY "headers_auth_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'headers');

DROP POLICY IF EXISTS "headers_owner_update" ON storage.objects;
CREATE POLICY "headers_owner_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'headers' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'headers' AND owner = auth.uid());

DROP POLICY IF EXISTS "headers_owner_delete" ON storage.objects;
CREATE POLICY "headers_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'headers' AND owner = auth.uid());
