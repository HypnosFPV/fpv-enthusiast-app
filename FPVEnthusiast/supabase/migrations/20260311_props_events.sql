-- ============================================================
-- Migration: props_events table + award_props() RPC
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. props_events log table
-- Unique on (user_id, event_type, reference_id) prevents double-awarding.
-- One-time events (first_post, easter_egg, etc.) use reference_id = 'global'.
-- Milestone-per-post events use reference_id = post_id.
-- ============================================================
CREATE TABLE IF NOT EXISTS props_events (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type   text        NOT NULL,
  props_amount integer     NOT NULL DEFAULT 0,
  reference_id text        NOT NULL DEFAULT 'global',
  created_at   timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS props_events_dedup
  ON props_events (user_id, event_type, reference_id);

CREATE INDEX IF NOT EXISTS props_events_user_idx ON props_events (user_id);

-- Enable RLS
ALTER TABLE props_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own events
CREATE POLICY "props_events_select_own"
  ON props_events FOR SELECT
  USING (auth.uid() = user_id);

-- Only the service_role / RPC can insert (no direct client inserts)
CREATE POLICY "props_events_insert_rpc"
  ON props_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. Ensure users table has earned_props and season_props
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS earned_props  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS season_props  integer DEFAULT 0;

-- ============================================================
-- 3. award_props() RPC
-- Returns TRUE if props were awarded (first time for this event),
-- FALSE if already awarded (duplicate / idempotent call).
-- ============================================================
CREATE OR REPLACE FUNCTION award_props(
  p_user_id     uuid,
  p_event_type  text,
  p_props       integer,
  p_reference_id text DEFAULT 'global'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Attempt to insert the event log row
  INSERT INTO props_events (user_id, event_type, props_amount, reference_id)
  VALUES (p_user_id, p_event_type, p_props, p_reference_id)
  ON CONFLICT (user_id, event_type, reference_id) DO NOTHING;

  -- FOUND is TRUE only if the INSERT actually inserted a row
  IF FOUND THEN
    UPDATE users
    SET
      total_props  = COALESCE(total_props,  0) + p_props,
      earned_props = COALESCE(earned_props, 0) + p_props
    WHERE id = p_user_id;

    RETURN true;  -- props awarded
  END IF;

  RETURN false;  -- already awarded, no-op
END;
$$;

-- Grant execute to authenticated users (the function is SECURITY DEFINER
-- so it runs with elevated privileges regardless)
REVOKE ALL ON FUNCTION award_props(uuid, text, integer, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION award_props(uuid, text, integer, text)
  TO authenticated, service_role;

-- ============================================================
-- 4. Props event reference table (optional documentation)
-- ============================================================
COMMENT ON TABLE props_events IS
  'Audit log for every props award. Unique index prevents double-awarding.';

COMMENT ON FUNCTION award_props IS
  'Award props to a user for a named event. Idempotent — returns FALSE if already awarded.
   One-time events use reference_id=''global''; per-resource events use the resource UUID.
   
   Event types and values:
     first_post              +50   (global, once)
     easter_egg              +150  (global, once)
     first_challenge_entry   +25   (global, once)
     profile_complete        +30   (global, once)
     follower_milestone_10   +20   (global, once)
     follower_milestone_50   +50   (global, once)
     follower_milestone_100  +100  (global, once)
     post_vote_milestone_10  +25   (reference_id = post_id)
     post_vote_milestone_50  +75   (reference_id = post_id)
     post_vote_milestone_100 +150  (reference_id = post_id)
  ';
