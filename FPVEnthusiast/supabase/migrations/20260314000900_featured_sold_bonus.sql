-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: featured_sold_bonus
-- When a marketplace listing transitions to status = 'sold' while it is
-- currently featured (is_featured = true, featured_until > now()), the seller
-- automatically receives +500 props as a "Sold while featured!" bonus.
--
-- Implementation:
--   • A trigger function award_featured_sold_bonus() runs AFTER UPDATE on
--     marketplace_listings whenever status changes to 'sold'.
--   • It checks is_featured = true AND featured_until > now().
--   • Awards 500 props: updates users.total_props + lifetime_props, inserts a
--     props_log row with reason = 'featured_sold_bonus'.
--   • Idempotent: uses ON CONFLICT DO NOTHING on props_log (unique constraint
--     on user_id + reason + reference_id) so re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigger function ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_featured_sold_bonus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bonus   int  := 500;
  v_seller  uuid;
BEGIN
  -- Only fire when status just became 'sold' (not on every update)
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'sold' THEN
    RETURN NEW;
  END IF;

  -- Only award if listing was actively featured at time of sale
  IF NOT (NEW.is_featured = true AND NEW.featured_until > now()) THEN
    RETURN NEW;
  END IF;

  v_seller := NEW.seller_id;

  -- Award props to seller
  UPDATE public.users
  SET
    total_props    = COALESCE(total_props,    0) + v_bonus,
    lifetime_props = COALESCE(lifetime_props, 0) + v_bonus,
    earned_props   = COALESCE(earned_props,   0) + v_bonus
  WHERE id = v_seller;

  -- Log the award (idempotent via unique constraint)
  INSERT INTO public.props_log (user_id, amount, reason, reference_id)
  VALUES (v_seller, v_bonus, 'featured_sold_bonus', NEW.id)
  ON CONFLICT (user_id, reason, reference_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── 2. Attach trigger to marketplace_listings ─────────────────────────────────
DROP TRIGGER IF EXISTS trg_featured_sold_bonus ON public.marketplace_listings;

CREATE TRIGGER trg_featured_sold_bonus
  AFTER UPDATE OF status ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.award_featured_sold_bonus();

-- ── 3. Grant execute (SECURITY DEFINER so it runs as owner, not caller) ───────
-- No explicit GRANT needed for trigger functions; they run as the definer.
-- But notify PostgREST to reload schema cache.
NOTIFY pgrst, 'reload schema';
