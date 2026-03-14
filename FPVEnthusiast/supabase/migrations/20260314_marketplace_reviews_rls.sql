-- ================================================================
-- Marketplace Reviews — RLS hardening & idempotency guard
-- Ensures: one review per order, buyer only, delivered/completed orders
-- ================================================================

-- Already created in marketplace_phase2.sql, but re-apply idempotently
-- to ensure policies exist even on fresh installs.

-- Public can read all reviews (for seller profile pages)
DROP POLICY IF EXISTS "reviews_public_read" ON public.marketplace_reviews;
CREATE POLICY "reviews_public_read"
  ON public.marketplace_reviews FOR SELECT USING (true);

-- Only the buyer of a delivered/completed order can insert a review
DROP POLICY IF EXISTS "reviews_insert_buyer" ON public.marketplace_reviews;
CREATE POLICY "reviews_insert_buyer"
  ON public.marketplace_reviews FOR INSERT
  WITH CHECK (
    auth.uid() = reviewer_id
    AND EXISTS (
      SELECT 1 FROM public.marketplace_orders
      WHERE id        = order_id
        AND buyer_id  = auth.uid()
        AND status    IN ('delivered', 'completed')
    )
  );

-- Reviewer can update their own review (e.g. edit comment within 24h)
DROP POLICY IF EXISTS "reviews_owner_update" ON public.marketplace_reviews;
CREATE POLICY "reviews_owner_update"
  ON public.marketplace_reviews FOR UPDATE
  USING (auth.uid() = reviewer_id);

-- Ensure RLS is on
ALTER TABLE public.marketplace_reviews ENABLE ROW LEVEL SECURITY;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
