-- ── Suggestions tables (add to existing schema) ─────────────────────────────

-- 1. challenge_suggestions
CREATE TABLE IF NOT EXISTS challenge_suggestions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  vote_count   int  NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  UNIQUE(challenge_id, user_id)          -- one suggestion per user per challenge
);

CREATE INDEX IF NOT EXISTS idx_suggestions_challenge ON challenge_suggestions(challenge_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_votes     ON challenge_suggestions(challenge_id, vote_count DESC);

-- 2. challenge_suggestion_votes
CREATE TABLE IF NOT EXISTS challenge_suggestion_votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid NOT NULL REFERENCES challenge_suggestions(id) ON DELETE CASCADE,
  voter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(suggestion_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_sug_votes_sug   ON challenge_suggestion_votes(suggestion_id);
CREATE INDEX IF NOT EXISTS idx_sug_votes_voter ON challenge_suggestion_votes(voter_id);

-- 3. Add is_weekly and week_number columns to challenges
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS is_weekly    boolean NOT NULL DEFAULT false;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS week_number  int;

-- 4. Add index for weekly challenges
CREATE INDEX IF NOT EXISTS idx_challenges_weekly ON challenges(is_weekly, status);

-- 5. RLS for suggestion tables
ALTER TABLE challenge_suggestions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_suggestion_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read suggestions"
  ON challenge_suggestions FOR SELECT USING (true);
CREATE POLICY "auth submit suggestion"
  ON challenge_suggestions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "public read suggestion votes"
  ON challenge_suggestion_votes FOR SELECT USING (true);
CREATE POLICY "auth vote suggestion"
  ON challenge_suggestion_votes FOR INSERT WITH CHECK (auth.uid() = voter_id);
CREATE POLICY "auth delete suggestion vote"
  ON challenge_suggestion_votes FOR DELETE USING (auth.uid() = voter_id);

-- 6. increment_vote RPC (for challenge entries)
CREATE OR REPLACE FUNCTION increment_vote(p_entry_id uuid, p_delta int)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE challenge_entries
  SET vote_count = GREATEST(0, vote_count + p_delta)
  WHERE id = p_entry_id;
$$;

-- 7. increment_suggestion_vote RPC
CREATE OR REPLACE FUNCTION increment_suggestion_vote(p_suggestion_id uuid, p_delta int)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE challenge_suggestions
  SET vote_count = GREATEST(0, vote_count + p_delta)
  WHERE id = p_suggestion_id;
$$;

-- 8. Verify
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('challenge_suggestions','challenge_suggestion_votes')
ORDER BY table_name;
