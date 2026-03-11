-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: challenge props pipeline
-- File: supabase/migrations/20260311_challenge_props_finalize.sql
--
-- What this does:
--   1. Trigger: auto-updates users.total_props whenever
--      challenge_entries.props_awarded changes (covers any future award path)
--   2. RPC: finalize_challenge(p_challenge_id) — call once per challenge
--      after voting_closes_at passes. Determines top-3, sets final_rank,
--      props_awarded, status = 'winner', then marks challenge 'completed'.
--      The trigger in (1) handles propagating props to users.total_props.
--   3. Leaderboard views — recreated to source from the right columns.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigger: keep users.total_props in sync ───────────────────────────────

CREATE OR REPLACE FUNCTION sync_user_props_from_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No-op if props_awarded didn't actually change
  IF NEW.props_awarded IS NOT DISTINCT FROM OLD.props_awarded THEN
    RETURN NEW;
  END IF;

  UPDATE users
  SET total_props = GREATEST(0, COALESCE(total_props, 0)
                              + COALESCE(NEW.props_awarded, 0)
                              - COALESCE(OLD.props_awarded, 0))
  WHERE id = NEW.pilot_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_props ON challenge_entries;
CREATE TRIGGER trg_sync_user_props
  AFTER UPDATE OF props_awarded ON challenge_entries
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_props_from_entry();

-- ── 2. RPC: finalize_challenge ───────────────────────────────────────────────
-- Usage:  SELECT finalize_challenge('<challenge-uuid>');
-- Safe to call multiple times — no-ops if already completed.

CREATE OR REPLACE FUNCTION finalize_challenge(p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ch     challenges%ROWTYPE;
  v_rank   int := 1;
  v_entry  challenge_entries%ROWTYPE;
  v_props  int;
BEGIN
  -- Fetch + lock the challenge row
  SELECT * INTO v_ch
  FROM challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  -- Guard: already completed or not found
  IF NOT FOUND THEN
    RAISE NOTICE 'finalize_challenge: challenge % not found', p_challenge_id;
    RETURN;
  END IF;
  IF v_ch.status = 'completed' THEN
    RAISE NOTICE 'finalize_challenge: challenge % already completed', p_challenge_id;
    RETURN;
  END IF;

  -- Award top-3 entries by vote_count (ties broken by earliest submission)
  FOR v_entry IN
    SELECT *
    FROM challenge_entries
    WHERE challenge_id = p_challenge_id
      AND status NOT IN ('disqualified')
    ORDER BY vote_count DESC, submitted_at ASC NULLS LAST, created_at ASC
    LIMIT 3
  LOOP
    v_props := CASE v_rank
      WHEN 1 THEN COALESCE(v_ch.prize_first_props,  500)
      WHEN 2 THEN COALESCE(v_ch.prize_second_props, 300)
      WHEN 3 THEN COALESCE(v_ch.prize_third_props,  150)
      ELSE 0
    END;

    UPDATE challenge_entries
    SET
      final_rank    = v_rank,
      props_awarded = v_props,
      status        = 'winner'
    WHERE id = v_entry.id;
    -- ↑ triggers trg_sync_user_props → updates users.total_props automatically

    v_rank := v_rank + 1;
  END LOOP;

  -- Mark challenge as completed
  UPDATE challenges
  SET status = 'completed'
  WHERE id = p_challenge_id;

  RAISE NOTICE 'finalize_challenge: challenge % finalized, % winners awarded', p_challenge_id, v_rank - 1;
END;
$$;

-- Grant execute to authenticated users (admin-only in practice via RLS / role check)
-- You may want to restrict this further with a role check inside the function.
REVOKE ALL ON FUNCTION finalize_challenge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_challenge(uuid) TO service_role;

-- ── 3. Leaderboard views ─────────────────────────────────────────────────────
-- leaderboard_global  — all-time, sourced from users.total_props
-- leaderboard_season  — per season, aggregated from challenge_entries.props_awarded

DROP VIEW IF EXISTS leaderboard_global;
CREATE VIEW leaderboard_global AS
SELECT
  u.id                                                              AS user_id,
  u.username,
  u.avatar_url,
  COALESCE(u.city, '')                                              AS city,
  COALESCE(u.country, '')                                           AS country,
  CASE
    WHEN u.city    IS NOT NULL AND u.country IS NOT NULL
      THEN u.city || ', ' || u.country
    WHEN u.city    IS NOT NULL THEN u.city
    WHEN u.country IS NOT NULL THEN u.country
    ELSE NULL
  END                                                               AS location_label,
  COALESCE(u.total_props, 0)                                        AS earned_props,
  RANK() OVER (ORDER BY COALESCE(u.total_props, 0) DESC)            AS rank
FROM users u
WHERE COALESCE(u.total_props, 0) > 0;

DROP VIEW IF EXISTS leaderboard_season;
CREATE VIEW leaderboard_season AS
SELECT
  ce.pilot_id                                                       AS user_id,
  u.username,
  u.avatar_url,
  c.season_id,
  SUM(COALESCE(ce.props_awarded, 0))                                AS earned,
  RANK() OVER (
    PARTITION BY c.season_id
    ORDER BY SUM(COALESCE(ce.props_awarded, 0)) DESC
  )                                                                 AS rank
FROM challenge_entries ce
JOIN challenges c ON c.id = ce.challenge_id
JOIN users      u ON u.id = ce.pilot_id
WHERE ce.props_awarded > 0
GROUP BY ce.pilot_id, u.username, u.avatar_url, c.season_id;
