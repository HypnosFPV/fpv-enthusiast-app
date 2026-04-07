-- =============================================================================
-- Migration: challenge winner props history
--
-- Purpose:
--   1. Ensure weekly challenge winner awards appear in Props History.
--   2. Preserve existing wallet / leaderboard updates when props_awarded changes.
--   3. Backfill props_events rows for already-finalized challenge winners.
--
-- Notes:
--   - Profile Props History already reads from props_events.
--   - Winner entries already store final_rank + props_awarded.
--   - This migration logs those awards as challenge_winner_1/2/3 events keyed by
--     challenge_id so they appear in the history UI without double-awarding props.
-- =============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS lifetime_props integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.sync_user_props_from_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta        integer;
  v_reference_id text;
  v_event_type   text;
BEGIN
  IF NEW.props_awarded IS NOT DISTINCT FROM OLD.props_awarded
     AND NEW.final_rank IS NOT DISTINCT FROM OLD.final_rank THEN
    RETURN NEW;
  END IF;

  v_delta := COALESCE(NEW.props_awarded, 0) - COALESCE(OLD.props_awarded, 0);

  IF v_delta <> 0 THEN
    UPDATE public.users
    SET
      total_props    = GREATEST(0, COALESCE(total_props,    0) + v_delta),
      lifetime_props = GREATEST(0, COALESCE(lifetime_props, 0) + v_delta)
    WHERE id = NEW.pilot_id;
  END IF;

  v_reference_id := NEW.challenge_id::text;

  IF OLD.final_rank BETWEEN 1 AND 3
     AND (
       NEW.final_rank IS DISTINCT FROM OLD.final_rank
       OR COALESCE(NEW.props_awarded, 0) <= 0
     ) THEN
    DELETE FROM public.props_events
    WHERE user_id = NEW.pilot_id
      AND reference_id = v_reference_id
      AND event_type = ('challenge_winner_' || OLD.final_rank::text);
  END IF;

  IF NEW.final_rank BETWEEN 1 AND 3
     AND COALESCE(NEW.props_awarded, 0) > 0 THEN
    v_event_type := 'challenge_winner_' || NEW.final_rank::text;

    INSERT INTO public.props_events (user_id, event_type, props_amount, reference_id, created_at)
    VALUES (
      NEW.pilot_id,
      v_event_type,
      COALESCE(NEW.props_awarded, 0),
      v_reference_id,
      COALESCE(NEW.updated_at, now())
    )
    ON CONFLICT (user_id, event_type, reference_id)
    DO UPDATE SET
      props_amount = EXCLUDED.props_amount;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill history rows for any already-finalized challenge winners.
INSERT INTO public.props_events (user_id, event_type, props_amount, reference_id, created_at)
SELECT
  ce.pilot_id,
  CASE ce.final_rank
    WHEN 1 THEN 'challenge_winner_1'
    WHEN 2 THEN 'challenge_winner_2'
    WHEN 3 THEN 'challenge_winner_3'
  END,
  COALESCE(ce.props_awarded, 0),
  ce.challenge_id::text,
  COALESCE(c.voting_closes_at, ce.updated_at, ce.created_at, now())
FROM public.challenge_entries ce
JOIN public.challenges c
  ON c.id = ce.challenge_id
WHERE ce.final_rank IN (1, 2, 3)
  AND COALESCE(ce.props_awarded, 0) > 0
ON CONFLICT (user_id, event_type, reference_id)
DO UPDATE SET
  props_amount = EXCLUDED.props_amount;

COMMENT ON FUNCTION public.sync_user_props_from_entry() IS
  'Keeps challenge winner props in sync with user balances and logs challenge_winner_* events so Props History shows 1st/2nd/3rd place rewards.';

NOTIFY pgrst, 'reload schema';
