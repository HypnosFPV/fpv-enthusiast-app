-- Fix storage RLS: allow authenticated users to upload challenge videos
-- Run this in Supabase SQL Editor

-- 1. Ensure the 'posts' storage bucket exists and is NOT public
-- (if public, videos would be accessible without auth - already the case likely)

-- 2. Drop any conflicting storage policies for challenge uploads
DROP POLICY IF EXISTS "auth upload challenge video" ON storage.objects;
DROP POLICY IF EXISTS "auth upload challenge thumb" ON storage.objects;
DROP POLICY IF EXISTS "public read challenge media" ON storage.objects;

-- 3. Allow any authenticated user to upload to challenges/ folder
CREATE POLICY "auth upload challenge video"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = 'challenges'
  );

-- 4. Allow public read of challenge media
CREATE POLICY "public read challenge media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = 'challenges'
  );

-- 5. Allow uploader to delete their own file (optional)
CREATE POLICY "owner delete challenge media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = 'challenges'
    AND owner = auth.uid()
  );

-- Verify
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'objects' AND schemaname = 'storage'
ORDER BY policyname;
