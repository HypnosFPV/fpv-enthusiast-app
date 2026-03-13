-- ══════════════════════════════════════════════════════════════════════════════
-- 20260313_map_fraud_prevention.sql
-- FPV Map — Comprehensive fraud prevention for fly spots & race events
--
-- Implements all 8 anti-fraud measures:
--   1. Coordinate spoofing   — enforced client-side (proximity gate in app)
--   2. Duplicate flooding    — unique index on rounded lat/lng grid cell
--   3. Name/desc abuse       — length + URL CHECK constraints
--   4. Wrong type/hazard     — spot_reports table + auto-flag trigger
--   5. Event date fraud      — enforced client-side (date range gate in app)
--   6. Vote manipulation     — rate-limited vote RPC + created_at on spot_votes
--   7. Account age gate      — enforced client-side (24-hr minimum in app)
--   8. Verified spot badge   — is_verified + is_flagged columns + auto-verify trigger
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 2. Duplicate flooding — unique index on 3-decimal lat/lng (~111m grid) ───
-- Prevents the exact same physical location being submitted twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fly_spots_location_dedup
  ON fly_spots (
    round(latitude::numeric,  3),
    round(longitude::numeric, 3)
  );

-- ── 3. Name / description length + no-URL constraints ────────────────────────
ALTER TABLE fly_spots
  ADD CONSTRAINT chk_spot_name_len CHECK (char_length(name) BETWEEN 3 AND 60),
  ADD CONSTRAINT chk_spot_desc_len CHECK (description IS NULL OR char_length(description) <= 300),
  ADD CONSTRAINT chk_spot_no_url   CHECK (description IS NULL OR description NOT ILIKE '%http%');

ALTER TABLE race_events
  ADD CONSTRAINT chk_event_name_len CHECK (char_length(name) BETWEEN 3 AND 80),
  ADD CONSTRAINT chk_event_desc_len CHECK (description IS NULL OR char_length(description) <= 500);

-- ── 8a. Verified / flagged columns on fly_spots ───────────────────────────────
ALTER TABLE fly_spots
  ADD COLUMN IF NOT EXISTS is_verified  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_flagged   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS report_count int     NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_fly_spots_verified ON fly_spots(is_verified);
CREATE INDEX IF NOT EXISTS idx_fly_spots_flagged  ON fly_spots(is_flagged);

-- ── 4a. spot_reports table ───────────────────────────────────────────────────
-- Allows community to report bad pins. One report per user per spot.
CREATE TABLE IF NOT EXISTS spot_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id     uuid        NOT NULL REFERENCES fly_spots(id) ON DELETE CASCADE,
  reporter_id uuid        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  reason      text        NOT NULL CHECK (reason IN (
                            'wrong_type',    'wrong_hazard',   'does_not_exist',
                            'dangerous',     'duplicate',      'offensive_name',
                            'other'
                          )),
  details     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (spot_id, reporter_id)          -- one report per user per spot
);

CREATE INDEX IF NOT EXISTS idx_spot_reports_spot ON spot_reports(spot_id);

-- RLS: anyone authenticated can insert; only the reporter can read their own
ALTER TABLE spot_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can report spots"
  ON spot_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users can read own reports"
  ON spot_reports FOR SELECT
  USING (auth.uid() = reporter_id);

CREATE POLICY "Admins can read all reports"
  ON spot_reports FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- ── 4b. Auto-flag trigger: ≥3 reports → set is_flagged + increment count ─────
CREATE OR REPLACE FUNCTION handle_spot_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Increment the denormalised report counter
  UPDATE fly_spots
  SET report_count = report_count + 1
  WHERE id = NEW.spot_id;

  -- Auto-flag when 3+ reports received
  UPDATE fly_spots
  SET is_flagged = true
  WHERE id = NEW.spot_id
    AND report_count >= 2;   -- will be 3 after the UPDATE above completes

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_spot_report ON spot_reports;
CREATE TRIGGER trg_handle_spot_report
  AFTER INSERT ON spot_reports
  FOR EACH ROW EXECUTE FUNCTION handle_spot_report();

-- ── 6a. Add created_at to spot_votes (needed for rate limiting) ──────────────
ALTER TABLE spot_votes
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ── 6b. Rate-limited vote RPC ────────────────────────────────────────────────
-- Replaces direct client upsert. Caps at 20 votes per user per hour.
CREATE OR REPLACE FUNCTION vote_spot_ratelimited(
  p_spot_id uuid,
  p_vote    int,      -- 1 (up) or -1 (down)
  p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  recent_votes int;
BEGIN
  -- Verify caller is the claimed user
  IF auth.uid() != p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auth_mismatch');
  END IF;

  -- Rate limit: max 20 distinct spot votes per hour
  SELECT COUNT(*) INTO recent_votes
  FROM spot_votes
  WHERE user_id   = p_user_id
    AND created_at > now() - INTERVAL '1 hour';

  IF recent_votes >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limit');
  END IF;

  -- Upsert the vote (toggle off if same vote repeated)
  IF p_vote = 0 THEN
    DELETE FROM spot_votes WHERE spot_id = p_spot_id AND user_id = p_user_id;
  ELSE
    INSERT INTO spot_votes (spot_id, user_id, vote, created_at)
    VALUES (p_spot_id, p_user_id, p_vote, now())
    ON CONFLICT (spot_id, user_id)
    DO UPDATE SET vote = EXCLUDED.vote, created_at = now();
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 8b. Auto-verify trigger: 5+ net thumbs + ≥3 distinct voters ─────────────
CREATE OR REPLACE FUNCTION auto_verify_spot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  net_votes    int;
  voter_count  int;
BEGIN
  SELECT
    SUM(CASE WHEN vote = 1 THEN 1 ELSE -1 END),
    COUNT(DISTINCT user_id)
  INTO net_votes, voter_count
  FROM spot_votes
  WHERE spot_id = NEW.spot_id;

  IF net_votes >= 5 AND voter_count >= 3 THEN
    UPDATE fly_spots
    SET is_verified = true, verified_at = now()
    WHERE id = NEW.spot_id AND is_flagged = false AND is_verified = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_verify_spot ON spot_votes;
CREATE TRIGGER trg_auto_verify_spot
  AFTER INSERT OR UPDATE ON spot_votes
  FOR EACH ROW EXECUTE FUNCTION auto_verify_spot();

-- ── Admin RPC: get all flagged spots ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_flagged_spots()
RETURNS TABLE (
  id           uuid,
  name         text,
  spot_type    text,
  hazard_level text,
  latitude     double precision,
  longitude    double precision,
  report_count int,
  is_flagged   boolean,
  is_verified  boolean,
  created_at   timestamptz,
  reports      jsonb
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    fs.id, fs.name, fs.spot_type, fs.hazard_level,
    fs.latitude, fs.longitude,
    fs.report_count, fs.is_flagged, fs.is_verified,
    fs.created_at,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'reason',     sr.reason,
        'details',    sr.details,
        'created_at', sr.created_at
      ) ORDER BY sr.created_at DESC)
      FILTER (WHERE sr.id IS NOT NULL),
      '[]'::jsonb
    ) AS reports
  FROM fly_spots fs
  LEFT JOIN spot_reports sr ON sr.spot_id = fs.id
  WHERE fs.is_flagged = true
  GROUP BY fs.id
  ORDER BY fs.report_count DESC, fs.created_at DESC;
$$;

-- ── Admin RPC: unflag / clear a spot ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_unflag_spot(p_spot_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE fly_spots
  SET is_flagged   = false,
      report_count = 0
  WHERE id = p_spot_id;
  -- Keep reports for audit trail but mark the spot clean
$$;

-- ── Admin RPC: permanently remove a fraudulent spot ──────────────────────────
CREATE OR REPLACE FUNCTION admin_delete_spot(p_spot_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM fly_spots WHERE id = p_spot_id;
$$;

-- ── Reload PostgREST schema cache ─────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
