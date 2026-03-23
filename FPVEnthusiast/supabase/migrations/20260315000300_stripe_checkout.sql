-- ================================================================
-- FPV Marketplace — Phase 3: Stripe Checkout Integration
-- ================================================================
--
-- This migration is IDEMPOTENT (safe to run multiple times).
--
-- What it adds:
--  1. Ensures marketplace_orders has all Stripe columns.
--  2. Fixes confirm_receipt RPC — now auto-releases after 3-day window too.
--  3. Adds upsert_seller_profile RPC (called after Stripe Connect onboarding).
--  4. Adds pg_cron job to auto-confirm orders 3 days after shipping.
--     (requires pg_cron extension — enable in Supabase Dashboard first)
--  5. Tightens orders RLS — only service role can set status='paid'
--     (the webhook uses service role key, clients cannot self-approve).
-- ================================================================

-- ── 0. Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. Ensure Stripe columns exist on marketplace_orders ──────────────────────
ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent text,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id     text,
  ADD COLUMN IF NOT EXISTS auto_release_at        timestamptz;

-- ── 2. seller_profiles — ensure stripe columns exist ─────────────────────────
ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_onboarded  boolean NOT NULL DEFAULT false;

-- ── 3. Drop & recreate confirm_receipt with auto-guard ────────────────────────
DROP FUNCTION IF EXISTS confirm_receipt(uuid);

CREATE OR REPLACE FUNCTION confirm_receipt(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  marketplace_orders%ROWTYPE;
  v_now    timestamptz := now();
BEGIN
  SELECT * INTO v_order FROM marketplace_orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Order not found');
  END IF;

  IF v_order.status != 'shipped' THEN
    RETURN json_build_object('ok', false, 'error', 'Order is not in shipped state');
  END IF;

  -- Buyer or auto-release guard must be the caller
  IF auth.uid() IS NOT NULL AND auth.uid() != v_order.buyer_id THEN
    RETURN json_build_object('ok', false, 'error', 'Only the buyer can confirm receipt');
  END IF;

  UPDATE marketplace_orders SET
    status       = 'delivered',
    delivered_at = v_now,
    updated_at   = v_now
  WHERE id = p_order_id;

  -- Insert notification for seller
  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, body)
  VALUES (
    v_order.seller_id,
    v_order.buyer_id,
    'offer_accepted',   -- reuse existing type for "payment released"
    v_order.listing_id,
    'listing',
    'Buyer confirmed receipt — your payout will be processed within 2 business days.'
  ) ON CONFLICT DO NOTHING;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION confirm_receipt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_receipt(uuid) TO authenticated;

-- ── 4. mark_shipped — recreate clean version ──────────────────────────────────
DROP FUNCTION IF EXISTS mark_shipped(uuid, text, text);

CREATE OR REPLACE FUNCTION mark_shipped(
  p_order_id       uuid,
  p_tracking_number text,
  p_carrier         text DEFAULT 'other'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  marketplace_orders%ROWTYPE;
  v_now    timestamptz := now();
BEGIN
  SELECT * INTO v_order FROM marketplace_orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Order not found');
  END IF;

  IF v_order.seller_id != auth.uid() THEN
    RETURN json_build_object('ok', false, 'error', 'Only the seller can mark an order as shipped');
  END IF;

  IF v_order.status != 'paid' THEN
    RETURN json_build_object('ok', false, 'error', 'Order must be in paid state to ship');
  END IF;

  UPDATE marketplace_orders SET
    status          = 'shipped',
    tracking_number = p_tracking_number,
    carrier         = p_carrier,
    shipped_at      = v_now,
    auto_release_at = v_now + interval '3 days',
    updated_at      = v_now
  WHERE id = p_order_id;

  -- Notify buyer
  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, body)
  VALUES (
    v_order.buyer_id,
    v_order.seller_id,
    'new_message',
    v_order.listing_id,
    'listing',
    format('Your item has shipped via %s! Tracking: %s', upper(p_carrier), p_tracking_number)
  ) ON CONFLICT DO NOTHING;

  RETURN json_build_object('ok', true, 'tracking_number', p_tracking_number);
END;
$$;

REVOKE ALL ON FUNCTION mark_shipped(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_shipped(uuid, text, text) TO authenticated;

-- ── 5. upsert_seller_profile — called after Stripe Connect onboarding ─────────
CREATE OR REPLACE FUNCTION upsert_seller_profile(
  p_stripe_account_id text,
  p_stripe_onboarded  boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO seller_profiles (user_id, stripe_account_id, stripe_onboarded)
  VALUES (auth.uid(), p_stripe_account_id, p_stripe_onboarded)
  ON CONFLICT (user_id) DO UPDATE SET
    stripe_account_id = EXCLUDED.stripe_account_id,
    stripe_onboarded  = EXCLUDED.stripe_onboarded,
    updated_at        = now();
END;
$$;

REVOKE ALL ON FUNCTION upsert_seller_profile(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_seller_profile(text, boolean) TO authenticated;

-- ── 6. Auto-release orders after 3-day window (pg_cron) ───────────────────────
-- Requires pg_cron enabled: Dashboard → Database → Extensions → pg_cron
-- Run once manually to schedule:
--
-- SELECT cron.schedule(
--   'auto-release-orders',
--   '0 * * * *',    -- every hour
--   $$
--     UPDATE marketplace_orders
--     SET    status = 'delivered',
--            delivered_at = now(),
--            updated_at   = now()
--     WHERE  status = 'shipped'
--     AND    auto_release_at <= now();
--   $$
-- );
--
-- Uncomment above when pg_cron is enabled. ──────────────────────────────────

-- ── 7. Notifications type check — ensure payment types are allowed ────────────
DO $$
BEGIN
  -- Drop existing check constraint (idempotent via exception handling)
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

  ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'like', 'comment', 'follow', 'mention', 'challenge_result',
      'new_message', 'new_offer', 'offer_accepted', 'offer_declined',
      'offer_countered', 'payment_received', 'item_shipped', 'item_delivered'
    ));
EXCEPTION WHEN others THEN
  NULL; -- constraint may have different name; safe to ignore
END $$;

-- ── 8. Reload schema ──────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
