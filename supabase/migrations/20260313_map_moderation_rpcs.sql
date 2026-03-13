-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Map Moderation RPCs
-- All functions are SECURITY DEFINER and validate is_admin on every call so
-- the client can never bypass the guard by fabricating a session token.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper: raise if caller is not an admin ───────────────────────────────────
CREATE OR REPLACE FUNCTION _assert_admin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'permission_denied: admin only';
  END IF;
END;
$$;

-- ── 1. admin_get_spot_reports ─────────────────────────────────────────────────
-- Returns every open spot_reports row joined to fly_spots and reporter/owner
-- usernames. "Open" = not yet actioned (no status column — all rows are open
-- until dismissed/deleted which removes them from the table).
CREATE OR REPLACE FUNCTION admin_get_spot_reports()
RETURNS TABLE (
  report_id            uuid,
  spot_id              uuid,
  spot_name            text,
  spot_type            text,
  latitude             double precision,
  longitude            double precision,
  is_flagged           boolean,
  is_verified          boolean,
  report_count         int,
  reason               text,
  details              text,
  reported_at          timestamptz,
  reporter_username    text,
  created_by_username  text
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    sr.id                AS report_id,
    fs.id                AS spot_id,
    fs.name              AS spot_name,
    fs.spot_type         AS spot_type,
    fs.latitude,
    fs.longitude,
    fs.is_flagged,
    fs.is_verified,
    fs.report_count,
    sr.reason,
    sr.details,
    sr.created_at        AS reported_at,
    rep.username         AS reporter_username,
    own.username         AS created_by_username
  FROM spot_reports sr
  JOIN fly_spots    fs  ON fs.id = sr.spot_id
  LEFT JOIN users   rep ON rep.id = sr.reporter_id
  LEFT JOIN users   own ON own.id = fs.created_by
  ORDER BY fs.report_count DESC, sr.created_at DESC;
$$;

-- ── 2. admin_get_event_reports ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_event_reports()
RETURNS TABLE (
  report_id           uuid,
  event_id            uuid,
  event_name          text,
  event_type          text,
  event_source        text,
  start_time          timestamptz,
  city                text,
  state               text,
  reason              text,
  details             text,
  reported_at         timestamptz,
  reporter_username   text,
  organizer_username  text
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    er.id               AS report_id,
    re.id               AS event_id,
    re.name             AS event_name,
    re.event_type,
    re.event_source,
    re.start_time,
    re.city,
    re.state,
    er.reason,
    er.details,
    er.created_at       AS reported_at,
    rep.username        AS reporter_username,
    org.username        AS organizer_username
  FROM event_reports er
  JOIN race_events   re  ON re.id = er.event_id
  LEFT JOIN users    rep ON rep.id = er.reporter_id
  LEFT JOIN users    org ON org.id = re.organizer_id
  ORDER BY er.created_at DESC;
$$;

-- ── 3. admin_dismiss_spot_report ─────────────────────────────────────────────
-- Removes the report row (keeps the spot), resets is_flagged if no other
-- reports remain for that spot.
CREATE OR REPLACE FUNCTION admin_dismiss_spot_report(p_report_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_spot_id uuid;
  v_remaining int;
BEGIN
  PERFORM _assert_admin();

  SELECT spot_id INTO v_spot_id FROM spot_reports WHERE id = p_report_id;
  IF v_spot_id IS NULL THEN RETURN; END IF;

  DELETE FROM spot_reports WHERE id = p_report_id;

  -- Recalculate report_count and clear flag if none remain
  SELECT COUNT(*) INTO v_remaining FROM spot_reports WHERE spot_id = v_spot_id;
  UPDATE fly_spots
    SET report_count = v_remaining,
        is_flagged   = (v_remaining >= 3)
  WHERE id = v_spot_id;
END;
$$;

-- ── 4. admin_delete_spot ──────────────────────────────────────────────────────
-- Deletes the spot (cascade removes spot_reports, spot_votes, spot_comments).
CREATE OR REPLACE FUNCTION admin_delete_spot(p_spot_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _assert_admin();
  DELETE FROM fly_spots WHERE id = p_spot_id;
END;
$$;

-- ── 5. admin_verify_spot ──────────────────────────────────────────────────────
-- Clears all reports for the spot, marks it verified, unflagged.
CREATE OR REPLACE FUNCTION admin_verify_spot(p_spot_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _assert_admin();

  DELETE FROM spot_reports WHERE spot_id = p_spot_id;

  UPDATE fly_spots
    SET is_verified  = true,
        is_flagged   = false,
        report_count = 0,
        verified_at  = now()
  WHERE id = p_spot_id;
END;
$$;

-- ── 6. admin_dismiss_event_report ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_dismiss_event_report(p_report_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _assert_admin();
  DELETE FROM event_reports WHERE id = p_report_id;
END;
$$;

-- ── 7. admin_delete_event ─────────────────────────────────────────────────────
-- Deletes the event (cascade removes event_reports, rsvps).
CREATE OR REPLACE FUNCTION admin_delete_event(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _assert_admin();
  DELETE FROM race_events WHERE id = p_event_id;
END;
$$;

-- ── Grant execute to authenticated role ───────────────────────────────────────
GRANT EXECUTE ON FUNCTION admin_get_spot_reports()             TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_event_reports()            TO authenticated;
GRANT EXECUTE ON FUNCTION admin_dismiss_spot_report(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_spot(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION admin_verify_spot(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION admin_dismiss_event_report(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_event(uuid)             TO authenticated;
