-- ============================================================
-- FPV Challenges & Props System — Full SQL Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── 1. Seasons ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number       int  NOT NULL UNIQUE,           -- 1, 2, 3 ...
  name         text NOT NULL,                  -- "Season 1"
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  is_active    boolean NOT NULL DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

-- Seed Season 1 (starts now, 6 months)
INSERT INTO seasons (number, name, starts_at, ends_at, is_active)
VALUES (1, 'Season 1', now(), now() + interval '6 months', true)
ON CONFLICT (number) DO NOTHING;

-- ── 2. Challenges ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       uuid REFERENCES seasons(id) ON DELETE CASCADE,
  title           text    NOT NULL,
  description     text,
  rules           text,
  created_by      uuid    REFERENCES users(id) ON DELETE SET NULL,
  submission_ends timestamptz NOT NULL,   -- start + 5 days
  voting_ends     timestamptz NOT NULL,   -- submission_ends + 2 days
  status          text    NOT NULL DEFAULT 'active',
  -- 'active' | 'voting' | 'completed' | 'cancelled'
  max_duration_s  int     NOT NULL DEFAULT 120,  -- 2 minutes
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenges_season ON challenges(season_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);

-- ── 3. Challenge Entries ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_url     text NOT NULL,
  thumbnail_url text,
  duration_s    float,
  caption       text,
  vote_count    int  NOT NULL DEFAULT 0,
  is_winner     boolean NOT NULL DEFAULT false,
  place         int,                     -- 1, 2, 3 for top 3
  created_at    timestamptz DEFAULT now(),
  UNIQUE(challenge_id, user_id)          -- one entry per user per challenge
);

CREATE INDEX IF NOT EXISTS idx_entries_challenge ON challenge_entries(challenge_id);
CREATE INDEX IF NOT EXISTS idx_entries_user      ON challenge_entries(user_id);

-- ── 4. Votes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid NOT NULL REFERENCES challenge_entries(id) ON DELETE CASCADE,
  voter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(entry_id, voter_id)             -- one vote per user per entry
);

CREATE INDEX IF NOT EXISTS idx_votes_entry ON challenge_votes(entry_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON challenge_votes(voter_id, entry_id);

-- ── 5. Props Ledger ───────────────────────────────────────────
-- Every props transaction is recorded here.
-- earned_props is cumulative (never decremented).
-- spent_props is tracked separately so leaderboard uses earned only.
CREATE TABLE IF NOT EXISTS props_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      int  NOT NULL,             -- positive = earned, negative = spent
  reason      text NOT NULL,             -- 'challenge_1st', 'challenge_2nd', etc.
  reference_id uuid,                     -- challenge_id or entry_id
  season_id   uuid REFERENCES seasons(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_props_user   ON props_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_props_season ON props_ledger(season_id);

-- ── 6. Ensure users table has props columns ──────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_props       int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS earned_props      int NOT NULL DEFAULT 0;  -- never decremented
ALTER TABLE users ADD COLUMN IF NOT EXISTS season_props      int NOT NULL DEFAULT 0;  -- current season only
ALTER TABLE users ADD COLUMN IF NOT EXISTS city              text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country           text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_label    text;   -- "Austin, TX"

-- ── 7. RLS Policies ──────────────────────────────────────────
ALTER TABLE challenges         ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_votes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE props_ledger       ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons            ENABLE ROW LEVEL SECURITY;

-- Seasons: public read
CREATE POLICY "public read seasons"       ON seasons         FOR SELECT USING (true);

-- Challenges: public read, authenticated create
CREATE POLICY "public read challenges"    ON challenges      FOR SELECT USING (true);
CREATE POLICY "auth create challenge"     ON challenges      FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "creator update challenge"  ON challenges      FOR UPDATE USING (auth.uid() = created_by);

-- Entries: public read, authenticated insert own, update own
CREATE POLICY "public read entries"       ON challenge_entries FOR SELECT USING (true);
CREATE POLICY "auth submit entry"         ON challenge_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner update entry"        ON challenge_entries FOR UPDATE USING (auth.uid() = user_id);

-- Votes: public read, authenticated insert own
CREATE POLICY "public read votes"         ON challenge_votes FOR SELECT USING (true);
CREATE POLICY "auth vote"                 ON challenge_votes FOR INSERT WITH CHECK (auth.uid() = voter_id);
CREATE POLICY "auth delete vote"          ON challenge_votes FOR DELETE USING (auth.uid() = voter_id);

-- Props ledger: read own
CREATE POLICY "read own props"            ON props_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "service insert props"      ON props_ledger FOR INSERT WITH CHECK (true);

-- ── 8. Function: finalize a challenge (call from edge fn or manually) ─────────
CREATE OR REPLACE FUNCTION finalize_challenge(p_challenge_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_season_id uuid;
  rec RECORD;
  v_place int := 1;
  v_props int;
BEGIN
  SELECT season_id INTO v_season_id FROM challenges WHERE id = p_challenge_id;

  -- Mark completed
  UPDATE challenges SET status = 'completed' WHERE id = p_challenge_id;

  -- Top 3 by vote count
  FOR rec IN
    SELECT id, user_id, vote_count
    FROM challenge_entries
    WHERE challenge_id = p_challenge_id
    ORDER BY vote_count DESC, created_at ASC
    LIMIT 3
  LOOP
    v_props := CASE v_place WHEN 1 THEN 100 WHEN 2 THEN 60 WHEN 3 THEN 30 END;

    -- Mark winner
    UPDATE challenge_entries
    SET is_winner = true, place = v_place
    WHERE id = rec.id;

    -- Award props
    INSERT INTO props_ledger(user_id, amount, reason, reference_id, season_id)
    VALUES (rec.user_id, v_props,
            'challenge_place_' || v_place,
            p_challenge_id, v_season_id);

    -- Update user totals
    UPDATE users SET
      total_props  = total_props  + v_props,
      earned_props = earned_props + v_props,
      season_props = season_props + v_props
    WHERE id = rec.user_id;

    -- Send notification
    INSERT INTO notifications(user_id, type, actor_id, post_id)
    VALUES (rec.user_id, 'challenge_win', rec.user_id, p_challenge_id);

    v_place := v_place + 1;
  END LOOP;
END;
$$;

-- ── 9. Views: leaderboards ────────────────────────────────────

-- Global all-time (by earned_props — never decremented)
CREATE OR REPLACE VIEW leaderboard_global AS
SELECT
  u.id, u.username, u.avatar_url, u.earned_props,
  u.total_props, u.season_props, u.city, u.country, u.location_label,
  RANK() OVER (ORDER BY u.earned_props DESC) AS rank
FROM users u
WHERE u.earned_props > 0;

-- Per-season (uses props_ledger so historical seasons work)
CREATE OR REPLACE VIEW leaderboard_season AS
SELECT
  pl.season_id,
  u.id AS user_id, u.username, u.avatar_url,
  SUM(GREATEST(pl.amount, 0)) AS earned,
  RANK() OVER (PARTITION BY pl.season_id ORDER BY SUM(GREATEST(pl.amount, 0)) DESC) AS rank
FROM props_ledger pl
JOIN users u ON u.id = pl.user_id
WHERE pl.amount > 0
GROUP BY pl.season_id, u.id, u.username, u.avatar_url;
