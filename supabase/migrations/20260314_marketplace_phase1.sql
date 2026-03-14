-- ============================================================
-- FPV Marketplace — Phase 1 Schema
-- Tables: seller_profiles, marketplace_listings,
--         listing_images, listing_attributes, listing_watchlist
-- ============================================================

-- ── Seller profiles (extends auth.users) ────────────────────
CREATE TABLE IF NOT EXISTS public.seller_profiles (
  user_id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id TEXT,
  verification_tier INT  NOT NULL DEFAULT 0,   -- 0=unverified,1=basic,2=standard,3=trusted
  is_id_verified    BOOL NOT NULL DEFAULT false,
  avg_rating        NUMERIC(3,2) DEFAULT 0,
  total_sales       INT  NOT NULL DEFAULT 0,
  total_reviews     INT  NOT NULL DEFAULT 0,
  dispute_count     INT  NOT NULL DEFAULT 0,
  bio               TEXT,
  location_city     TEXT,
  location_state    TEXT,
  avg_ship_hours    NUMERIC(5,1),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read seller profiles"
  ON public.seller_profiles FOR SELECT USING (true);

CREATE POLICY "Users manage own seller profile"
  ON public.seller_profiles FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Marketplace listings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  description      TEXT NOT NULL CHECK (char_length(description) >= 20),
  category         TEXT NOT NULL,
  subcategory      TEXT,
  condition        TEXT NOT NULL CHECK (condition IN (
                     'new','like_new','good','fair','for_parts')),
  condition_notes  TEXT,
  price            NUMERIC(10,2) NOT NULL CHECK (price > 0),
  buy_now_price    NUMERIC(10,2),
  listing_type     TEXT NOT NULL DEFAULT 'fixed'
                   CHECK (listing_type IN ('fixed','auction','hybrid','offer')),
  auction_start    TIMESTAMPTZ,
  auction_end      TIMESTAMPTZ,
  reserve_price    NUMERIC(10,2),
  current_bid      NUMERIC(10,2),
  bid_count        INT  NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('draft','active','sold','ended','cancelled','flagged')),
  ships_from_state TEXT,
  ships_from_zip   TEXT,
  ships_to         TEXT NOT NULL DEFAULT 'US',
  shipping_cost    NUMERIC(8,2),
  free_shipping    BOOL NOT NULL DEFAULT false,
  weight_oz        NUMERIC(6,1),
  lipo_hazmat      BOOL NOT NULL DEFAULT false,
  view_count       INT  NOT NULL DEFAULT 0,
  is_flagged       BOOL NOT NULL DEFAULT false,
  flag_reason      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ml_seller   ON public.marketplace_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_ml_status   ON public.marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_ml_category ON public.marketplace_listings(category);
CREATE INDEX IF NOT EXISTS idx_ml_created  ON public.marketplace_listings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_price    ON public.marketplace_listings(price);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active listings"
  ON public.marketplace_listings FOR SELECT
  USING (status = 'active' OR seller_id = auth.uid());

CREATE POLICY "Sellers manage own listings"
  ON public.marketplace_listings FOR ALL
  USING  (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ml_updated_at ON public.marketplace_listings;
CREATE TRIGGER trg_ml_updated_at
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Listing images ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.listing_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  position   INT  NOT NULL DEFAULT 0,
  is_primary BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_li_listing ON public.listing_images(listing_id);

ALTER TABLE public.listing_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view listing images"
  ON public.listing_images FOR SELECT USING (true);

CREATE POLICY "Sellers manage own listing images"
  ON public.listing_images FOR ALL
  USING  (EXISTS (SELECT 1 FROM marketplace_listings ml
                  WHERE ml.id = listing_id AND ml.seller_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM marketplace_listings ml
                       WHERE ml.id = listing_id AND ml.seller_id = auth.uid()));

-- ── Listing attributes (drone-specific specs) ─────────────────
CREATE TABLE IF NOT EXISTS public.listing_attributes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  UNIQUE (listing_id, key)
);

ALTER TABLE public.listing_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view listing attributes"
  ON public.listing_attributes FOR SELECT USING (true);

CREATE POLICY "Sellers manage own listing attributes"
  ON public.listing_attributes FOR ALL
  USING  (EXISTS (SELECT 1 FROM marketplace_listings ml
                  WHERE ml.id = listing_id AND ml.seller_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM marketplace_listings ml
                       WHERE ml.id = listing_id AND ml.seller_id = auth.uid()));

-- ── Watchlist ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.listing_watchlist (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

ALTER TABLE public.listing_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own watchlist"
  ON public.listing_watchlist FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Increment view count RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_listing_views(p_listing_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.marketplace_listings
  SET view_count = view_count + 1
  WHERE id = p_listing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_listing_views TO authenticated, anon;

-- ── Reload PostgREST schema ───────────────────────────────────
NOTIFY pgrst, 'reload schema';
