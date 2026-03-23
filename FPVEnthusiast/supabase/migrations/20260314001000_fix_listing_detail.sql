-- ============================================================
-- FPV Marketplace — Fix all image + listing-detail issues
-- Run this ONCE in Supabase SQL Editor
-- ============================================================

-- ── 1. Add featured columns (if missing) ────────────────────
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS is_featured    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until timestamptz,
  ADD COLUMN IF NOT EXISTS featured_type  text        CHECK (featured_type IN ('paid','props'));

CREATE INDEX IF NOT EXISTS idx_ml_featured
  ON public.marketplace_listings (is_featured, featured_until)
  WHERE is_featured = true;

-- ── 2. Create / fix the media storage bucket ────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media', 'media', true, 10485760,
  ARRAY[
    'image/jpeg','image/jpg','image/png','image/webp',
    'image/gif','image/heic','image/heif',
    'video/mp4','video/quicktime','video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 3. Storage RLS policies ──────────────────────────────────
DROP POLICY IF EXISTS "media_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "media_auth_upload"   ON storage.objects;
DROP POLICY IF EXISTS "media_owner_update"  ON storage.objects;
DROP POLICY IF EXISTS "media_owner_delete"  ON storage.objects;

CREATE POLICY "media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

CREATE POLICY "media_auth_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media');

CREATE POLICY "media_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND owner = auth.uid());

CREATE POLICY "media_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND owner = auth.uid());

-- ── 4. Verify ────────────────────────────────────────────────
SELECT
  (SELECT to_regclass('public.marketplace_listings') IS NOT NULL)         AS listings_table,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name = 'marketplace_listings'
     AND column_name = 'is_featured')::int > 0                            AS featured_cols_exist,
  (SELECT public FROM storage.buckets WHERE id = 'media')                 AS media_bucket_public,
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'media')::int   AS objects_in_media;
