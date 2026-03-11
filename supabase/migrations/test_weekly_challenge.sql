-- ── Insert a test weekly challenge for this week ────────────────────────────
-- Submission window: now → Friday midnight
-- Voting window:     Friday midnight → Sunday midnight
-- Adjust dates as needed for your timezone

INSERT INTO challenges (
  season_id,
  title,
  description,
  rules,
  created_by,
  submission_ends,
  voting_ends,
  status,
  is_weekly,
  week_number,
  max_duration_s
)
SELECT
  s.id AS season_id,
  'Best Freestyle Line' AS title,
  'Show us your best freestyle line — smoothest flow, most creative maneuvers, all in 2 minutes or less. No editing tricks, just raw flying skill.' AS description,
  '• Max 2 minutes raw FPV footage only' || chr(10) ||
  '• No visible faces, people, or identifiable logos' || chr(10) ||
  '• No watermarks, overlays, or on-screen branding' || chr(10) ||
  '• Direct video upload only — no links accepted' || chr(10) ||
  '• One entry per pilot' AS rules,
  NULL AS created_by,
  -- Submission ends this coming Friday at midnight UTC
  date_trunc('week', now()) + interval '5 days' AS submission_ends,
  -- Voting ends this coming Sunday at midnight UTC
  date_trunc('week', now()) + interval '7 days' AS voting_ends,
  'active'  AS status,
  true      AS is_weekly,
  EXTRACT(WEEK FROM now())::int AS week_number,
  120       AS max_duration_s
FROM seasons s
WHERE s.is_active = true
LIMIT 1;

-- Verify
SELECT id, title, is_weekly, week_number, status,
       submission_ends::date AS submit_by,
       voting_ends::date     AS vote_by
FROM challenges
ORDER BY created_at DESC
LIMIT 3;
