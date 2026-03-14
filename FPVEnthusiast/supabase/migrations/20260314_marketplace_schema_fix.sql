-- ================================================================
-- FPV Marketplace — Schema fix: RLS policies + FK + table bootstrap
-- Run this in Supabase SQL Editor (or as a migration)
-- Safe to run multiple times (all statements are idempotent)
-- ================================================================

-- ── 1. Ensure marketplace_listings table exists ───────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         uuid        NOT NULL,
  title             text        NOT NULL,
  description       text,
  category          text,
  subcategory       text,
  condition         text        NOT NULL DEFAULT 'good',
  condition_notes   text,
  price             numeric(10,2),
  buy_now_price     numeric(10,2),
  listing_type      text        NOT NULL DEFAULT 'fixed'
    CHECK (listing_type IN ('fixed','auction','hybrid','offer')),
  status            text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','sold','cancelled','archived')),
  auction_end       timestamptz,
  current_bid       numeric(10,2),
  bid_count         integer     NOT NULL DEFAULT 0,
  ships_from_state  text,
  shipping_cost     numeric(10,2),
  free_shipping     boolean     NOT NULL DEFAULT false,
  lipo_hazmat       boolean     NOT NULL DEFAULT false,
  weight_oz         numeric(6,1),
  view_count        integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Ensure listing_images table exists ────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_images (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid    NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  url         text    NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Add FK from seller_id → public.users (idempotent) ─────────────────────
DO $$
BEGIN
  -- Only add the constraint if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'marketplace_listings_seller_id_fkey'
      AND conrelid = 'marketplace_listings'::regclass
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_seller_id_fkey
      FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- ── 4. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ml_status        ON marketplace_listings (status);
CREATE INDEX IF NOT EXISTS idx_ml_seller        ON marketplace_listings (seller_id);
CREATE INDEX IF NOT EXISTS idx_ml_category      ON marketplace_listings (category);
CREATE INDEX IF NOT EXISTS idx_ml_created       ON marketplace_listings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_listing       ON listing_images (listing_id, position);

-- ── 5. Enable RLS ─────────────────────────────────────────────────────────────
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_images       ENABLE ROW LEVEL SECURITY;

-- ── 6. RLS policies — marketplace_listings ───────────────────────────────────
-- Anyone can browse active listings
DROP POLICY IF EXISTS "ml_public_read"  ON marketplace_listings;
CREATE POLICY "ml_public_read"
  ON marketplace_listings FOR SELECT
  USING (status = 'active');

-- Seller can also read their own non-active listings
DROP POLICY IF EXISTS "ml_owner_read"  ON marketplace_listings;
CREATE POLICY "ml_owner_read"
  ON marketplace_listings FOR SELECT
  USING (auth.uid() = seller_id);

-- Authenticated users can create listings
DROP POLICY IF EXISTS "ml_auth_insert"  ON marketplace_listings;
CREATE POLICY "ml_auth_insert"
  ON marketplace_listings FOR INSERT
  WITH CHECK (auth.uid() = seller_id);

-- Only the seller can update/archive their listing
DROP POLICY IF EXISTS "ml_owner_update"  ON marketplace_listings;
CREATE POLICY "ml_owner_update"
  ON marketplace_listings FOR UPDATE
  USING (auth.uid() = seller_id);

-- ── 7. RLS policies — listing_images ─────────────────────────────────────────
-- Anyone can read images (listing visibility controlled by parent policy)
DROP POLICY IF EXISTS "li_public_read"  ON listing_images;
CREATE POLICY "li_public_read"
  ON listing_images FOR SELECT
  USING (true);

-- Only the listing owner can insert/update images
DROP POLICY IF EXISTS "li_owner_write"  ON listing_images;
CREATE POLICY "li_owner_write"
  ON listing_images FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM marketplace_listings ml
      WHERE ml.id = listing_id
        AND ml.seller_id = auth.uid()
    )
  );

-- ── 8. listing_watchlist (if missing) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_watchlist (
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);
ALTER TABLE listing_watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lw_owner"  ON listing_watchlist;
CREATE POLICY "lw_owner"
  ON listing_watchlist FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 9. increment_listing_views RPC (idempotent) ───────────────────────────────
CREATE OR REPLACE FUNCTION increment_listing_views(p_listing_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE marketplace_listings
  SET view_count = view_count + 1
  WHERE id = p_listing_id;
$$;

