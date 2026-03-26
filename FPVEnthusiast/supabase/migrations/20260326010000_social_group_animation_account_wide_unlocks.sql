-- ══════════════════════════════════════════════════════════════════════════════
-- Social group animation unlocks become account-wide entitlements
-- Keeps group_id as the originating group context for analytics + post-purchase
-- activation, while ownership is now keyed by owner_user_id + variant_id.
-- ══════════════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN public.social_group_animation_purchases.group_id IS
  'Origin group context where the account-wide animation unlock was purchased.';

-- If a user already bought the same animation for multiple groups, keep the
-- earliest paid unlock and archive the extra duplicates.
WITH ranked_paid AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY owner_user_id, variant_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.social_group_animation_purchases
  WHERE status = 'paid'
)
UPDATE public.social_group_animation_purchases purchases
SET status = 'archived',
    updated_at = NOW()
FROM ranked_paid
WHERE purchases.id = ranked_paid.id
  AND ranked_paid.rn > 1;

-- Once a variant is paid on an account, any leftover pending rows for the same
-- user + variant are obsolete.
UPDATE public.social_group_animation_purchases pending
SET status = 'archived',
    updated_at = NOW()
WHERE pending.status = 'pending_payment'
  AND EXISTS (
    SELECT 1
    FROM public.social_group_animation_purchases paid
    WHERE paid.owner_user_id = pending.owner_user_id
      AND paid.variant_id = pending.variant_id
      AND paid.status = 'paid'
  );

-- If multiple pending rows remain for the same user + variant, keep the newest
-- attempt and archive the older stale rows.
WITH ranked_pending AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY owner_user_id, variant_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM public.social_group_animation_purchases
  WHERE status = 'pending_payment'
)
UPDATE public.social_group_animation_purchases purchases
SET status = 'archived',
    updated_at = NOW()
FROM ranked_pending
WHERE purchases.id = ranked_pending.id
  AND ranked_pending.rn > 1;

DROP INDEX IF EXISTS idx_group_animation_purchases_owner_group;
DROP INDEX IF EXISTS idx_group_animation_purchases_variant;

CREATE INDEX IF NOT EXISTS idx_group_animation_purchases_owner_created_at
  ON public.social_group_animation_purchases(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_group_animation_purchases_owner_variant
  ON public.social_group_animation_purchases(owner_user_id, variant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_animation_purchases_owner_variant_paid_unique
  ON public.social_group_animation_purchases(owner_user_id, variant_id)
  WHERE status = 'paid';

NOTIFY pgrst, 'reload schema';
