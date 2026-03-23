-- ================================================================
-- Phase 2 Remediation — idempotent, handles partial prior runs
-- Run this INSTEAD OF / AFTER the broken phase2 migration attempt
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. seller_profiles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seller_profiles (
  user_id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id text,
  stripe_onboarded  boolean     NOT NULL DEFAULT false,
  avg_rating        numeric(3,2)          DEFAULT NULL,
  total_sales       integer     NOT NULL DEFAULT 0,
  verification_tier integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sp_public_read"  ON public.seller_profiles;
DROP POLICY IF EXISTS "sp_owner_update" ON public.seller_profiles;
DROP POLICY IF EXISTS "sp_insert_self"  ON public.seller_profiles;
CREATE POLICY "sp_public_read"  ON public.seller_profiles FOR SELECT USING (true);
CREATE POLICY "sp_owner_update" ON public.seller_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "sp_insert_self"  ON public.seller_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── 2. marketplace_orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id            uuid        NOT NULL REFERENCES public.marketplace_listings(id),
  buyer_id              uuid        NOT NULL REFERENCES auth.users(id),
  seller_id             uuid        NOT NULL REFERENCES auth.users(id),
  amount_cents          integer     NOT NULL,
  platform_fee_cents    integer     NOT NULL DEFAULT 0,
  seller_payout_cents   integer     NOT NULL DEFAULT 0,
  stripe_payment_intent text,
  stripe_transfer_id    text,
  tracking_number       text,
  carrier               text,
  shipped_at            timestamptz,
  status                text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','shipped','delivered','completed','cancelled','disputed','resolved')),
  paid_at               timestamptz,
  delivered_at          timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  auto_release_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_buyer_seller_read" ON public.marketplace_orders;
DROP POLICY IF EXISTS "orders_insert_buyer"      ON public.marketplace_orders;
DROP POLICY IF EXISTS "orders_update_parties"    ON public.marketplace_orders;
CREATE POLICY "orders_buyer_seller_read" ON public.marketplace_orders FOR SELECT USING (auth.uid() IN (buyer_id, seller_id));
CREATE POLICY "orders_insert_buyer"      ON public.marketplace_orders FOR INSERT WITH CHECK (auth.uid() = buyer_id);
CREATE POLICY "orders_update_parties"    ON public.marketplace_orders FOR UPDATE USING (auth.uid() IN (buyer_id, seller_id));
CREATE INDEX IF NOT EXISTS idx_orders_listing  ON public.marketplace_orders (listing_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer    ON public.marketplace_orders (buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_seller   ON public.marketplace_orders (seller_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_auto_rel ON public.marketplace_orders (auto_release_at) WHERE status = 'shipped';

-- ── 3. marketplace_messages ──────────────────────────────────────────────────
-- Drop and recreate if columns are missing (handles partial prior runs)
DO $$
BEGIN
  -- Add buyer_id if table exists but column is missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='marketplace_messages')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='marketplace_messages' AND column_name='buyer_id')
  THEN
    -- Table exists without buyer_id — drop and recreate cleanly
    DROP TABLE public.marketplace_messages CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.marketplace_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid        NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  order_id    uuid        REFERENCES public.marketplace_orders(id) ON DELETE SET NULL,
  sender_id   uuid        NOT NULL REFERENCES auth.users(id),
  buyer_id    uuid        NOT NULL REFERENCES auth.users(id),
  seller_id   uuid        NOT NULL REFERENCES auth.users(id),
  body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  read        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marketplace_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "msg_parties_select" ON public.marketplace_messages;
DROP POLICY IF EXISTS "msg_parties_insert" ON public.marketplace_messages;
DROP POLICY IF EXISTS "msg_mark_read"      ON public.marketplace_messages;
CREATE POLICY "msg_parties_select" ON public.marketplace_messages FOR SELECT USING (auth.uid() IN (buyer_id, seller_id));
CREATE POLICY "msg_parties_insert" ON public.marketplace_messages FOR INSERT WITH CHECK (auth.uid() = sender_id AND auth.uid() IN (buyer_id, seller_id));
CREATE POLICY "msg_mark_read"      ON public.marketplace_messages FOR UPDATE USING (auth.uid() IN (buyer_id, seller_id));
CREATE INDEX IF NOT EXISTS idx_msg_thread ON public.marketplace_messages (listing_id, buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_unread ON public.marketplace_messages (seller_id, read) WHERE read = false;

-- ── 4. marketplace_reviews ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_reviews (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL UNIQUE REFERENCES public.marketplace_orders(id),
  reviewer_id uuid        NOT NULL REFERENCES auth.users(id),
  seller_id   uuid        NOT NULL REFERENCES auth.users(id),
  rating      integer     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text        CHECK (char_length(comment) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marketplace_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reviews_public_read"   ON public.marketplace_reviews;
DROP POLICY IF EXISTS "reviews_insert_buyer"  ON public.marketplace_reviews;
DROP POLICY IF EXISTS "reviews_owner_update"  ON public.marketplace_reviews;
CREATE POLICY "reviews_public_read" ON public.marketplace_reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert_buyer" ON public.marketplace_reviews FOR INSERT
  WITH CHECK (
    auth.uid() = reviewer_id AND
    EXISTS (
      SELECT 1 FROM public.marketplace_orders
      WHERE id = order_id AND buyer_id = auth.uid() AND status IN ('delivered','completed')
    )
  );
CREATE POLICY "reviews_owner_update" ON public.marketplace_reviews FOR UPDATE USING (auth.uid() = reviewer_id);

-- ── 4b. Trigger: recompute avg_rating after review ───────────────────────────
CREATE OR REPLACE FUNCTION public.update_seller_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.seller_profiles SET
    avg_rating  = (SELECT ROUND(AVG(rating)::numeric, 2) FROM public.marketplace_reviews WHERE seller_id = NEW.seller_id),
    total_sales = (SELECT COUNT(*) FROM public.marketplace_orders WHERE seller_id = NEW.seller_id AND status IN ('delivered','completed')),
    updated_at  = now()
  WHERE user_id = NEW.seller_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_update_seller_rating ON public.marketplace_reviews;
CREATE TRIGGER trg_update_seller_rating
  AFTER INSERT ON public.marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_seller_rating();

-- ── 5. mark_shipped() RPC ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_shipped(
  p_order_id        uuid,
  p_tracking_number text,
  p_carrier         text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.marketplace_orders;
BEGIN
  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'order_not_found'); END IF;
  IF v_order.seller_id IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_seller'); END IF;
  IF v_order.status <> 'paid' THEN RETURN jsonb_build_object('ok', false, 'error', 'wrong_status', 'status', v_order.status); END IF;
  UPDATE public.marketplace_orders SET
    status          = 'shipped',
    tracking_number = p_tracking_number,
    carrier         = p_carrier,
    shipped_at      = now(),
    auto_release_at = now() + interval '3 days',
    updated_at      = now()
  WHERE id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'auto_release_at', (now() + interval '3 days'));
END; $$;
REVOKE ALL   ON FUNCTION public.mark_shipped(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_shipped(uuid, text, text) TO authenticated;

-- ── 6. confirm_receipt() RPC ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_receipt(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.marketplace_orders;
BEGIN
  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'order_not_found'); END IF;
  IF v_order.buyer_id IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_buyer'); END IF;
  IF v_order.status NOT IN ('shipped','delivered') THEN RETURN jsonb_build_object('ok', false, 'error', 'wrong_status', 'status', v_order.status); END IF;
  UPDATE public.marketplace_orders SET
    status       = 'delivered',
    delivered_at = now(),
    updated_at   = now()
  WHERE id = p_order_id;
  UPDATE public.marketplace_listings SET status = 'sold', updated_at = now() WHERE id = v_order.listing_id;
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL   ON FUNCTION public.confirm_receipt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_receipt(uuid) TO authenticated;

-- ── 7. Utility columns ───────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS push_token text;

-- ── 8. increment_listing_views() ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_listing_views(p_listing_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.marketplace_listings SET view_count = COALESCE(view_count, 0) + 1 WHERE id = p_listing_id;
END; $$;
REVOKE ALL   ON FUNCTION public.increment_listing_views(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_listing_views(uuid) TO authenticated, anon;

-- ── 9. unread_message_count() — plpgsql so table validation is deferred ──────
-- NOTE: Using plpgsql instead of sql to avoid compile-time column validation
CREATE OR REPLACE FUNCTION public.unread_message_count(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_count
  FROM   public.marketplace_messages
  WHERE  (buyer_id = p_user_id OR seller_id = p_user_id)
    AND  sender_id <> p_user_id
    AND  read = false;
  RETURN COALESCE(v_count, 0);
END; $$;
GRANT EXECUTE ON FUNCTION public.unread_message_count(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
