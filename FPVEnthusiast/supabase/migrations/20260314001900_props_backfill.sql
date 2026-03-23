-- ================================================================
-- Props columns back-fill
-- ================================================================
--
-- Root cause: The original apply_props_log trigger (20260311) only
-- updated users.total_props.  earned_props and lifetime_props were
-- never written for props_log rows that existed before the
-- leaderboard-fix migration (20260314_props_leaderboard_fix).
-- The leaderboard fix tried to back-fill lifetime_props from
-- earned_props, but earned_props was ALSO 0, so both stayed 0.
--
-- Fix: recompute earned_props and lifetime_props directly from
-- the authoritative props_log table (sum of all positive awards),
-- then union in any additional amounts from props_events awards.
-- Safe to run multiple times — uses GREATEST() so it only ever
-- increases the counters, never decreases.
-- ================================================================

-- ── Step 1: back-fill from props_log (first_post, easter_egg, etc.) ──────────
UPDATE public.users u
SET
  earned_props   = GREATEST(
                     COALESCE(u.earned_props,   0),
                     COALESCE(pl.log_total,     0)
                   ),
  lifetime_props = GREATEST(
                     COALESCE(u.lifetime_props, 0),
                     COALESCE(pl.log_total,     0)
                   )
FROM (
  SELECT user_id, SUM(amount) AS log_total
  FROM   public.props_log
  GROUP  BY user_id
) pl
WHERE u.id = pl.user_id;

-- ── Step 2: also fold in any props_events awards not in props_log ─────────────
-- (props_events is the dedup table used by award_props(); some award paths
--  write only to props_events, not props_log)
UPDATE public.users u
SET
  earned_props   = GREATEST(
                     COALESCE(u.earned_props,   0),
                     COALESCE(pe.event_total,   0)
                   ),
  lifetime_props = GREATEST(
                     COALESCE(u.lifetime_props, 0),
                     COALESCE(pe.event_total,   0)
                   )
FROM (
  SELECT user_id, SUM(props_amount) AS event_total
  FROM   public.props_events
  WHERE  props_amount > 0
  GROUP  BY user_id
) pe
WHERE u.id = pe.user_id;

-- ── Step 3: ensure total_props is never less than lifetime_props ─────────────
-- (defensive: if somehow total_props was wiped but lifetime record is good)
-- Do NOT increase total_props here — only ensure it is ≥ 0.
UPDATE public.users
SET total_props = 0
WHERE COALESCE(total_props, 0) < 0;

-- ── Step 4: verification query (inspect in SQL Editor output) ─────────────────
SELECT
  id,
  username,
  total_props,
  earned_props,
  lifetime_props
FROM public.users
WHERE COALESCE(lifetime_props, 0) > 0
   OR COALESCE(total_props,    0) > 0
ORDER BY lifetime_props DESC
LIMIT 20;

