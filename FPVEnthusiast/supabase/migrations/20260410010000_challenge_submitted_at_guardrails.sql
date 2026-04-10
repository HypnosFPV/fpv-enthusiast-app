-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: challenge submitted_at guardrails
--
-- Why:
--   The weekly challenge ranking already breaks vote ties by earliest
--   submitted_at, then created_at. Some legacy rows were inserted without
--   submitted_at, which forced the fallback path and made the tie-break harder
--   to reason about.
--
-- What this does:
--   1. Ensures challenge_entries.submitted_at exists and defaults to now()
--   2. Backfills historic NULL submitted_at values from created_at
--   3. Adds a BEFORE INSERT trigger so explicit NULL inserts still receive a
--      deterministic submission timestamp
--   4. Marks submitted_at as NOT NULL so ranking can always rely on it
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.challenge_entries
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

ALTER TABLE public.challenge_entries
  ALTER COLUMN submitted_at SET DEFAULT now();

UPDATE public.challenge_entries
SET submitted_at = COALESCE(submitted_at, created_at, now())
WHERE submitted_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_challenge_entry_submitted_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.submitted_at := COALESCE(NEW.submitted_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_challenge_entry_submitted_at ON public.challenge_entries;
CREATE TRIGGER trg_set_challenge_entry_submitted_at
  BEFORE INSERT ON public.challenge_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_challenge_entry_submitted_at();

ALTER TABLE public.challenge_entries
  ALTER COLUMN submitted_at SET NOT NULL;

COMMENT ON FUNCTION public.set_challenge_entry_submitted_at() IS
  'Ensures every challenge entry records a submitted_at timestamp so weekly challenge tie-breaks always use submission time.';

NOTIFY pgrst, 'reload schema';
