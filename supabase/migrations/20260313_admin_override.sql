-- ── Admin override: re-queue any approved entry for review ───────────────────
-- Allows an admin to flag a previously auto-approved entry as needing review,
-- e.g. if a report comes in or a spot-check reveals a missed pilot name.

CREATE OR REPLACE FUNCTION admin_override_to_review(
  p_entry_id uuid,
  p_reason   text DEFAULT 'admin_spot_check'
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE challenge_entries
  SET
    moderation_status       = 'needs_review',
    moderation_flags        = COALESCE(moderation_flags, '[]'::jsonb) || jsonb_build_object(
                                'type',        'admin_override',
                                'reason',      p_reason,
                                'overridden_at', now()::text
                              ),
    moderation_processed_at = now()
  WHERE id = p_entry_id;
$$;

-- ── Admin: get ALL entries (approved + flagged) for spot-checking ─────────────
-- Separate from admin_get_flagged_entries — this one lets admin browse
-- already-approved entries to manually re-queue any that look wrong.
CREATE OR REPLACE FUNCTION admin_get_all_entries(
  p_challenge_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                      uuid,
  challenge_id            uuid,
  challenge_title         text,
  entry_number            int,
  moderation_status       text,
  moderation_flags        jsonb,
  moderation_processed_at timestamptz,
  s3_upload_key           text,
  thumbnail_s3_key        text,
  duration_seconds        int,
  submitted_at            timestamptz,
  created_at              timestamptz
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
  WHERE (p_challenge_id IS NULL OR ce.challenge_id = p_challenge_id)
  ORDER BY ce.created_at DESC;
$$;

-- ── Reload schema cache ───────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
