-- ============================================================
-- FPV Marketplace — DEFINITIVE one-paste fix
-- Fixes: media bucket, featured columns, listing_images RLS
-- Run this in Supabase SQL Editor → Run
-- ============================================================

-- ── 1. Add featured columns (safe, idempotent) ───────────────
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS is_featured    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until timestamptz,
  ADD COLUMN IF NOT EXISTS featured_type  text;

-- ── 2. Create / fix the media storage bucket ─────────────────
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

-- ── 3. Storage RLS policies ───────────────────────────────────
DROP POLICY IF EXISTS "media_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "media_auth_upload"  ON storage.objects;
DROP POLICY IF EXISTS "media_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "media_owner_delete" ON storage.objects;

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

-- ── 4. listing_images table (ensure it exists + RLS) ─────────
CREATE TABLE IF NOT EXISTS public.listing_images (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid        NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  url        text        NOT NULL,
  position   int         NOT NULL DEFAULT 0,
  is_primary boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_images ENABLE ROW LEVEL SECURITY;

-- Public read
DROP POLICY IF EXISTS "li_public_read" ON public.listing_images;
CREATE POLICY "li_public_read"
  ON public.listing_images FOR SELECT
  USING (true);

-- Owner insert (seller can insert images for their own listings)
DROP POLICY IF EXISTS "li_owner_insert" ON public.listing_images;
DROP POLICY IF EXISTS "li_owner_write"  ON public.listing_images;
CREATE POLICY "li_owner_insert"
  ON public.listing_images FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.marketplace_listings ml
      WHERE ml.id = listing_id
        AND ml.seller_id = auth.uid()
    )
  );

-- Owner delete
DROP POLICY IF EXISTS "li_owner_delete" ON public.listing_images;
CREATE POLICY "li_owner_delete"
  ON public.listing_images FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketplace_listings ml
      WHERE ml.id = listing_id
        AND ml.seller_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_li_listing ON public.listing_images (listing_id, position);

-- ── 5. Verify ─────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='marketplace_listings' AND column_name='is_featured') > 0  AS featured_cols,
  (SELECT public FROM storage.buckets WHERE id='media')                        AS media_public,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_name='listing_images')                                          AS listing_images_exists;
-- Expected: featured_cols=true, media_public=true, listing_images_exists=1
