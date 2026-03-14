-- ================================================================
-- Marketplace notifications + message insert fix
-- ================================================================

-- ── 1. Extend notifications.type to accept marketplace types ────────────────
-- The notifications table uses a text type with no DB-level check constraint,
-- so no ALTER is needed — just documenting the new values:
--   'new_message'    – buyer sent seller a message
--   'new_offer'      – buyer made an offer
--   'offer_accepted' – seller accepted a buyer's offer
--   'offer_declined' – seller declined a buyer's offer

-- ── 2. Fix marketplace_messages INSERT policy ──────────────────────────────
-- Previous policy was too strict for some edge cases.
-- Replace with a simpler, reliable policy.
ALTER TABLE public.marketplace_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "msg_parties_insert" ON public.marketplace_messages;
CREATE POLICY "msg_parties_insert"
  ON public.marketplace_messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND (auth.uid() = buyer_id OR auth.uid() = seller_id)
  );

-- ── 3. Ensure notifications table allows new types (add listing_id column) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications' AND column_name='listing_id'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN listing_id uuid
      REFERENCES public.marketplace_listings(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 4. RLS: allow service role to read user_push_tokens for sending pushes ──
-- (already set in challenge_notifications migration, re-asserting idempotently)
DROP POLICY IF EXISTS "upt_service_read" ON public.user_push_tokens;
CREATE POLICY "upt_service_read"
  ON public.user_push_tokens FOR SELECT
  USING (true);

NOTIFY pgrst, 'reload schema';
