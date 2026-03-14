-- =====================================================================
-- FPV Challenge Voting — Complete Fix
-- Run this entire block in Supabase → SQL Editor → New Query → Run
-- Safe to re-run (all statements are idempotent)
-- =====================================================================


-- ─── STEP 1: challenge_votes table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.challenge_votes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid        NOT NULL,
  voter_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, voter_id)   -- one vote per user per entry
);

-- FK to challenge_entries (wrapped in DO block so re-runs don't error)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'challenge_votes_entry_id_fkey'
      AND table_name = 'challenge_votes'
  ) THEN
    ALTER TABLE public.challenge_votes
      ADD CONSTRAINT challenge_votes_entry_id_fkey
      FOREIGN KEY (entry_id)
      REFERENCES public.challenge_entries(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_challenge_votes_entry  ON public.challenge_votes (entry_id);
CREATE INDEX IF NOT EXISTS idx_challenge_votes_voter  ON public.challenge_votes (voter_id);

-- RLS
ALTER TABLE public.challenge_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cv_read   ON public.challenge_votes;
DROP POLICY IF EXISTS cv_insert ON public.challenge_votes;
DROP POLICY IF EXISTS cv_delete ON public.challenge_votes;

CREATE POLICY cv_read   ON public.challenge_votes FOR SELECT USING (true);
CREATE POLICY cv_insert ON public.challenge_votes FOR INSERT WITH CHECK (auth.uid() = voter_id);
CREATE POLICY cv_delete ON public.challenge_votes FOR DELETE USING (auth.uid() = voter_id);


-- ─── STEP 2: vote_count column on challenge_entries ──────────────────────────

ALTER TABLE public.challenge_entries
  ADD COLUMN IF NOT EXISTS vote_count integer NOT NULL DEFAULT 0;

-- Backfill from real votes (safe to re-run)
UPDATE public.challenge_entries ce
SET vote_count = (
  SELECT COUNT(*) FROM public.challenge_votes cv WHERE cv.entry_id = ce.id
);


-- ─── STEP 3: increment_vote RPC ──────────────────────────────────────────────

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

REVOKE ALL   ON FUNCTION public.increment_vote(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_vote(uuid, integer) TO authenticated;


-- ─── STEP 4: RLS on challenge_entries (read must be open) ────────────────────
-- Voting requires reading other pilots' entries.
-- If challenge_entries already has RLS enabled, make sure there is a
-- public SELECT policy so loadEntries() can fetch all entries.

ALTER TABLE public.challenge_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ce_read_all    ON public.challenge_entries;
DROP POLICY IF EXISTS ce_insert_self ON public.challenge_entries;
DROP POLICY IF EXISTS ce_update_self ON public.challenge_entries;
DROP POLICY IF EXISTS ce_delete_self ON public.challenge_entries;

CREATE POLICY ce_read_all    ON public.challenge_entries FOR SELECT USING (true);
CREATE POLICY ce_insert_self ON public.challenge_entries FOR INSERT
  WITH CHECK (auth.uid() = pilot_id);
CREATE POLICY ce_update_self ON public.challenge_entries FOR UPDATE
  USING (auth.uid() = pilot_id);
CREATE POLICY ce_delete_self ON public.challenge_entries FOR DELETE
  USING (auth.uid() = pilot_id);


-- ─── STEP 5: RLS on challenges table (must be readable) ──────────────────────

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ch_read_all ON public.challenges;
CREATE POLICY ch_read_all ON public.challenges FOR SELECT USING (true);


-- ─── STEP 6: Advance challenge to VOTING phase for testing ───────────────────
-- If your challenge is still in "submission" phase the Vote button will never
-- appear regardless of code fixes.  This moves the first active challenge's
-- submission window into the past so the app sees it as voting phase.
--
-- ONLY run this block while testing. Comment it out for production.
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.challenges
  WHERE status IN ('active', 'voting')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.challenges
    SET
      submission_closes_at = now() - interval '1 hour',
      voting_opens_at      = now() - interval '1 hour',
      voting_closes_at     = now() + interval '7 days'
    WHERE id = v_id;
    RAISE NOTICE 'Challenge % moved to voting phase', v_id;
  ELSE
    RAISE NOTICE 'No active challenge found — skipped timestamp update';
  END IF;
END $$;


-- ─── STEP 7: props_log RLS (vote-reward insert must be allowed) ──────────────

ALTER TABLE public.props_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pl_insert_self ON public.props_log;
DROP POLICY IF EXISTS pl_read_self   ON public.props_log;

CREATE POLICY pl_read_self   ON public.props_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY pl_insert_self ON public.props_log FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ─── Verification ────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'challenge_votes')   AS votes_table_exists,
  (SELECT COUNT(*) FROM information_schema.routines
   WHERE routine_schema = 'public' AND routine_name = 'increment_vote') AS rpc_exists,
  (SELECT submission_closes_at < now()
   FROM public.challenges WHERE status IN ('active','voting')
   ORDER BY created_at DESC LIMIT 1)                                    AS is_voting_phase;

NOTIFY pgrst, 'reload schema';
