-- ── OSD Pilot Name Moderation ─────────────────────────────────────────────────
-- Adds moderation_status tracking to challenge_entries so the OSD text-blur
-- pipeline can flag, process and approve entries transparently.

ALTER TABLE challenge_entries
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'processing', 'approved', 'needs_review', 'rejected')),
  ADD COLUMN IF NOT EXISTS moderation_flags  JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS moderation_processed_at TIMESTAMPTZ;

-- Index for admin queries (find all entries needing review)
CREATE INDEX IF NOT EXISTS idx_challenge_entries_moderation
  ON challenge_entries(moderation_status);

-- Auto-approve entries older than 30 min still stuck on pending
-- (safety net if the edge function fails silently)
CREATE OR REPLACE FUNCTION auto_approve_stale_pending()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE challenge_entries
  SET moderation_status = 'approved'
  WHERE moderation_status = 'pending'
    AND created_at < NOW() - INTERVAL '30 minutes';
$$;

-- RPC so the edge function (service role) can update moderation status
CREATE OR REPLACE FUNCTION set_entry_moderation(
  p_entry_id        uuid,
  p_status          text,
  p_flags           jsonb DEFAULT '[]'::jsonb
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE challenge_entries
  SET
    moderation_status        = p_status,
    moderation_flags         = p_flags,
    moderation_processed_at  = now()
  WHERE id = p_entry_id;
$$;
