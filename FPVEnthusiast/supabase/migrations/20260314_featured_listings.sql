-- ================================================================
-- FPV Marketplace – Featured Listings
-- ================================================================
-- Tables:
--   marketplace_listings   (add is_featured, featured_until, featured_type)
--   featured_purchases     (audit log for every boost purchase)
-- RPCs:
--   spend_props_for_featured(p_listing_id, p_user_id)
--     → deducts 4 800 props, sets a 24 h featured window
-- ================================================================

-- ── 1. Extend marketplace_listings ───────────────────────────────────────────
ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS is_featured     boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until  timestamptz,
  -- 'paid' = Stripe purchase, 'props' = props-economy purchase
  ADD COLUMN IF NOT EXISTS featured_type   text        CHECK (featured_type IN ('paid','props'));

-- Index for fast carousel query
CREATE INDEX IF NOT EXISTS idx_ml_featured
  ON marketplace_listings (is_featured, featured_until)
  WHERE is_featured = true;

-- ── 2. Trigger: auto-expire featured status ───────────────────────────────────
CREATE OR REPLACE FUNCTION expire_featured_listings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE marketplace_listings
  SET    is_featured    = false,
         featured_until = NULL,
         featured_type  = NULL
  WHERE  is_featured    = true
    AND  featured_until IS NOT NULL
    AND  featured_until < now();
END;
$$;

-- ── 3. featured_purchases audit log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS featured_purchases (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid        NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  purchase_type text       NOT NULL CHECK (purchase_type IN ('paid','props')),
  props_spent  integer,
  amount_usd   numeric(8,2),
  duration_hrs integer     NOT NULL DEFAULT 24,
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE featured_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "featured_purchases_owner_select"
  ON featured_purchases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "featured_purchases_insert_rpc"
  ON featured_purchases FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── 4. spend_props_for_featured() RPC ────────────────────────────────────────
-- Cost:  4 800 props  (deliberately steep — hard to earn casually)
-- Duration: 24 hours
-- Idempotent: if listing is already featured, extends the window from now.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION spend_props_for_featured(
  p_listing_id  uuid,
  p_user_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost       constant integer := 4800;
  v_hrs        constant integer := 24;
  v_balance    integer;
  v_owner      uuid;
  v_ends_at    timestamptz;
BEGIN
  -- 1. Verify caller owns the listing
  SELECT seller_id INTO v_owner
  FROM   marketplace_listings
  WHERE  id = p_listing_id AND status = 'active';

  IF v_owner IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner_or_inactive');
  END IF;

  -- 2. Check props balance
  SELECT total_props INTO v_balance
  FROM   users
  WHERE  id = p_user_id;

  IF COALESCE(v_balance, 0) < v_cost THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'insufficient_props',
      'balance', COALESCE(v_balance, 0),
      'cost',    v_cost
    );
  END IF;

  -- 3. Deduct props
  UPDATE users
  SET    total_props  = total_props  - v_cost,
         earned_props = GREATEST(0, COALESCE(earned_props, 0) - v_cost)
  WHERE  id = p_user_id;

  -- 4. Set / extend featured window
  v_ends_at := now() + (v_hrs || ' hours')::interval;

  UPDATE marketplace_listings
  SET    is_featured    = true,
         featured_until = v_ends_at,
         featured_type  = 'props'
  WHERE  id = p_listing_id;

  -- 5. Audit log
  INSERT INTO featured_purchases
    (listing_id, user_id, purchase_type, props_spent, duration_hrs, starts_at, ends_at)
  VALUES
    (p_listing_id, p_user_id, 'props', v_cost, v_hrs, now(), v_ends_at);

  RETURN jsonb_build_object('ok', true, 'ends_at', v_ends_at, 'props_spent', v_cost);
END;
$$;

REVOKE ALL   ON FUNCTION spend_props_for_featured(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION spend_props_for_featured(uuid, uuid)
  TO authenticated;

-- ── 5. set_listing_featured_paid() RPC ───────────────────────────────────────
-- Called server-side (service_role) after Stripe webhook confirms payment.
-- Exposed here for completeness; client NEVER calls this directly.
CREATE OR REPLACE FUNCTION set_listing_featured_paid(
  p_listing_id  uuid,
  p_hours       integer DEFAULT 168   -- default: 7 days
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ends_at timestamptz := now() + (p_hours || ' hours')::interval;
BEGIN
  UPDATE marketplace_listings
  SET    is_featured    = true,
         featured_until = v_ends_at,
         featured_type  = 'paid'
  WHERE  id = p_listing_id;

  INSERT INTO featured_purchases
    (listing_id, user_id, purchase_type, duration_hrs, starts_at, ends_at)
  SELECT p_listing_id, seller_id, 'paid', p_hours, now(), v_ends_at
  FROM   marketplace_listings
  WHERE  id = p_listing_id;

  RETURN jsonb_build_object('ok', true, 'ends_at', v_ends_at);
END;
$$;

REVOKE ALL   ON FUNCTION set_listing_featured_paid(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION set_listing_featured_paid(uuid, integer)
  TO service_role;

-- ── 6. View: active featured listings for carousel ───────────────────────────
CREATE OR REPLACE VIEW active_featured_listings AS
SELECT ml.*
FROM   marketplace_listings ml
WHERE  ml.is_featured    = true
  AND  ml.featured_until > now()
  AND  ml.status         = 'active'
ORDER  BY ml.featured_until DESC;

NOTIFY pgrst, 'reload schema';
