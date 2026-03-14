-- ================================================================
-- FPV Marketplace — Phase 2: Transactions, Orders, Messaging
-- ================================================================
--
-- New tables:
--   seller_profiles         — Stripe Connect + tier + rating
--   marketplace_orders      — escrow lifecycle per purchase
--   marketplace_messages    — per-listing buyer↔seller thread
--   marketplace_reviews     — post-delivery rating (1–5)
--
-- Altered tables:
--   marketplace_listings    — add weight_oz, view_count already exists
--   users                   — add push_token for Phase 3 push notifications
--
-- RPCs:
--   confirm_receipt(p_order_id)  — buyer confirms → auto-release guard
--   mark_shipped(p_order_id, p_tracking_number, p_carrier)
-- ================================================================

-- ── 0. Idempotent extension ───────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. seller_profiles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seller_profiles (
  user_id             uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Stripe
  stripe_account_id   text,
  stripe_onboarded    boolean     NOT NULL DEFAULT false,
  -- Reputation
  avg_rating          numeric(3,2)          DEFAULT NULL,   -- recomputed by trigger
  total_sales         integer     NOT NULL DEFAULT 0,
  -- Verification tier:
  --   0 = unverified, 1 = email verified, 2 = ID verified, 3 = ID + Stripe
  verification_tier   integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE seller_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sp_public_read"
  ON seller_profiles FOR SELECT USING (true);

CREATE POLICY "sp_owner_update"
  ON seller_profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "sp_insert_self"
  ON seller_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── 2. marketplace_orders ─────────────────────────────────────────────────────
-- Status flow: pending → paid → shipped → delivered → completed
--              pending → cancelled
--              shipped → disputed → resolved
CREATE TABLE IF NOT EXISTS marketplace_orders (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          uuid        NOT NULL REFERENCES marketplace_listings(id),
  buyer_id            uuid        NOT NULL REFERENCES auth.users(id),
  seller_id           uuid        NOT NULL REFERENCES auth.users(id),
  -- Amounts (in USD cents to avoid float issues)
  amount_cents        integer     NOT NULL,             -- buyer pays
  platform_fee_cents  integer     NOT NULL DEFAULT 0,   -- 5 % retained
  seller_payout_cents integer     NOT NULL DEFAULT 0,   -- released on delivery
  -- Stripe
  stripe_payment_intent text,
  stripe_transfer_id    text,
  -- Shipping
  tracking_number     text,
  carrier             text,
  shipped_at          timestamptz,
  -- Lifecycle timestamps
  status              text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','shipped','delivered','completed','cancelled','disputed','resolved')),
  paid_at             timestamptz,
  delivered_at        timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  auto_release_at     timestamptz,    -- 3 days after shipped_at if buyer doesn't confirm
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_buyer_seller_read"
  ON marketplace_orders FOR SELECT
  USING (auth.uid() IN (buyer_id, seller_id));

CREATE POLICY "orders_insert_buyer"
  ON marketplace_orders FOR INSERT
  WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "orders_update_parties"
  ON marketplace_orders FOR UPDATE
  USING (auth.uid() IN (buyer_id, seller_id));

-- Fast lookups
CREATE INDEX IF NOT EXISTS idx_orders_listing   ON marketplace_orders (listing_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer     ON marketplace_orders (buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_seller    ON marketplace_orders (seller_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_auto_rel  ON marketplace_orders (auto_release_at)
  WHERE status = 'shipped';

-- ── 3. marketplace_messages ───────────────────────────────────────────────────
-- One thread per (listing_id, buyer_id) pair.
-- seller_id stored for easy RLS without extra join.
CREATE TABLE IF NOT EXISTS marketplace_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid        NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  order_id    uuid        REFERENCES marketplace_orders(id) ON DELETE SET NULL,
  sender_id   uuid        NOT NULL REFERENCES auth.users(id),
  buyer_id    uuid        NOT NULL REFERENCES auth.users(id),
  seller_id   uuid        NOT NULL REFERENCES auth.users(id),
  body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  read        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_messages ENABLE ROW LEVEL SECURITY;

-- Buyer or seller can read/write their thread
CREATE POLICY "msg_parties_select"
  ON marketplace_messages FOR SELECT
  USING (auth.uid() IN (buyer_id, seller_id));

CREATE POLICY "msg_parties_insert"
  ON marketplace_messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id AND auth.uid() IN (buyer_id, seller_id));

CREATE POLICY "msg_mark_read"
  ON marketplace_messages FOR UPDATE
  USING (auth.uid() IN (buyer_id, seller_id));

CREATE INDEX IF NOT EXISTS idx_msg_thread
  ON marketplace_messages (listing_id, buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_unread
  ON marketplace_messages (seller_id, read) WHERE read = false;

-- ── 4. marketplace_reviews ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL UNIQUE REFERENCES marketplace_orders(id),
  reviewer_id uuid        NOT NULL REFERENCES auth.users(id),
  seller_id   uuid        NOT NULL REFERENCES auth.users(id),
  rating      integer     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text        CHECK (char_length(comment) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews_public_read"  ON marketplace_reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert_buyer"
  ON marketplace_reviews FOR INSERT
  WITH CHECK (
    auth.uid() = reviewer_id AND
    EXISTS (
      SELECT 1 FROM marketplace_orders
      WHERE id = order_id
        AND buyer_id = auth.uid()
        AND status IN ('delivered','completed')
    )
  );

-- Trigger: recompute seller avg_rating + total_sales after every review insert
CREATE OR REPLACE FUNCTION update_seller_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE seller_profiles
  SET
    avg_rating  = (
      SELECT ROUND(AVG(rating)::numeric, 2)
      FROM   marketplace_reviews
      WHERE  seller_id = NEW.seller_id
    ),
    total_sales = (
      SELECT COUNT(*)
      FROM   marketplace_orders
      WHERE  seller_id = NEW.seller_id
        AND  status IN ('delivered','completed')
    ),
    updated_at = now()
  WHERE user_id = NEW.seller_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_seller_rating ON marketplace_reviews;
CREATE TRIGGER trg_update_seller_rating
  AFTER INSERT ON marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION update_seller_rating();

-- ── 5. mark_shipped() RPC ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_shipped(
  p_order_id       uuid,
  p_tracking_number text,
  p_carrier         text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order marketplace_orders;
BEGIN
  SELECT * INTO v_order FROM marketplace_orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;
  IF v_order.seller_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_seller');
  END IF;
  IF v_order.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_status', 'status', v_order.status);
  END IF;

  UPDATE marketplace_orders
  SET
    status           = 'shipped',
    tracking_number  = p_tracking_number,
    carrier          = p_carrier,
    shipped_at       = now(),
    auto_release_at  = now() + interval '3 days',
    updated_at       = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'auto_release_at', now() + interval '3 days');
END;
$$;

REVOKE ALL   ON FUNCTION mark_shipped(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_shipped(uuid, text, text) TO authenticated;

-- ── 6. confirm_receipt() RPC ──────────────────────────────────────────────────
-- Buyer confirms delivery → status = 'delivered', records timestamp.
-- Actual payout (Stripe Transfer) is triggered by the Edge Function webhook.
CREATE OR REPLACE FUNCTION confirm_receipt(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order marketplace_orders;
BEGIN
  SELECT * INTO v_order FROM marketplace_orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;
  IF v_order.buyer_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_buyer');
  END IF;
  IF v_order.status NOT IN ('shipped','delivered') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_status', 'status', v_order.status);
  END IF;

  UPDATE marketplace_orders
  SET
    status        = 'delivered',
    delivered_at  = now(),
    updated_at    = now()
  WHERE id = p_order_id;

  -- Mark the listing as sold
  UPDATE marketplace_listings
  SET status = 'sold', updated_at = now()
  WHERE id = v_order.listing_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL   ON FUNCTION confirm_receipt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_receipt(uuid) TO authenticated;

-- ── 7. users table — push token column ───────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_token text;

-- ── 8. view_count increment RPC ───────────────────────────────────────────────
-- Called client-side when listing detail opens.
CREATE OR REPLACE FUNCTION increment_listing_views(p_listing_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE marketplace_listings
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = p_listing_id;
END;
$$;

REVOKE ALL   ON FUNCTION increment_listing_views(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_listing_views(uuid) TO authenticated, anon;

-- ── 9. Unread message count convenience function ──────────────────────────────
CREATE OR REPLACE FUNCTION unread_message_count(p_user_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM   marketplace_messages
  WHERE  (buyer_id = p_user_id OR seller_id = p_user_id)
    AND  sender_id <> p_user_id
    AND  read = false;
$$;

GRANT EXECUTE ON FUNCTION unread_message_count(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
