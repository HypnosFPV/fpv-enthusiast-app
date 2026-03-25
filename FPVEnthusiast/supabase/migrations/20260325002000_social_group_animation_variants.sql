-- ══════════════════════════════════════════════════════════════════════════════
-- Social group card animation purchases + selection
-- Adds a per-group active animation variant and tracks owned animation tiers.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.social_group_theme_preferences
  ADD COLUMN IF NOT EXISTS active_animation_variant_id TEXT NOT NULL DEFAULT 'none'
  CHECK (active_animation_variant_id IN ('none', 'basic', 'standard', 'premium'));

UPDATE public.social_group_theme_preferences
SET active_animation_variant_id = 'none'
WHERE active_animation_variant_id IS NULL;

CREATE TABLE IF NOT EXISTS public.social_group_animation_purchases (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  owner_user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  variant_id            TEXT NOT NULL CHECK (variant_id IN ('basic', 'standard', 'premium')),
  status                TEXT NOT NULL DEFAULT 'pending_payment'
                        CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'archived')),
  stripe_payment_intent TEXT,
  purchase_amount_cents INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_animation_purchases_owner_group
  ON public.social_group_animation_purchases(owner_user_id, group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_animation_purchases_pi
  ON public.social_group_animation_purchases(stripe_payment_intent);
CREATE INDEX IF NOT EXISTS idx_group_animation_purchases_variant
  ON public.social_group_animation_purchases(owner_user_id, group_id, variant_id);

DROP TRIGGER IF EXISTS trg_social_group_animation_purchases_updated_at ON public.social_group_animation_purchases;
CREATE TRIGGER trg_social_group_animation_purchases_updated_at
  BEFORE UPDATE ON public.social_group_animation_purchases
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.social_group_animation_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_group_animation_purchases_select ON public.social_group_animation_purchases;
CREATE POLICY social_group_animation_purchases_select ON public.social_group_animation_purchases
  FOR SELECT USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS social_group_animation_purchases_insert ON public.social_group_animation_purchases;
CREATE POLICY social_group_animation_purchases_insert ON public.social_group_animation_purchases
  FOR INSERT WITH CHECK (
    auth.uid() = owner_user_id
    AND EXISTS (
      SELECT 1
      FROM public.social_group_members gm
      WHERE gm.group_id = social_group_animation_purchases.group_id
        AND gm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS social_group_animation_purchases_update ON public.social_group_animation_purchases;
CREATE POLICY social_group_animation_purchases_update ON public.social_group_animation_purchases
  FOR UPDATE USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS social_group_animation_purchases_delete ON public.social_group_animation_purchases;
CREATE POLICY social_group_animation_purchases_delete ON public.social_group_animation_purchases
  FOR DELETE USING (auth.uid() = owner_user_id);

NOTIFY pgrst, 'reload schema';
