-- =============================================================================
-- Migration: challenge_notifications
-- Adds push-token storage, in-app challenge notifications, and DB helper
-- functions for voting-open / voting-closing / results events.
-- =============================================================================

-- ── 1. user_push_tokens ──────────────────────────────────────────────────────
-- One row per (user, device token).  A user can have tokens on multiple
-- devices; a single device never appears more than once.
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      text        NOT NULL,
  platform   text        NOT NULL DEFAULT 'unknown',   -- 'ios' | 'android' | 'unknown'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upt_unique_token UNIQUE (token)           -- one row per physical token
);

CREATE INDEX IF NOT EXISTS idx_upt_user ON public.user_push_tokens(user_id);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upt_read_own   ON public.user_push_tokens;
DROP POLICY IF EXISTS upt_insert_own ON public.user_push_tokens;
DROP POLICY IF EXISTS upt_delete_own ON public.user_push_tokens;

-- Users can only see / manage their own tokens
CREATE POLICY upt_read_own   ON public.user_push_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY upt_insert_own ON public.user_push_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY upt_update_own ON public.user_push_tokens FOR UPDATE USING  (auth.uid() = user_id);
CREATE POLICY upt_delete_own ON public.user_push_tokens FOR DELETE USING  (auth.uid() = user_id);

-- Service role can read all tokens (needed by the Edge Function)
CREATE POLICY upt_service_read ON public.user_push_tokens FOR SELECT USING (true);


-- ── 2. notification_preferences ─────────────────────────────────────────────
-- Lightweight opt-in/opt-out flags per user.  Defaults to true (opted in).
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id             uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_voting    boolean NOT NULL DEFAULT true,  -- voting-open reminder
  challenge_closing   boolean NOT NULL DEFAULT true,  -- 2-hour warning
  challenge_results   boolean NOT NULL DEFAULT true,  -- winners announced
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS np_own ON public.notification_preferences;
CREATE POLICY np_own ON public.notification_preferences USING (auth.uid() = user_id);


-- ── 3. Extend notifications type check (if DB enforces it) ──────────────────
-- The app uses a TS union, not a PG enum, so no enum to alter.
-- We just document the new values here:
--   'challenge_voting_open'   – voting just opened
--   'challenge_voting_closing'– voting closes in 2 hours
--   'challenge_result'        – winners announced

-- Make sure the notifications table accepts NULL actor_id (system msgs)
-- and a nullable post_id (not applicable for challenge notifs):
DO $$
BEGIN
  -- Add challenge_id column if not already present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications' AND column_name='challenge_id'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN challenge_id uuid
      REFERENCES public.challenges(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ── 4. Helper: insert in-app rows for voting-open ────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_challenge_voting_open(
  p_challenge_id uuid
)
RETURNS integer            -- number of notifications inserted
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title   text;
  v_msg     text;
  v_count   int := 0;
  v_user    record;
BEGIN
  SELECT title INTO v_title FROM public.challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_msg := '🏆 Voting is open for "' || v_title || '" — cast your vote before Sunday!';

  -- Target: everyone with a push token (all opted-in app users)
  -- De-dup: skip if a voting_open notif for this challenge already exists for this user
  FOR v_user IN
    SELECT DISTINCT upt.user_id
    FROM   public.user_push_tokens upt
    JOIN   public.notification_preferences np ON np.user_id = upt.user_id
    WHERE  np.challenge_voting = true
      AND  NOT EXISTS (
             SELECT 1 FROM public.notifications n
             WHERE  n.user_id = upt.user_id
               AND  n.type = 'challenge_voting_open'
               AND  n.challenge_id = p_challenge_id
           )
  LOOP
    INSERT INTO public.notifications
      (user_id, actor_id, type, challenge_id, message)
    VALUES
      (v_user.user_id, NULL, 'challenge_voting_open', p_challenge_id, v_msg);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_challenge_voting_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_challenge_voting_open(uuid) TO service_role;


-- ── 5. Helper: insert in-app rows for voting-closing warning ─────────────────
CREATE OR REPLACE FUNCTION public.notify_challenge_voting_closing(
  p_challenge_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title  text;
  v_msg    text;
  v_count  int := 0;
  v_user   record;
BEGIN
  SELECT title INTO v_title FROM public.challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_msg := '⏰ 2 hours left to vote in "' || v_title || '"! Don''t miss your chance.';

  -- Target: users with entries OR who voted on suggestions, who haven't cast a
  -- challenge vote yet, and who are opted in.
  FOR v_user IN
    SELECT DISTINCT u.user_id
    FROM (
      -- submitted an entry
      SELECT pilot_id AS user_id
      FROM   public.challenge_entries
      WHERE  challenge_id = p_challenge_id
      UNION
      -- voted on a suggestion this week (engaged, likely wants to vote on entries)
      SELECT voter_id AS user_id
      FROM   public.challenge_suggestion_votes csv
      JOIN   public.challenge_suggestions cs ON cs.id = csv.suggestion_id
      WHERE  cs.challenge_id = p_challenge_id
    ) u
    JOIN public.notification_preferences np ON np.user_id = u.user_id
    WHERE np.challenge_closing = true
      -- skip users who already voted on an entry
      AND NOT EXISTS (
        SELECT 1 FROM public.challenge_votes cv
        JOIN   public.challenge_entries ce ON ce.id = cv.entry_id
        WHERE  ce.challenge_id = p_challenge_id
          AND  cv.voter_id = u.user_id
      )
      -- de-dup: don't send if already sent for this challenge
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE  n.user_id = u.user_id
          AND  n.type = 'challenge_voting_closing'
          AND  n.challenge_id = p_challenge_id
      )
  LOOP
    INSERT INTO public.notifications
      (user_id, actor_id, type, challenge_id, message)
    VALUES
      (v_user.user_id, NULL, 'challenge_voting_closing', p_challenge_id, v_msg);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_challenge_voting_closing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_challenge_voting_closing(uuid) TO service_role;


-- ── 6. Helper: insert in-app rows for results ────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_challenge_results(
  p_challenge_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title  text;
  v_msg    text;
  v_count  int := 0;
  v_user   record;
BEGIN
  SELECT title INTO v_title FROM public.challenges WHERE id = p_challenge_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_msg := '🥇 Results are in for "' || v_title || '"! See who won and how many Props you earned.';

  FOR v_user IN
    SELECT DISTINCT u.user_id
    FROM (
      SELECT pilot_id AS user_id FROM public.challenge_entries WHERE challenge_id = p_challenge_id
      UNION
      SELECT cv.voter_id AS user_id
      FROM   public.challenge_votes cv
      JOIN   public.challenge_entries ce ON ce.id = cv.entry_id
      WHERE  ce.challenge_id = p_challenge_id
    ) u
    JOIN public.notification_preferences np ON np.user_id = u.user_id
    WHERE np.challenge_results = true
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE  n.user_id = u.user_id
          AND  n.type = 'challenge_result'
          AND  n.challenge_id = p_challenge_id
      )
  LOOP
    INSERT INTO public.notifications
      (user_id, actor_id, type, challenge_id, message)
    VALUES
      (v_user.user_id, NULL, 'challenge_result', p_challenge_id, v_msg);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_challenge_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_challenge_results(uuid) TO service_role;


-- ── 7. Auto-create notification_preferences row on new user ──────────────────
CREATE OR REPLACE FUNCTION public.create_default_notification_prefs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_notif_prefs ON public.users;
CREATE TRIGGER trg_default_notif_prefs
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.create_default_notification_prefs();

-- Back-fill for existing users
INSERT INTO public.notification_preferences (user_id)
SELECT id FROM public.users
ON CONFLICT (user_id) DO NOTHING;


-- ── 8. Verify ────────────────────────────────────────────────────────────────
SELECT
  (SELECT to_regclass('public.user_push_tokens')        IS NOT NULL) AS push_tokens_table,
  (SELECT to_regclass('public.notification_preferences') IS NOT NULL) AS prefs_table,
  (SELECT COUNT(*) FROM public.notification_preferences)              AS prefs_rows;

NOTIFY pgrst, 'reload schema';
