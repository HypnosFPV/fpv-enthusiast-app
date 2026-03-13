-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: RSVP count sync trigger (Fix #9)
-- Replaces the two-step client-side rsvp_count update with a single atomic
-- Postgres trigger so counts can never desynchronise if the app crashes.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Function: increment/decrement race_events.rsvp_count atomically
CREATE OR REPLACE FUNCTION sync_rsvp_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE race_events
    SET    rsvp_count = rsvp_count + 1
    WHERE  id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE race_events
    SET    rsvp_count = GREATEST(0, rsvp_count - 1)
    WHERE  id = OLD.event_id;
  END IF;
  RETURN NULL;   -- AFTER trigger: return value is ignored
END;
$$;

-- 2. Attach trigger to event_rsvps (create table if it doesn't exist yet)
CREATE TABLE IF NOT EXISTS event_rsvps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES race_events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

DROP TRIGGER IF EXISTS trg_sync_rsvp_count ON event_rsvps;
CREATE TRIGGER trg_sync_rsvp_count
  AFTER INSERT OR DELETE ON event_rsvps
  FOR EACH ROW EXECUTE FUNCTION sync_rsvp_count();

-- 3. RLS: users can manage their own RSVPs; anyone can read counts via race_events
ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvp_insert_own"  ON event_rsvps;
DROP POLICY IF EXISTS "rsvp_delete_own"  ON event_rsvps;
DROP POLICY IF EXISTS "rsvp_select_own"  ON event_rsvps;

CREATE POLICY "rsvp_insert_own"  ON event_rsvps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "rsvp_delete_own"  ON event_rsvps FOR DELETE
  USING  (auth.uid() = user_id);

CREATE POLICY "rsvp_select_own"  ON event_rsvps FOR SELECT
  USING  (auth.uid() = user_id);

-- 4. Resync any existing count drift (safe to run any time)
UPDATE race_events re
SET    rsvp_count = (
  SELECT COUNT(*) FROM event_rsvps er WHERE er.event_id = re.id
);

NOTIFY pgrst, 'reload schema';
