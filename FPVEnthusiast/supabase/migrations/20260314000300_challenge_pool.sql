-- =====================================================================
-- 20260314_challenge_pool.sql
--
-- 1. challenge_pool table  — premade challenge templates
--    used as fallback when no community suggestion exists for the week.
--    Rules:
--      • Selected in order (pool_order ASC), never repeated.
--      • Once exhausted (all used_at IS NOT NULL), the cycle resets
--        and starts over from the beginning.
--      • Tie-breaking on suggestions: highest vote_count, then earliest
--        created_at (already handled in advance_weekly_challenge).
--
-- 2. Updated advance_weekly_challenge() — replaces the 4-item rotating
--    CASE with the pool logic described above.
--
-- Safe to re-run.
-- =====================================================================


-- ── 1. challenge_pool table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_pool (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_order  integer     NOT NULL UNIQUE,   -- determines selection order
  title       text        NOT NULL,
  description text,
  rules       text,
  used_at     timestamptz,                   -- NULL = available, set when selected
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.challenge_pool ENABLE ROW LEVEL SECURITY;

-- Anyone can read the pool (admins manage via service_role / dashboard)
DROP POLICY IF EXISTS cp_read ON public.challenge_pool;
CREATE POLICY cp_read ON public.challenge_pool FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_challenge_pool_order ON public.challenge_pool (pool_order);

COMMENT ON TABLE  public.challenge_pool IS
  'Premade weekly challenge templates used when no community suggestion wins.';
COMMENT ON COLUMN public.challenge_pool.pool_order IS
  'Ascending selection order. Lowest unused pool_order is picked each week.';
COMMENT ON COLUMN public.challenge_pool.used_at IS
  'Set to now() when this template is selected. NULL = still available. '
  'When all rows are used the cycle resets (used_at cleared) and restarts.';


-- ── 2. Seed with 10 placeholder challenges ────────────────────────────────────
--    Replace these with your real challenge ideas before going live.
--    You can also INSERT more rows at any time — just give them unique pool_order values.

INSERT INTO public.challenge_pool (pool_order, title, description, rules) VALUES
  (1,  'PLACEHOLDER 1 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (2,  'PLACEHOLDER 2 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (3,  'PLACEHOLDER 3 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (4,  'PLACEHOLDER 4 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (5,  'PLACEHOLDER 5 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (6,  'PLACEHOLDER 6 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (7,  'PLACEHOLDER 7 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (8,  'PLACEHOLDER 8 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (9,  'PLACEHOLDER 9 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.'),
  (10, 'PLACEHOLDER 10 — Add your challenge title here',
       'Add a description.',
       'Max 60 seconds. FPV footage only.')
ON CONFLICT (pool_order) DO NOTHING;   -- skip if already seeded


-- ── 3. Helper: next Monday 00:00 UTC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION next_monday(from_ts timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT date_trunc('week', from_ts + interval '1 week')::timestamptz;
$$;


-- ── 4. Updated advance_weekly_challenge() ────────────────────────────────────
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

  -- ── Step 1: Find challenge whose voting just closed ───────────────────────
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

  -- ── Step 2: Finalize (awards top-3, marks completed) ─────────────────────
  PERFORM finalize_challenge(v_closing.id);

  -- ── Step 3: Build next week's schedule ───────────────────────────────────
  --   Mon 00:00 → Fri 23:59:59  submission
  --   Sat 00:00 → Sun 23:59:59  voting
  v_next_monday := next_monday(v_closing.voting_closes_at);
  v_sub_opens   := v_next_monday;
  v_sub_closes  := v_next_monday + interval '4 days 23 hours 59 minutes 59 seconds';
  v_vote_opens  := v_next_monday + interval '5 days';
  v_vote_closes := v_next_monday + interval '6 days 23 hours 59 minutes 59 seconds';

  -- ── Step 4: Guard — skip if next week's challenge already exists ──────────
  IF EXISTS (
    SELECT 1 FROM challenges
    WHERE is_weekly = true AND submission_opens_at = v_sub_opens
  ) THEN
    RETURN format(
      'Challenge for week starting %s already exists — skipped.', v_sub_opens
    );
  END IF;

  -- ── Step 5: Title selection logic ─────────────────────────────────────────
  --
  --   Priority 1: Top-voted suggestion for the closing challenge.
  --               Tie broken by earliest created_at (submitted first wins).
  --
  --   Priority 2: Next unused entry from challenge_pool (lowest pool_order).
  --               When all pool entries are used, reset and start over.
  --
  -- ── Priority 1: community suggestion ─────────────────────────────────────
  SELECT s.title, s.description, NULL
  INTO   v_suggestion_title, v_suggestion_desc, v_suggestion_rules
  FROM   challenge_suggestions s
  WHERE  s.challenge_id = v_closing.id
  ORDER  BY s.vote_count DESC, s.created_at ASC
  LIMIT  1;

  IF v_suggestion_title IS NOT NULL THEN
    v_next_title       := v_suggestion_title;
    v_next_description := COALESCE(v_suggestion_desc,
                            'Community-voted theme — show us your best FPV footage!');
    v_next_rules       := 'Max 60 seconds. FPV footage only. '
                          'No visible faces or personal info in OSD.';

  ELSE
    -- ── Priority 2: pool ───────────────────────────────────────────────────
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

    -- Mark this pool entry as used
    UPDATE challenge_pool SET used_at = now() WHERE id = v_pool_id;

    v_next_title       := v_pool_title;
    v_next_description := COALESCE(v_pool_desc,
                            'Show us your most impressive FPV footage this week!');
    v_next_rules       := COALESCE(v_pool_rules,
                            'Max 60 seconds. FPV footage only.');
  END IF;

  -- ── Step 6: Create next challenge ─────────────────────────────────────────
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
  'entry in pool_order sequence (resets when exhausted).';


-- ── Verification ─────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM public.challenge_pool)                         AS pool_rows,
  (SELECT COUNT(*) FROM public.challenge_pool WHERE used_at IS NULL)   AS pool_available,
  (SELECT routine_name FROM information_schema.routines
   WHERE routine_schema='public' AND routine_name='advance_weekly_challenge') AS fn_exists;

NOTIFY pgrst, 'reload schema';
