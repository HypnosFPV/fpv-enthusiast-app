-- =============================================================================
-- Migration: 20260316_disputes_reports.sql
-- 1. Creates listing_reports table (user-facing "Report Listing" button)
-- 2. Adds marketplace_dispute & dispute_resolved notification types
-- 3. Adds admin view: marketplace_disputes (disputed orders with details)
-- 4. Adds admin RPC: resolve_dispute(order_id, action) 
--    action = 'refund_buyer' | 'release_seller' | 'close'
-- =============================================================================

-- ── 1. listing_reports ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.listing_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  reporter_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason       text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  reviewed_by  uuid REFERENCES auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One report per user per listing
  UNIQUE(listing_id, reporter_id)
);

-- RLS
ALTER TABLE public.listing_reports ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can submit a report
CREATE POLICY "insert_own_report" ON public.listing_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Only service role / admin can read reports
CREATE POLICY "service_read_reports" ON public.listing_reports
  FOR SELECT TO service_role USING (true);

-- Admins (is_admin = true in users table) can read reports
CREATE POLICY "admin_read_reports" ON public.listing_reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- Admins can update status
CREATE POLICY "admin_update_reports" ON public.listing_reports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- ── 2. Extend notification types ─────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'like', 'comment', 'follow', 'mention', 'challenge_result',
      'new_message', 'new_offer', 'offer_accepted', 'offer_declined',
      'offer_countered', 'payment_received', 'item_shipped', 'item_delivered',
      'marketplace_dispute', 'dispute_resolved'
    ));
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- ── 3. Admin view: marketplace_disputes ───────────────────────────────────────
CREATE OR REPLACE VIEW public.marketplace_disputes AS
SELECT
  o.id                                              AS order_id,
  o.status,
  o.amount_cents,
  o.seller_payout_cents,
  o.platform_fee_cents,
  o.created_at,
  o.paid_at,
  o.shipped_at,
  o.delivered_at,
  o.tracking_number,
  o.carrier,
  o.stripe_payment_intent,
  -- listing
  l.id                                              AS listing_id,
  l.title                                           AS listing_title,
  -- buyer
  b.id                                              AS buyer_id,
  b.username                                        AS buyer_username,
  b.email                                           AS buyer_email,
  -- seller
  s.id                                              AS seller_id,
  s.username                                        AS seller_username,
  s.email                                           AS seller_email
FROM public.marketplace_orders o
JOIN public.marketplace_listings l ON l.id = o.listing_id
JOIN public.users b               ON b.id = o.buyer_id
JOIN public.users s               ON s.id = o.seller_id
WHERE o.status IN ('disputed', 'resolved');

-- ── 4. Admin RPC: resolve_dispute ─────────────────────────────────────────────
-- action: 'refund_buyer' | 'release_seller' | 'close'
CREATE OR REPLACE FUNCTION public.resolve_dispute(
  p_order_id uuid,
  p_action   text,
  p_note     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  marketplace_orders%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Admin-only
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_order FROM marketplace_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.status NOT IN ('disputed', 'paid', 'shipped', 'delivered') THEN
    RAISE EXCEPTION 'Order is not in a disputeable state';
  END IF;

  IF p_action = 'refund_buyer' THEN
    -- Mark resolved, note refunded; actual Stripe refund done in dashboard
    UPDATE marketplace_orders
      SET status = 'resolved', updated_at = now()
      WHERE id = p_order_id;
    -- Notify buyer
    INSERT INTO notifications (user_id, type, title, body, data)
      VALUES (v_order.buyer_id, 'dispute_resolved',
        '✅ Dispute resolved — refund issued',
        'Your dispute has been reviewed. A refund will appear within 5-10 business days.',
        jsonb_build_object('order_id', p_order_id));
    -- Notify seller
    INSERT INTO notifications (user_id, type, title, body, data)
      VALUES (v_order.seller_id, 'dispute_resolved',
        'Dispute resolved in favour of buyer',
        'After review the refund was issued. Funds will not be transferred.',
        jsonb_build_object('order_id', p_order_id));
    v_result := jsonb_build_object('ok', true, 'action', 'refund_buyer');

  ELSIF p_action = 'release_seller' THEN
    -- Mark delivered/completed; payout proceeds normally
    UPDATE marketplace_orders
      SET status = 'resolved', updated_at = now()
      WHERE id = p_order_id;
    -- Notify buyer
    INSERT INTO notifications (user_id, type, title, body, data)
      VALUES (v_order.buyer_id, 'dispute_resolved',
        'Dispute resolved — payment released',
        'After review, payment was released to the seller.',
        jsonb_build_object('order_id', p_order_id));
    -- Notify seller
    INSERT INTO notifications (user_id, type, title, body, data)
      VALUES (v_order.seller_id, 'dispute_resolved',
        '✅ Dispute resolved — payment released',
        'Your dispute was reviewed and payment will be released to you.',
        jsonb_build_object('order_id', p_order_id));
    v_result := jsonb_build_object('ok', true, 'action', 'release_seller');

  ELSIF p_action = 'close' THEN
    -- Close without action (e.g. buyer withdrew)
    UPDATE marketplace_orders
      SET status = 'resolved', updated_at = now()
      WHERE id = p_order_id;
    v_result := jsonb_build_object('ok', true, 'action', 'close');

  ELSE
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_dispute(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_dispute(uuid, text, text) TO authenticated;

-- ── 5. Index for fast dispute lookups ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_disputed
  ON public.marketplace_orders(status) WHERE status = 'disputed';

CREATE INDEX IF NOT EXISTS idx_listing_reports_status
  ON public.listing_reports(status) WHERE status = 'pending';

-- ── 6. Reload schema ──────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
