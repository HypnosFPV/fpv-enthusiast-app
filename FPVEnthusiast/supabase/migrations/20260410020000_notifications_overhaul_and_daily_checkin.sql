-- =============================================================================
-- Migration: notifications overhaul + daily check-in reward
--
-- Goals
--   1. Add category-level notification preferences.
--   2. Normalize/filter notification inserts through a single DB trigger so
--      app-wide notification settings are respected consistently.
--   3. Add daily UTC login bonus (+5 Props once per day) with in-app notif.
--   4. Fix challenge notifications so in-app rows do not depend on push tokens.
--   5. Expand notification type constraint to cover all currently-used types.
-- =============================================================================

-- ── 1. Preference expansion ───────────────────────────────────────────────────
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS social_activity      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS marketplace_activity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS group_activity       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reward_activity      boolean NOT NULL DEFAULT true;

-- Ensure richer notification payload columns exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'title'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN title text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'body'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN body text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'data'
  ) THEN
    ALTER TABLE public.notifications ADD COLUMN data jsonb;
  END IF;
END $$;

-- ── 2. Notification type constraint refresh ───────────────────────────────────
DO $$
BEGIN
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (
      type IN (
        'like', 'comment', 'follow', 'mention', 'reply', 'comment_reply',
        'challenge_voting_open', 'challenge_voting_closing', 'challenge_result',
        'new_message', 'new_offer', 'offer_accepted', 'offer_declined', 'offer_countered',
        'item_sold', 'payment_received', 'item_shipped', 'item_delivered',
        'marketplace_dispute', 'dispute_resolved',
        'group_invite',
        'daily_check_in'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ── 3. Category helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notification_category(p_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    WHEN p_type IN ('like', 'comment', 'follow', 'mention', 'reply', 'comment_reply')
      THEN 'social'
    WHEN p_type IN ('challenge_voting_open', 'challenge_voting_closing', 'challenge_result')
      THEN 'challenge'
    WHEN p_type IN (
      'new_message', 'new_offer', 'offer_accepted', 'offer_declined', 'offer_countered',
      'item_sold', 'payment_received', 'item_shipped', 'item_delivered', 'marketplace_dispute', 'dispute_resolved'
    )
      THEN 'marketplace'
    WHEN p_type IN ('group_invite')
      THEN 'group'
    WHEN p_type IN ('daily_check_in')
      THEN 'reward'
    ELSE 'unknown'
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_allowed_for_user(
  p_user_id uuid,
  p_type text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefs public.notification_preferences%ROWTYPE;
  v_category text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
    INTO v_prefs
  FROM public.notification_preferences
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN true;
  END IF;

  v_category := public.notification_category(p_type);

  RETURN CASE v_category
    WHEN 'social'      THEN COALESCE(v_prefs.social_activity, true)
    WHEN 'challenge'   THEN CASE
                              WHEN p_type = 'challenge_voting_open'    THEN COALESCE(v_prefs.challenge_voting, true)
                              WHEN p_type = 'challenge_voting_closing' THEN COALESCE(v_prefs.challenge_closing, true)
                              WHEN p_type = 'challenge_result'         THEN COALESCE(v_prefs.challenge_results, true)
                              ELSE true
                            END
    WHEN 'marketplace' THEN COALESCE(v_prefs.marketplace_activity, true)
    WHEN 'group'       THEN COALESCE(v_prefs.group_activity, true)
    WHEN 'reward'      THEN COALESCE(v_prefs.reward_activity, true)
    ELSE true
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.notification_allowed_for_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notification_allowed_for_user(uuid, text) TO authenticated, service_role;

-- ── 4. Normalize + filter trigger for all notification inserts ────────────────
CREATE OR REPLACE FUNCTION public.trg_notifications_normalize_and_filter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Normalize legacy reply type.
  IF NEW.type = 'comment_reply' THEN
    NEW.type := 'reply';
  END IF;

  -- Social notifications should never notify the actor about their own action.
  IF NEW.actor_id IS NOT NULL AND NEW.user_id = NEW.actor_id
     AND public.notification_category(NEW.type) = 'social' THEN
    RETURN NULL;
  END IF;

  -- Keep entity fields coherent for marketplace / deep-link rows.
  IF NEW.entity_id IS NULL AND NEW.listing_id IS NOT NULL THEN
    NEW.entity_id := NEW.listing_id;
  END IF;

  IF NEW.entity_type IS NULL AND NEW.entity_id IS NOT NULL AND NEW.listing_id IS NOT NULL THEN
    NEW.entity_type := 'listing';
  END IF;

  -- Build a usable fallback message for system notifications.
  IF COALESCE(NEW.message, '') = '' THEN
    NEW.message := COALESCE(
      NULLIF(trim(COALESCE(NEW.title, '') || CASE
        WHEN COALESCE(NEW.body, '') <> '' THEN ' — ' || NEW.body
        ELSE ''
      END), ''),
      NEW.body,
      NEW.title,
      NEW.message
    );
  END IF;

  IF NOT public.notification_allowed_for_user(NEW.user_id, NEW.type) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_normalize_and_filter ON public.notifications;
CREATE TRIGGER trg_notifications_normalize_and_filter
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notifications_normalize_and_filter();

-- ── 5. Daily check-in reward RPC ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_daily_check_in(
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_user_id  uuid := COALESCE(p_user_id, auth.uid());
  v_utc_date text;
  v_awarded  boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_auth_uid IS NOT NULL AND p_user_id IS NOT NULL AND p_user_id <> v_auth_uid THEN
    RAISE EXCEPTION 'Cannot award daily check-in for another user';
  END IF;

  v_utc_date := to_char(timezone('UTC', now()), 'YYYY-MM-DD');

  v_awarded := public.award_props(
    v_user_id,
    'daily_check_in',
    5,
    v_utc_date
  );

  IF v_awarded THEN
    INSERT INTO public.notifications (
      user_id,
      actor_id,
      type,
      title,
      body,
      message,
      entity_type,
      data
    ) VALUES (
      v_user_id,
      NULL,
      'daily_check_in',
      '📅 Daily check-in',
      '+5 Props added to your balance.',
      '📅 Daily check-in · +5 Props',
      'reward',
      jsonb_build_object(
        'utc_date', v_utc_date,
        'props_awarded', 5,
        'navigate', 'notifications'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'awarded', v_awarded,
    'props_awarded', CASE WHEN v_awarded THEN 5 ELSE 0 END,
    'utc_date', v_utc_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_daily_check_in(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_daily_check_in(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.award_daily_check_in(uuid) IS
  'Awards +5 Props once per UTC day and creates an in-app daily_check_in notification when rewards notifications are enabled.';

-- ── 6. Challenge helper refresh: do not require push tokens for in-app rows ──
CREATE OR REPLACE FUNCTION public.notify_challenge_voting_open(
  p_challenge_id uuid
)
RETURNS integer
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

  FOR v_user IN
    SELECT au.id AS user_id
    FROM auth.users au
    LEFT JOIN public.notification_preferences np ON np.user_id = au.id
    WHERE COALESCE(np.challenge_voting, true) = true
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = au.id
          AND n.type = 'challenge_voting_open'
          AND n.challenge_id = p_challenge_id
      )
  LOOP
    INSERT INTO public.notifications (user_id, actor_id, type, challenge_id, message, title, body, data)
    VALUES (
      v_user.user_id,
      NULL,
      'challenge_voting_open',
      p_challenge_id,
      v_msg,
      '🏆 Voting is open',
      'Cast your vote before Sunday closes.',
      jsonb_build_object('challenge_id', p_challenge_id, 'navigate', 'challenges')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

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

  FOR v_user IN
    SELECT DISTINCT u.user_id
    FROM (
      SELECT pilot_id AS user_id
      FROM public.challenge_entries
      WHERE challenge_id = p_challenge_id
      UNION
      SELECT csv.user_id
      FROM public.challenge_suggestion_votes csv
      JOIN public.challenge_suggestions cs ON cs.id = csv.suggestion_id
      WHERE cs.challenge_id = p_challenge_id
    ) u
    LEFT JOIN public.notification_preferences np ON np.user_id = u.user_id
    WHERE COALESCE(np.challenge_closing, true) = true
      AND NOT EXISTS (
        SELECT 1 FROM public.challenge_votes cv
        WHERE cv.challenge_id = p_challenge_id
          AND cv.user_id = u.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = u.user_id
          AND n.type = 'challenge_voting_closing'
          AND n.challenge_id = p_challenge_id
      )
  LOOP
    INSERT INTO public.notifications (user_id, actor_id, type, challenge_id, message, title, body, data)
    VALUES (
      v_user.user_id,
      NULL,
      'challenge_voting_closing',
      p_challenge_id,
      v_msg,
      '⏰ Voting closes soon',
      'Only 2 hours left to cast your challenge vote.',
      jsonb_build_object('challenge_id', p_challenge_id, 'navigate', 'challenges')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

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

  v_msg := '🥇 Results are in for "' || v_title || '" — open the app to see the podium and Props awarded.';

  FOR v_user IN
    SELECT DISTINCT u.user_id
    FROM (
      SELECT pilot_id AS user_id
      FROM public.challenge_entries
      WHERE challenge_id = p_challenge_id
      UNION
      SELECT user_id
      FROM public.challenge_votes
      WHERE challenge_id = p_challenge_id
    ) u
    LEFT JOIN public.notification_preferences np ON np.user_id = u.user_id
    WHERE COALESCE(np.challenge_results, true) = true
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = u.user_id
          AND n.type = 'challenge_result'
          AND n.challenge_id = p_challenge_id
      )
  LOOP
    INSERT INTO public.notifications (user_id, actor_id, type, challenge_id, message, title, body, data)
    VALUES (
      v_user.user_id,
      NULL,
      'challenge_result',
      p_challenge_id,
      v_msg,
      '🥇 Challenge results are in',
      'See this week\'s winners and Props awarded.',
      jsonb_build_object('challenge_id', p_challenge_id, 'navigate', 'challenges')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

NOTIFY pgrst, 'reload schema';
