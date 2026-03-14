-- =====================================================================
-- 20260314_challenge_votes.sql
-- Creates the challenge_votes table and increment_vote RPC.
-- Safe to re-run (all statements are idempotent).
-- =====================================================================

-- 1. challenge_votes table
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.challenge_votes (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid         NOT NULL,
  voter_id   uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (entry_id, voter_id)          -- one vote per user per entry
);

-- FK to challenge_entries (added separately so it works even if
-- challenge_entries was created in a different migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'challenge_votes_entry_id_fkey'
  ) THEN
    ALTER TABLE public.challenge_votes
      ADD CONSTRAINT challenge_votes_entry_id_fkey
      FOREIGN KEY (entry_id) REFERENCES public.challenge_entries(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_challenge_votes_entry   ON public.challenge_votes (entry_id);
CREATE INDEX IF NOT EXISTS idx_challenge_votes_voter   ON public.challenge_votes (voter_id);

-- Row-level security
ALTER TABLE public.challenge_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cv_read       ON public.challenge_votes;
DROP POLICY IF EXISTS cv_insert     ON public.challenge_votes;
DROP POLICY IF EXISTS cv_delete     ON public.challenge_votes;

-- Anyone can read vote counts (anonymous browsing is fine)
CREATE POLICY cv_read ON public.challenge_votes
  FOR SELECT USING (true);

-- Authenticated users can cast votes
CREATE POLICY cv_insert ON public.challenge_votes
  FOR INSERT WITH CHECK (auth.uid() = voter_id);

-- Voters can retract their own vote
CREATE POLICY cv_delete ON public.challenge_votes
  FOR DELETE USING (auth.uid() = voter_id);


-- 2. increment_vote RPC
-- Atomically increments or decrements the vote_count on challenge_entries.
-- Called with p_entry_id and p_delta (+1 or -1).
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_vote(
  p_entry_id uuid,
  p_delta    integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.challenge_entries
  SET    vote_count = GREATEST(0, COALESCE(vote_count, 0) + p_delta)
  WHERE  id = p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_vote(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_vote(uuid, integer) TO authenticated;


-- 3. Make sure challenge_entries has a vote_count column (add if missing)
-- -----------------------------------------------------------------------
ALTER TABLE public.challenge_entries
  ADD COLUMN IF NOT EXISTS vote_count integer NOT NULL DEFAULT 0;

-- Backfill vote_count from actual votes (idempotent)
UPDATE public.challenge_entries ce
SET    vote_count = COALESCE(
         (SELECT COUNT(*) FROM public.challenge_votes cv WHERE cv.entry_id = ce.id),
         0
       );


-- 4. props_log: ensure 'challenge_vote' reason is accepted
--    (no schema change needed – reason is a text column with no CHECK constraint
--     in the standard migration, but we verify the dedup key is in place)
-- -----------------------------------------------------------------------
-- The UNIQUE constraint props_log_dedup (user_id, reason, reference_id)
-- is created in 20260311_props_log_and_awards.sql.
-- Nothing extra needed here.


-- =====================================================================
-- Verification query (optional – run manually to confirm)
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'challenge_votes';
-- =====================================================================

NOTIFY pgrst, 'reload schema';
