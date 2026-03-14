-- ================================================================
-- Marketplace Offers — Make Offer flow
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. marketplace_offers table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_offers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid        NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  buyer_id      uuid        NOT NULL REFERENCES auth.users(id),
  seller_id     uuid        NOT NULL REFERENCES auth.users(id),
  amount_cents  integer     NOT NULL CHECK (amount_cents > 0),
  note          text        CHECK (char_length(note) <= 300),
  status        text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired','cancelled')),
  order_id      uuid        REFERENCES public.marketplace_orders(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketplace_offers ENABLE ROW LEVEL SECURITY;

-- RLS: buyer + seller can read their own offers
DROP POLICY IF EXISTS "offers_parties_read"   ON public.marketplace_offers;
DROP POLICY IF EXISTS "offers_buyer_insert"   ON public.marketplace_offers;
DROP POLICY IF EXISTS "offers_parties_update" ON public.marketplace_offers;

CREATE POLICY "offers_parties_read"
  ON public.marketplace_offers FOR SELECT
  USING (auth.uid() IN (buyer_id, seller_id));

CREATE POLICY "offers_buyer_insert"
  ON public.marketplace_offers FOR INSERT
  WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "offers_parties_update"
  ON public.marketplace_offers FOR UPDATE
  USING (auth.uid() IN (buyer_id, seller_id));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_offers_listing  ON public.marketplace_offers (listing_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_buyer    ON public.marketplace_offers (buyer_id);
CREATE INDEX IF NOT EXISTS idx_offers_seller   ON public.marketplace_offers (seller_id, status);

-- ── 2. accept_offer() RPC ────────────────────────────────────────────────────
-- Called by the seller. Creates an order, declines all other pending offers,
-- marks listing as 'pending_sale'.
CREATE OR REPLACE FUNCTION public.accept_offer(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offer  public.marketplace_offers;
  v_order_id uuid;
BEGIN
  -- Fetch offer
  SELECT * INTO v_offer FROM public.marketplace_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  -- Only seller can accept
  IF v_offer.seller_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_seller');
  END IF;

  -- Only pending offers can be accepted
  IF v_offer.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_not_pending', 'status', v_offer.status);
  END IF;

  -- Create the order at offer price
  INSERT INTO public.marketplace_orders (
    listing_id, buyer_id, seller_id,
    amount_cents, platform_fee_cents, seller_payout_cents,
    status
  ) VALUES (
    v_offer.listing_id,
    v_offer.buyer_id,
    v_offer.seller_id,
    v_offer.amount_cents,
    -- 5 % platform fee, floored to nearest cent
    FLOOR(v_offer.amount_cents * 0.05)::integer,
    CEIL(v_offer.amount_cents * 0.95)::integer,
    'pending'
  )
  RETURNING id INTO v_order_id;

  -- Mark this offer as accepted and link the order
  UPDATE public.marketplace_offers
    SET status = 'accepted', order_id = v_order_id, updated_at = now()
  WHERE id = p_offer_id;

  -- Decline all other pending offers for the same listing
  UPDATE public.marketplace_offers
    SET status = 'declined', updated_at = now()
  WHERE listing_id = v_offer.listing_id
    AND id <> p_offer_id
    AND status = 'pending';

  -- Mark listing as pending_sale so it's off the market
  UPDATE public.marketplace_listings
    SET status = 'pending_sale', updated_at = now()
  WHERE id = v_offer.listing_id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id);
END;
$$;
REVOKE ALL    ON FUNCTION public.accept_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_offer(uuid) TO authenticated;

-- ── 3. decline_offer() RPC ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decline_offer(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offer public.marketplace_offers;
BEGIN
  SELECT * INTO v_offer FROM public.marketplace_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  -- Seller declines OR buyer cancels their own offer
  IF auth.uid() NOT IN (v_offer.seller_id, v_offer.buyer_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  IF v_offer.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_not_pending');
  END IF;

  UPDATE public.marketplace_offers
    SET status = CASE WHEN auth.uid() = v_offer.buyer_id THEN 'cancelled' ELSE 'declined' END,
        updated_at = now()
  WHERE id = p_offer_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL    ON FUNCTION public.decline_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_offer(uuid) TO authenticated;

-- ── 4. add pending_sale to marketplace_listings status check (if constrained) ─
-- Alter the check constraint to include pending_sale (idempotent via drop/add)
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_status_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
    CHECK (status IN ('active','sold','pending_sale','expired','draft'));

NOTIFY pgrst, 'reload schema';
