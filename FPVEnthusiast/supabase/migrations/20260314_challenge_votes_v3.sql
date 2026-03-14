-- =====================================================================
-- 20260314_challenge_votes_v3.sql
-- COMPLETE FIX — paste the entire block into Supabase SQL Editor → Run
-- Every statement is idempotent / safe to re-run.
-- =====================================================================


-- ── 1. challenge_votes table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_votes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid        NOT NULL,
  voter_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, voter_id)          -- one vote per user per entry
);

-- FK entry_id → challenge_entries (wrapped to survive re-runs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'challenge_votes_entry_id_fkey'
      AND table_name      = 'challenge_votes'
  ) THEN
    ALTER TABLE public.challenge_votes
      ADD CONSTRAINT challenge_votes_entry_id_fkey
      FOREIGN KEY (entry_id)
      REFERENCES public.challenge_entries(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_challenge_votes_entry ON public.challenge_votes (entry_id);
CREATE INDEX IF NOT EXISTS idx_challenge_votes_voter ON public.challenge_votes (voter_id);

-- RLS
ALTER TABLE public.challenge_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cv_read   ON public.challenge_votes;
DROP POLICY IF EXISTS cv_insert ON public.challenge_votes;
DROP POLICY IF EXISTS cv_delete ON public.challenge_votes;
CREATE POLICY cv_read   ON public.challenge_votes FOR SELECT USING (true);
CREATE POLICY cv_insert ON public.challenge_votes FOR INSERT WITH CHECK (auth.uid() = voter_id);
CREATE POLICY cv_delete ON public.challenge_votes FOR DELETE USING  (auth.uid() = voter_id);


-- ── 2. vote_count column on challenge_entries ─────────────────────────
ALTER TABLE public.challenge_entries
  ADD COLUMN IF NOT EXISTS vote_count integer NOT NULL DEFAULT 0;

-- Backfill from real votes
UPDATE public.challenge_entries ce
SET vote_count = (
  SELECT COUNT(*) FROM public.challenge_votes cv WHERE cv.entry_id = ce.id
);


-- ── 3. increment_vote RPC ─────────────────────────────────────────────
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
REVOKE ALL    ON FUNCTION public.increment_vote(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_vote(uuid, integer) TO authenticated;


-- ── 4. Open RLS on challenge_entries so all entries can be read ───────
ALTER TABLE public.challenge_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ce_read_all    ON public.challenge_entries;
DROP POLICY IF EXISTS ce_insert_self ON public.challenge_entries;
DROP POLICY IF EXISTS ce_update_self ON public.challenge_entries;
DROP POLICY IF EXISTS ce_delete_self ON public.challenge_entries;
CREATE POLICY ce_read_all    ON public.challenge_entries FOR SELECT USING (true);
CREATE POLICY ce_insert_self ON public.challenge_entries FOR INSERT WITH CHECK (auth.uid() = pilot_id);
CREATE POLICY ce_update_self ON public.challenge_entries FOR UPDATE  USING  (auth.uid() = pilot_id);
CREATE POLICY ce_delete_self ON public.challenge_entries FOR DELETE  USING  (auth.uid() = pilot_id);


-- ── 5. Open RLS on challenges ─────────────────────────────────────────
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ch_read_all ON public.challenges;
CREATE POLICY ch_read_all ON public.challenges FOR SELECT USING (true);


-- ── 6. props_log RLS (vote-reward INSERT must be allowed) ────────────
ALTER TABLE public.props_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pl_read_self   ON public.props_log;
DROP POLICY IF EXISTS pl_insert_self ON public.props_log;
CREATE POLICY pl_read_self   ON public.props_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY pl_insert_self ON public.props_log FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ── 7. Force challenge into VOTING phase for testing ─────────────────
--  (comment out after confirming voting works in production)
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM   public.challenges
  WHERE  status IN ('active','voting')
  ORDER  BY created_at DESC
  LIMIT  1;

  IF v_id IS NOT NULL THEN
    UPDATE public.challenges
    SET  submission_closes_at = now() - interval '1 hour',
         voting_opens_at      = now() - interval '1 hour',
         voting_closes_at     = now() + interval '7 days',
         status               = 'voting'
    WHERE id = v_id;
    RAISE NOTICE 'Challenge % → voting phase', v_id;
  ELSE
    RAISE NOTICE 'No active challenge found';
  END IF;
END $$;


-- ── Verification ──────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='challenge_votes')    AS votes_table,
  (SELECT COUNT(*) FROM information_schema.routines
   WHERE routine_schema='public' AND routine_name='increment_vote') AS rpc_exists,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='challenge_entries'
     AND column_name='vote_count')                                  AS vote_count_col,
  (SELECT submission_closes_at < now()
   FROM public.challenges WHERE status IN ('active','voting')
   ORDER BY created_at DESC LIMIT 1)                                AS is_voting_phase;

NOTIFY pgrst, 'reload schema';
