-- ── Counter-offer + buyer notifications ──────────────────────────────────────

-- 1. Add counter_amount_cents to marketplace_offers
ALTER TABLE public.marketplace_offers
  ADD COLUMN IF NOT EXISTS counter_amount_cents INTEGER;

-- 2. Add 'countered' to offer status constraint
ALTER TABLE public.marketplace_offers
  DROP CONSTRAINT IF EXISTS marketplace_offers_status_check;
ALTER TABLE public.marketplace_offers
  ADD CONSTRAINT marketplace_offers_status_check
  CHECK (status IN ('pending','accepted','declined','expired','cancelled','countered'));

-- 3. Add notification types for offer events
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'like','comment','follow','mention','reply',
    'challenge_voting_open','challenge_voting_closing','challenge_result',
    'new_message','new_offer',
    'offer_accepted','offer_declined','offer_countered'
  ));

-- 4. RPC: counter_offer(p_offer_id, p_counter_cents)
CREATE OR REPLACE FUNCTION public.counter_offer(
  p_offer_id     UUID,
  p_counter_cents INTEGER
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_offer  marketplace_offers%ROWTYPE;
BEGIN
  SELECT * INTO v_offer FROM public.marketplace_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'Offer not found');
  END IF;
  -- Only seller can counter
  IF v_offer.seller_id <> auth.uid() THEN
    RETURN json_build_object('ok', false, 'error', 'Not authorised');
  END IF;
  IF v_offer.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'Offer is no longer pending');
  END IF;
  IF p_counter_cents <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Counter price must be greater than zero');
  END IF;

  UPDATE public.marketplace_offers
  SET status              = 'countered',
      counter_amount_cents = p_counter_cents,
      updated_at          = NOW()
  WHERE id = p_offer_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.counter_offer(UUID, INTEGER) TO authenticated;

-- 5. Reload
NOTIFY pgrst, 'reload schema';
