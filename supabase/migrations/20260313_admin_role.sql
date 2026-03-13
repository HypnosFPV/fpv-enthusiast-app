-- ── Admin Role ────────────────────────────────────────────────────────────────
-- Adds is_admin flag to users table and an RPC for admins to approve/reject
-- OSD-flagged entries without exposing the pilot_id to the app layer.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Only admins can read other users' is_admin status
-- (everyone can read their own via auth.uid() = id)
CREATE POLICY IF NOT EXISTS "users read own admin flag"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- ── Admin: list entries needing OSD review ────────────────────────────────────
-- Returns entries with moderation_status = 'needs_review', enriched with
-- public video/thumb URLs and the detected flag text.
-- Deliberately does NOT expose pilot_id to keep anonymity intact on client.
CREATE OR REPLACE FUNCTION admin_get_flagged_entries()
RETURNS TABLE (
  id                    uuid,
  challenge_id          uuid,
  challenge_title       text,
  entry_number          int,
  moderation_status     text,
  moderation_flags      jsonb,
  moderation_processed_at timestamptz,
  s3_upload_key         text,
  thumbnail_s3_key      text,
  duration_seconds      int,
  submitted_at          timestamptz,
  created_at            timestamptz
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    ce.id,
    ce.challenge_id,
    c.title  AS challenge_title,
    ce.entry_number,
    ce.moderation_status,
    ce.moderation_flags,
    ce.moderation_processed_at,
    ce.s3_upload_key,
    ce.thumbnail_s3_key,
    ce.duration_seconds,
    ce.submitted_at,
    ce.created_at
  FROM challenge_entries ce
  JOIN challenges c ON c.id = ce.challenge_id
  WHERE ce.moderation_status IN ('needs_review', 'pending', 'processing')
  ORDER BY ce.created_at DESC;
$$;

-- ── Admin: approve an entry ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_approve_entry(p_entry_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE challenge_entries
  SET
    moderation_status       = 'approved',
    moderation_processed_at = now()
  WHERE id = p_entry_id;
$$;

-- ── Admin: reject an entry ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_reject_entry(p_entry_id uuid, p_reason text DEFAULT 'manual_review')
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE challenge_entries
  SET
    moderation_status       = 'rejected',
    moderation_flags        = moderation_flags || jsonb_build_object(
                                'type', 'admin_rejection',
                                'reason', p_reason,
                                'rejected_at', now()::text
                              ),
    moderation_processed_at = now()
  WHERE id = p_entry_id;
$$;

-- ── Grant your own user ID admin access ──────────────────────────────────────
-- Replace the email below with your own account email, then run this once.
-- UPDATE users SET is_admin = true WHERE id = '<your-user-uuid>';
