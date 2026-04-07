-- =============================================================================
-- Migration: challenge admin advance + safe preset fallback
--
-- What this does:
--   1. Updates advance_weekly_challenge() so placeholder pool rows do not become
--      live challenge titles. If the next pool row is still a placeholder, the
--      function falls back to a small set of generic weekly challenge titles.
--   2. Adds admin_advance_weekly_challenge() so authenticated admins can safely
--      finalize an overdue weekly challenge from the app, create the next one,
--      and trigger challenge result notifications without needing service_role.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.advance_weekly_challenge()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closing    challenges%ROWTYPE;
  v_season_id  uuid;
  v_week_num   int;
  v_next_id    uuid;

  v_next_monday  timestamptz;
  v_sub_opens    timestamptz;
  v_sub_closes   timestamptz;
  v_vote_opens   timestamptz;
  v_vote_closes  timestamptz;

  v_next_title       text;
  v_next_description text;
  v_next_rules       text;

  v_suggestion_title text;
  v_suggestion_desc  text;
  v_suggestion_rules text;

  v_pool_id    uuid;
  v_pool_title text;
  v_pool_desc  text;
  v_pool_rules text;
BEGIN
  -- Step 1: Find challenge whose voting just closed
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

  -- Step 2: Finalize (awards top-3, marks completed)
  PERFORM finalize_challenge(v_closing.id);

  -- Step 3: Build next week's schedule
  --   Mon 00:00 → Fri 23:59:59  submission
  --   Sat 00:00 → Sun 23:59:59  voting
  v_next_monday := next_monday(v_closing.voting_closes_at);
  v_sub_opens   := v_next_monday;
  v_sub_closes  := v_next_monday + interval '4 days 23 hours 59 minutes 59 seconds';
  v_vote_opens  := v_next_monday + interval '5 days';
  v_vote_closes := v_next_monday + interval '6 days 23 hours 59 minutes 59 seconds';

  -- Step 4: Guard — skip if next week's challenge already exists
  IF EXISTS (
    SELECT 1 FROM challenges
    WHERE is_weekly = true AND submission_opens_at = v_sub_opens
  ) THEN
    RETURN format(
      'Challenge for week starting %s already exists — skipped.', v_sub_opens
    );
  END IF;

  -- Step 5: Title selection logic
  -- Priority 1: Top-voted suggestion for the closing challenge.
  SELECT s.title, s.description, NULL
  INTO   v_suggestion_title, v_suggestion_desc, v_suggestion_rules
  FROM   challenge_suggestions s
  WHERE  s.challenge_id = v_closing.id
  ORDER  BY s.vote_count DESC, s.created_at ASC
  LIMIT  1;

  IF v_suggestion_title IS NOT NULL AND btrim(v_suggestion_title) <> '' THEN
    v_next_title       := v_suggestion_title;
    v_next_description := COALESCE(v_suggestion_desc,
                            'Community-voted theme — show us your best FPV footage!');
    v_next_rules       := 'Max 60 seconds. FPV footage only. '
                          'No visible faces or personal info in OSD.';
  ELSE
    -- Priority 2: pool
    -- Pick lowest pool_order where used_at IS NULL
    SELECT id, title, description, rules
    INTO   v_pool_id, v_pool_title, v_pool_desc, v_pool_rules
    FROM   challenge_pool
    WHERE  used_at IS NULL
    ORDER  BY pool_order ASC
    LIMIT  1;

    -- Pool exhausted → reset all used_at and start over
    IF NOT FOUND THEN
      UPDATE challenge_pool SET used_at = NULL;

      SELECT id, title, description, rules
      INTO   v_pool_id, v_pool_title, v_pool_desc, v_pool_rules
      FROM   challenge_pool
      ORDER  BY pool_order ASC
      LIMIT  1;
    END IF;

    -- Mark this pool entry as used, even if its title is still a seeded placeholder.
    IF v_pool_id IS NOT NULL THEN
      UPDATE challenge_pool SET used_at = now() WHERE id = v_pool_id;
    END IF;

    IF v_pool_title IS NULL OR v_pool_title ILIKE 'PLACEHOLDER %' THEN
      v_next_title := CASE (extract(week FROM v_next_monday)::int % 6)
        WHEN 0 THEN 'Best Freestyle Line'
        WHEN 1 THEN 'Smoothest Flow'
        WHEN 2 THEN 'Most Creative Shot'
        WHEN 3 THEN 'Best Cinematic Clip'
        WHEN 4 THEN 'Cleanest Gap'
        ELSE        'Best Trick Combo'
      END;
      v_next_description := 'Show us your most impressive FPV footage this week!';
      v_next_rules       := 'Max 60 seconds. FPV footage only. No visible faces or personal info in OSD.';
    ELSE
      v_next_title       := v_pool_title;
      v_next_description := COALESCE(v_pool_desc,
                              'Show us your most impressive FPV footage this week!');
      v_next_rules       := COALESCE(v_pool_rules,
                              'Max 60 seconds. FPV footage only.');
    END IF;
  END IF;

  -- Step 6: Create next challenge
  v_season_id := v_closing.season_id;
  v_week_num  := COALESCE(v_closing.week_number, 0) + 1;

  INSERT INTO challenges (
    season_id, title, description, rules,
    submission_opens_at, submission_closes_at,
    voting_opens_at,     voting_closes_at,
    status, is_weekly, week_number,
    max_duration_seconds,
    prize_first_props, prize_second_props, prize_third_props,
    is_featured
  ) VALUES (
    v_season_id,
    v_next_title, v_next_description, v_next_rules,
    v_sub_opens,  v_sub_closes,
    v_vote_opens, v_vote_closes,
    'active', true, v_week_num,
    COALESCE(v_closing.max_duration_seconds, 60),
    COALESCE(v_closing.prize_first_props,  500),
    COALESCE(v_closing.prize_second_props, 300),
    COALESCE(v_closing.prize_third_props,  150),
    false
  )
  RETURNING id INTO v_next_id;

  RETURN format(
    'Finalized "%s". Next challenge "%s" (id=%s) live %s → %s.',
    v_closing.title,
    v_next_title, v_next_id,
    v_sub_opens,  v_vote_closes
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.advance_weekly_challenge() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.advance_weekly_challenge() TO service_role;

COMMENT ON FUNCTION public.advance_weekly_challenge() IS
  'Finalizes the most-recently-closed weekly challenge (top-3 props) and '
  'immediately creates the next one. Title priority: (1) top-voted community '
  'suggestion (ties broken by earliest submission), (2) next unused challenge_pool '
  'entry in pool_order sequence, with seeded placeholder titles falling back to '
  'generic default challenge names.';


CREATE OR REPLACE FUNCTION public.admin_advance_weekly_challenge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin            boolean := false;
  v_closing             challenges%ROWTYPE;
  v_next                challenges%ROWTYPE;
  v_result              text;
  v_suggestion_title    text;
  v_pool_title          text;
  v_selection_source    text := 'default';
  v_notifications_sent  integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(is_admin, false)
  INTO   v_is_admin
  FROM   public.users
  WHERE  id = auth.uid();

  IF v_is_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_closing
  FROM   public.challenges
  WHERE  status IN ('voting', 'active')
    AND  voting_closes_at <= now()
    AND  is_weekly = true
  ORDER  BY voting_closes_at DESC
  LIMIT  1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'No weekly challenge is ready to finalize.'
    );
  END IF;

  SELECT s.title
  INTO   v_suggestion_title
  FROM   public.challenge_suggestions s
  WHERE  s.challenge_id = v_closing.id
  ORDER  BY s.vote_count DESC, s.created_at ASC
  LIMIT  1;

  IF v_suggestion_title IS NOT NULL AND btrim(v_suggestion_title) <> '' THEN
    v_selection_source := 'suggestion';
  ELSE
    SELECT cp.title
    INTO   v_pool_title
    FROM   public.challenge_pool cp
    WHERE  cp.used_at IS NULL
    ORDER  BY cp.pool_order ASC
    LIMIT  1;

    IF v_pool_title IS NULL THEN
      SELECT cp.title
      INTO   v_pool_title
      FROM   public.challenge_pool cp
      ORDER  BY cp.pool_order ASC
      LIMIT  1;
    END IF;

    v_selection_source := CASE
      WHEN v_pool_title IS NULL OR v_pool_title ILIKE 'PLACEHOLDER %' THEN 'default'
      ELSE 'pool'
    END;
  END IF;

  v_result := public.advance_weekly_challenge();

  SELECT * INTO v_next
  FROM   public.challenges
  WHERE  is_weekly = true
    AND  id <> v_closing.id
    AND  submission_opens_at = next_monday(v_closing.voting_closes_at)
  ORDER  BY created_at DESC
  LIMIT  1;

  SELECT COALESCE(public.notify_challenge_results(v_closing.id), 0)
  INTO   v_notifications_sent;

  RETURN jsonb_build_object(
    'ok', true,
    'message', v_result,
    'closed_challenge_id', v_closing.id,
    'closed_challenge_title', v_closing.title,
    'next_challenge_id', v_next.id,
    'next_challenge_title', v_next.title,
    'selection_source', v_selection_source,
    'results_notifications_sent', v_notifications_sent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_advance_weekly_challenge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_advance_weekly_challenge() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_advance_weekly_challenge() TO service_role;

COMMENT ON FUNCTION public.admin_advance_weekly_challenge() IS
  'Admin-only wrapper for advance_weekly_challenge(). Finalizes the overdue '
  'weekly challenge, creates the next one, and triggers challenge result '
  'notifications without exposing service-role-only functions to the client.';

NOTIFY pgrst, 'reload schema';
