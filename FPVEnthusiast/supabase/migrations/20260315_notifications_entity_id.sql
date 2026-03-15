-- ================================================================
-- Add entity_id + entity_type to notifications table
-- These columns are used by client code (marketplaceNotifications.ts)
-- to store a listing UUID so the notifications screen can tap-to-navigate.
-- The earlier marketplace migration added listing_id (a FK to marketplace_listings)
-- but the client inserts into entity_id/entity_type (more generic names).
-- We add both columns and back-fill entity_id from listing_id where present.
-- ================================================================

-- 1. Add entity_id (generic UUID, no FK — works for listings, orders, etc.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'notifications'
      AND column_name  = 'entity_id'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN entity_id uuid;
  END IF;
END $$;

-- 2. Add entity_type (e.g. 'listing', 'order')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'notifications'
      AND column_name  = 'entity_type'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN entity_type text;
  END IF;
END $$;

-- 3. Back-fill entity_id from listing_id for existing marketplace notifications
--    so that old tap-to-navigate works immediately after migration
UPDATE public.notifications
   SET entity_id   = listing_id,
       entity_type = 'listing'
 WHERE listing_id IS NOT NULL
   AND entity_id IS NULL;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
