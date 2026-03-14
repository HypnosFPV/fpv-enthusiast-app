-- =====================================================================
-- 20260314_auto_advance_challenge.sql
--
-- Automates the weekly challenge lifecycle:
--
--   1. advance_weekly_challenge()
--      ├─ Calls finalize_challenge() on the just-closed challenge
--      │    → sets top-3 final_rank, props_awarded, status='winner'
--      │    → marks challenge status='completed'
--      ├─ Picks the top-voted suggestion as the next challenge title
--      │    (falls back to a default if no suggestions exist)
--      └─ Creates + activates the next weekly challenge immediately
--         with a standard Mon-Fri submission / Sat-Sun voting schedule
--         anchored to the Monday AFTER voting closes.
--
--   2. Supabase pg_cron job (if pg_cron is enabled on your project)
--      Runs advance_weekly_challenge() every Monday at 00:05 UTC.
--      If pg_cron is not available, call the function manually or via
--      an Edge Function / external cron.
--
-- Safe to re-run.
-- =====================================================================


-- ── Helper: get the next Monday 00:00 UTC from any timestamp ─────────────────
CREATE OR REPLACE FUNCTION next_monday(from_ts timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('week', from_ts + interval '1 week')::timestamptz;
$$;


-- ── Core function: finalize current challenge + spin up next one ──────────────
CREATE OR REPLACE FUNCTION public.advance_weekly_challenge()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closing    challenges%ROWTYPE;   -- challenge whose voting just closed
  v_season_id  uuid;
  v_week_num   int;
  v_next_id    uuid;

  -- Next challenge schedule (anchored to next Monday)
  v_next_monday        timestamptz;
  v_sub_opens          timestamptz;
  v_sub_closes         timestamptz;
  v_vote_opens         timestamptz;
  v_vote_closes        timestamptz;

  -- Suggestion pick
  v_next_title         text;
  v_next_description   text;
  v_next_rules         text;
  v_suggestion_id      uuid;
  v_suggestion_title   text;
BEGIN

  -- ── 1. Find the challenge that should be finalized right now ────────────────
  --   Either already status='voting' AND voting_closes_at is in the past,
  --   OR still status='active'/'voting' but voting_closes_at has passed.
  SELECT * INTO v_closing
  FROM   challenges
  WHERE  status IN ('voting', 'active')
    AND  voting_closes_at <= now()
    AND  is_weekly = true
  ORDER  BY voting_closes_at DESC
  LIMIT  1;

  IF NOT FOUND THEN
    RETURN 'No challenge ready to finalize — voting window not yet closed.';
  END IF;

  -- ── 2. Finalize the closing challenge (awards top-3, marks completed) ───────
  PERFORM finalize_challenge(v_closing.id);

  -- ── 3. Determine next challenge schedule ────────────────────────────────────
  --   Next Monday = the Monday immediately after voting_closes_at
  --   Schedule:  Mon 00:00 → Fri 23:59  submission
  --              Sat 00:00 → Sun 23:59  voting
  v_next_monday := next_monday(v_closing.voting_closes_at);

  v_sub_opens   := v_next_monday;                                 -- Mon 00:00
  v_sub_closes  := v_next_monday + interval '4 days 23 hours 59 minutes 59 seconds'; -- Fri 23:59:59
  v_vote_opens  := v_next_monday + interval '5 days';             -- Sat 00:00
  v_vote_closes := v_next_monday + interval '6 days 23 hours 59 minutes 59 seconds'; -- Sun 23:59:59

  -- ── 4. Pick best suggestion as next title (or fall back to default) ──────────
  --   Top-voted suggestion for the closing challenge that hasn't been used yet.
  SELECT id, title
  INTO   v_suggestion_id, v_suggestion_title
  FROM   challenge_suggestions
  WHERE  challenge_id = v_closing.id
  ORDER  BY vote_count DESC, created_at ASC
  LIMIT  1;

  IF v_suggestion_title IS NOT NULL THEN
    v_next_title       := v_suggestion_title;
    v_next_description := 'Community-voted theme — show us your best FPV footage!';
    v_next_rules       := 'Max 60 seconds. FPV footage only. No visible faces or personal info in OSD.';
  ELSE
    -- Rotating fallback themes
    v_next_title       := CASE (extract(week FROM v_next_monday)::int % 4)
      WHEN 0 THEN 'Best Freestyle Line'
      WHEN 1 THEN 'Smoothest Flow'
      WHEN 2 THEN 'Most Creative Shot'
      ELSE        'Best Cinematic Clip'
    END;
    v_next_description := 'Show us your most impressive FPV footage this week!';
    v_next_rules       := 'Max 60 seconds. FPV footage only. No visible faces or personal info in OSD.';
  END IF;

  -- ── 5. Season: reuse same season as closing challenge (auto-advance optional) ─
  v_season_id := v_closing.season_id;

  -- ── 6. Week number: closing + 1 ─────────────────────────────────────────────
  v_week_num := COALESCE(v_closing.week_number, 0) + 1;

  -- ── 7. Guard: don't create if one already exists for that window ─────────────
  IF EXISTS (
    SELECT 1 FROM challenges
    WHERE is_weekly = true
      AND submission_opens_at = v_sub_opens
  ) THEN
    RETURN format(
      'Challenge for week starting %s already exists — skipped.',
      v_sub_opens
    );
  END IF;

  -- ── 8. Insert next challenge ─────────────────────────────────────────────────
  INSERT INTO challenges (
    season_id,
    title,
    description,
    rules,
    submission_opens_at,
    submission_closes_at,
    voting_opens_at,
    voting_closes_at,
    status,
    is_weekly,
    week_number,
    max_duration_seconds,
    prize_first_props,
    prize_second_props,
    prize_third_props,
    is_featured
  ) VALUES (
    v_season_id,
    v_next_title,
    v_next_description,
    v_next_rules,
    v_sub_opens,
    v_sub_closes,
    v_vote_opens,
    v_vote_closes,
    'active',
    true,
    v_week_num,
    COALESCE(v_closing.max_duration_seconds, 60),
    COALESCE(v_closing.prize_first_props,  500),
    COALESCE(v_closing.prize_second_props, 300),
    COALESCE(v_closing.prize_third_props,  150),
    false
  )
  RETURNING id INTO v_next_id;

  RETURN format(
    'Challenge "%s" (id=%s) finalized. Next challenge "%s" (id=%s) created for %s → %s.',
    v_closing.title, v_closing.id,
    v_next_title,    v_next_id,
    v_sub_opens,     v_vote_closes
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.advance_weekly_challenge() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.advance_weekly_challenge() TO service_role;

COMMENT ON FUNCTION public.advance_weekly_challenge() IS
  'Finalizes the most-recently-closed weekly challenge (awards top-3 props) '
  'and immediately creates the next weekly challenge on the standard Mon–Sun schedule. '
  'Call every Monday at 00:05 UTC via pg_cron or an Edge Function.';


-- ── pg_cron job (Supabase Pro / Team plans only) ─────────────────────────────
-- Uncomment the block below if pg_cron is available on your project.
-- Check: SELECT * FROM pg_extension WHERE extname = 'pg_cron';
--
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     PERFORM cron.unschedule('advance-weekly-challenge');
--     PERFORM cron.schedule(
--       'advance-weekly-challenge',
--       '5 0 * * 1',          -- 00:05 UTC every Monday
--       $$SELECT public.advance_weekly_challenge();$$
--     );
--     RAISE NOTICE 'pg_cron job scheduled: advance-weekly-challenge';
--   ELSE
--     RAISE NOTICE 'pg_cron not available — call advance_weekly_challenge() manually or via Edge Function.';
--   END IF;
-- END $$;


-- ── Verification ─────────────────────────────────────────────────────────────
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('advance_weekly_challenge', 'finalize_challenge', 'next_monday')
ORDER BY routine_name;

NOTIFY pgrst, 'reload schema';
