-- ================================================================
-- Props Leaderboard Integrity Fix
-- ================================================================
--
-- Problem: leaderboard_global ranks on users.total_props, which
-- decrements when a user SPENDS props (e.g. on a featured listing).
-- This means spending hurts your leaderboard rank — wrong behaviour.
--
-- Solution: introduce users.lifetime_props
--   • Incremented every time props are EARNED (award_props, triggers)
--   • NEVER decremented for any spend
--   • leaderboard_global re-ranked on lifetime_props
--   • users.total_props remains the spendable WALLET (decrements OK)
--   • users.earned_props is already cumulative-earned but was wrongly
--     decremented by spend_props_for_featured — fixed here too.
--
-- Column roles after this migration:
--   total_props    → spendable balance shown on profile wallet
--   earned_props   → cumulative earned (awards only, never decremented)
--   lifetime_props → immutable all-time earned counter → feeds leaderboard
--   season_props   → current season earned (challenge awards only)
-- ================================================================

-- ── 1. Add lifetime_props column ─────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lifetime_props integer NOT NULL DEFAULT 0;

-- Back-fill: lifetime_props should be at least as large as earned_props
-- (earned_props is the best existing proxy for all-time earned total)
UPDATE users
SET    lifetime_props = GREATEST(COALESCE(lifetime_props, 0), COALESCE(earned_props, 0))
WHERE  COALESCE(earned_props, 0) > COALESCE(lifetime_props, 0);

-- ── 2. Fix award_props() — increment lifetime_props alongside earned_props ────
CREATE OR REPLACE FUNCTION award_props(
  p_user_id      uuid,
  p_event_type   text,
  p_props        integer,
  p_reference_id text DEFAULT 'global'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Attempt dedup insert
  INSERT INTO props_events (user_id, event_type, props_amount, reference_id)
  VALUES (p_user_id, p_event_type, p_props, p_reference_id)
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;

  IF FOUND THEN
    UPDATE users
    SET
      total_props    = COALESCE(total_props,    0) + p_props,  -- wallet
      earned_props   = COALESCE(earned_props,   0) + p_props,  -- cumulative earned
      lifetime_props = COALESCE(lifetime_props, 0) + p_props   -- leaderboard source (never decremented)
    WHERE id = p_user_id;

    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ── 3. Fix apply_props_log trigger — increment lifetime_props ─────────────────
-- This trigger fires on props_log INSERT (used by feed/follows award paths)
CREATE OR REPLACE FUNCTION public.apply_props_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET
    total_props    = COALESCE(total_props,    0) + NEW.amount,  -- wallet
    lifetime_props = COALESCE(lifetime_props, 0) + NEW.amount   -- leaderboard (never decremented)
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- ── 4. Fix sync_user_props_from_entry trigger — increment lifetime_props ──────
-- This trigger fires when challenge_entries.props_awarded is set (finalize_challenge)
CREATE OR REPLACE FUNCTION sync_user_props_from_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta integer;
BEGIN
  IF NEW.props_awarded IS NOT DISTINCT FROM OLD.props_awarded THEN
    RETURN NEW;
  END IF;

  v_delta := COALESCE(NEW.props_awarded, 0) - COALESCE(OLD.props_awarded, 0);

  UPDATE users
  SET
    total_props    = GREATEST(0, COALESCE(total_props,    0) + v_delta),  -- wallet
    lifetime_props = GREATEST(0, COALESCE(lifetime_props, 0) + v_delta)   -- leaderboard (challenge awards are always positive)
  WHERE id = NEW.pilot_id;

  RETURN NEW;
END;
$$;

-- ── 5. Fix spend_props_for_featured — ONLY deduct total_props (wallet) ────────
-- earned_props and lifetime_props must NEVER be decremented on spend.
CREATE OR REPLACE FUNCTION spend_props_for_featured(
  p_listing_id  uuid,
  p_user_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost    constant integer := 4800;
  v_hrs     constant integer := 24;
  v_balance integer;
  v_owner   uuid;
  v_ends_at timestamptz;
BEGIN
  -- 1. Verify caller owns the listing
  SELECT seller_id INTO v_owner
  FROM   marketplace_listings
  WHERE  id = p_listing_id AND status = 'active';

  IF v_owner IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner_or_inactive');
  END IF;

  -- 2. Check spendable balance (total_props only — NOT lifetime_props)
  SELECT total_props INTO v_balance
  FROM   users
  WHERE  id = p_user_id;

  IF COALESCE(v_balance, 0) < v_cost THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'insufficient_props',
      'balance', COALESCE(v_balance, 0),
      'cost',    v_cost
    );
  END IF;

  -- 3. Deduct ONLY the wallet balance.
  --    earned_props and lifetime_props are INTENTIONALLY NOT TOUCHED.
  --    Spending does not hurt leaderboard rank or earned history.
  UPDATE users
  SET    total_props = total_props - v_cost
  WHERE  id = p_user_id;

  -- 4. Set / extend featured window
  v_ends_at := now() + (v_hrs || ' hours')::interval;

  UPDATE marketplace_listings
  SET    is_featured    = true,
         featured_until = v_ends_at,
         featured_type  = 'props'
  WHERE  id = p_listing_id;

  -- 5. Audit log
  INSERT INTO featured_purchases
    (listing_id, user_id, purchase_type, props_spent, duration_hrs, starts_at, ends_at)
  VALUES
    (p_listing_id, p_user_id, 'props', v_cost, v_hrs, now(), v_ends_at);

  RETURN jsonb_build_object('ok', true, 'ends_at', v_ends_at, 'props_spent', v_cost);
END;
$$;

-- ── 6. Rebuild leaderboard_global — rank on lifetime_props ───────────────────
-- Spending props no longer affects rank; only earning does.
DROP VIEW IF EXISTS leaderboard_global;
CREATE VIEW leaderboard_global AS
SELECT
  u.id                                                                AS user_id,
  u.username,
  u.avatar_url,
  COALESCE(u.city, '')                                                AS city,
  COALESCE(u.country, '')                                             AS country,
  CASE
    WHEN u.city    IS NOT NULL AND u.country IS NOT NULL
      THEN u.city || ', ' || u.country
    WHEN u.city    IS NOT NULL THEN u.city
    WHEN u.country IS NOT NULL THEN u.country
    ELSE NULL
  END                                                                 AS location_label,
  -- earned_props returned as 'earned_props' for client compatibility
  COALESCE(u.lifetime_props, 0)                                       AS earned_props,
  -- expose spendable balance separately so profile can show both
  COALESCE(u.total_props, 0)                                          AS spendable_props,
  RANK() OVER (ORDER BY COALESCE(u.lifetime_props, 0) DESC)           AS rank
FROM users u
WHERE COALESCE(u.lifetime_props, 0) > 0;

-- leaderboard_season unchanged — already sources from challenge_entries.props_awarded
-- which is never decremented. Left as-is for safety.

-- ── 7. Add index on lifetime_props for fast leaderboard queries ───────────────
CREATE INDEX IF NOT EXISTS idx_users_lifetime_props
  ON users (lifetime_props DESC)
  WHERE lifetime_props > 0;

-- ── 8. Grant + permissions ────────────────────────────────────────────────────
REVOKE ALL   ON FUNCTION award_props(uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION award_props(uuid, text, integer, text)
  TO authenticated, service_role;

REVOKE ALL   ON FUNCTION spend_props_for_featured(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spend_props_for_featured(uuid, uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
