-- Social groups phase 3: moderation suite
-- Adds owner transfer/delete, bans, post reports, mod action logs,
-- pinned announcement posts, and temporary read-only mode.

ALTER TABLE public.social_groups
  ADD COLUMN IF NOT EXISTS moderation_mode TEXT NOT NULL DEFAULT 'normal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_groups_moderation_mode_check'
  ) THEN
    ALTER TABLE public.social_groups
      ADD CONSTRAINT social_groups_moderation_mode_check
      CHECK (moderation_mode IN ('normal', 'read_only'));
  END IF;
END $$;

ALTER TABLE public.social_groups
  ADD COLUMN IF NOT EXISTS pinned_post_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_groups_pinned_post_id_fkey'
  ) THEN
    ALTER TABLE public.social_groups
      ADD CONSTRAINT social_groups_pinned_post_id_fkey
      FOREIGN KEY (pinned_post_id) REFERENCES public.posts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.social_group_bans (
  group_id UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  banned_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.social_group_post_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 120),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS public.social_group_mod_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  target_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  target_post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_group_bans_group ON public.social_group_bans(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_group_reports_group_status ON public.social_group_post_reports(group_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_group_mod_actions_group ON public.social_group_mod_actions(group_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.is_social_group_owner(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.social_group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = COALESCE(p_user_id, auth.uid())
      AND gm.role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.log_social_group_mod_action(
  p_group_id UUID,
  p_action_type TEXT,
  p_target_user_id UUID DEFAULT NULL,
  p_target_post_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.social_group_mod_actions (
    group_id, actor_id, action_type, target_user_id, target_post_id, metadata
  ) VALUES (
    p_group_id, v_uid, p_action_type, p_target_user_id, p_target_post_id, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_post_to_social_group(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.social_groups g
    JOIN public.social_group_members gm
      ON gm.group_id = g.id
     AND gm.user_id = COALESCE(p_user_id, auth.uid())
    LEFT JOIN public.social_group_bans b
      ON b.group_id = g.id
     AND b.user_id = gm.user_id
    WHERE g.id = p_group_id
      AND b.user_id IS NULL
      AND (
        gm.role IN ('owner','admin','moderator')
        OR (
          g.moderation_mode <> 'read_only'
          AND g.can_post = 'members'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_chat_in_social_group(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.social_groups g
    JOIN public.social_group_members gm
      ON gm.group_id = g.id
     AND gm.user_id = COALESCE(p_user_id, auth.uid())
    LEFT JOIN public.social_group_bans b
      ON b.group_id = g.id
     AND b.user_id = gm.user_id
    WHERE g.id = p_group_id
      AND b.user_id IS NULL
      AND (
        gm.role IN ('owner','admin','moderator')
        OR (
          g.moderation_mode <> 'read_only'
          AND g.can_chat = 'members'
        )
      )
  );
$$;

DROP FUNCTION IF EXISTS public.update_social_group_settings(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.update_social_group_settings(
  p_group_id UUID,
  p_description TEXT DEFAULT NULL,
  p_privacy TEXT DEFAULT NULL,
  p_can_post TEXT DEFAULT NULL,
  p_can_chat TEXT DEFAULT NULL,
  p_can_invite TEXT DEFAULT NULL,
  p_moderation_mode TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.social_group_members
  WHERE group_id = p_group_id AND user_id = v_uid;

  IF v_actor_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only owners/admins can update group settings';
  END IF;

  IF p_moderation_mode IS NOT NULL AND p_moderation_mode NOT IN ('normal','read_only') THEN
    RAISE EXCEPTION 'Invalid moderation mode';
  END IF;

  UPDATE public.social_groups
     SET description = CASE
           WHEN p_description IS NULL THEN description
           WHEN NULLIF(trim(COALESCE(p_description, '')), '') IS NULL THEN NULL
           ELSE trim(p_description)
         END,
         privacy = COALESCE(p_privacy, privacy),
         can_post = COALESCE(p_can_post, can_post),
         can_chat = COALESCE(p_can_chat, can_chat),
         can_invite = COALESCE(p_can_invite, can_invite),
         moderation_mode = COALESCE(p_moderation_mode, moderation_mode)
   WHERE id = p_group_id;

  PERFORM public.log_social_group_mod_action(
    p_group_id,
    'update_settings',
    NULL,
    NULL,
    jsonb_build_object(
      'privacy', p_privacy,
      'can_post', p_can_post,
      'can_chat', p_can_chat,
      'can_invite', p_can_invite,
      'moderation_mode', p_moderation_mode
    )
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.pin_social_group_post(
  p_group_id UUID,
  p_post_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.social_group_members
  WHERE group_id = p_group_id AND user_id = v_uid;

  IF v_actor_role NOT IN ('owner','admin','moderator') THEN
    RAISE EXCEPTION 'Only moderators can pin posts';
  END IF;

  IF p_post_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.posts WHERE id = p_post_id AND group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'Post not found in this group';
  END IF;

  UPDATE public.social_groups
     SET pinned_post_id = p_post_id
   WHERE id = p_group_id;

  PERFORM public.log_social_group_mod_action(
    p_group_id,
    CASE WHEN p_post_id IS NULL THEN 'unpin_post' ELSE 'pin_post' END,
    NULL,
    p_post_id,
    '{}'::jsonb
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_social_group_ownership(
  p_group_id UUID,
  p_new_owner_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor_role TEXT;
  v_target_role TEXT;
  v_room_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.social_group_members
  WHERE group_id = p_group_id AND user_id = v_uid;

  IF v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can transfer ownership';
  END IF;

  SELECT role INTO v_target_role
  FROM public.social_group_members
  WHERE group_id = p_group_id AND user_id = p_new_owner_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target member not found';
  END IF;

  IF p_new_owner_id = v_uid THEN
    RETURN TRUE;
  END IF;

  UPDATE public.social_group_members
     SET role = 'admin'
   WHERE group_id = p_group_id AND user_id = v_uid;

  UPDATE public.social_group_members
     SET role = 'owner'
   WHERE group_id = p_group_id AND user_id = p_new_owner_id;

  SELECT chat_room_id INTO v_room_id
  FROM public.social_groups
  WHERE id = p_group_id;

  IF v_room_id IS NOT NULL THEN
    UPDATE public.chat_room_members SET role = 'admin'
    WHERE room_id = v_room_id AND user_id = v_uid;

    UPDATE public.chat_room_members SET role = 'owner'
    WHERE room_id = v_room_id AND user_id = p_new_owner_id;
  END IF;

  UPDATE public.social_groups
     SET created_by = p_new_owner_id
   WHERE id = p_group_id;

  PERFORM public.log_social_group_mod_action(
    p_group_id,
    'transfer_ownership',
    p_new_owner_id,
    NULL,
    jsonb_build_object('previous_owner_id', v_uid)
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.ban_social_group_member(
  p_group_id UUID,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor_role TEXT;
  v_target_role TEXT;
  v_room_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.social_group_members
  WHERE group_id = p_group_id AND user_id = v_uid;

  SELECT role INTO v_target_role
  FROM public.social_group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  IF v_actor_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only owners/admins can ban members';
  END IF;

  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'You cannot ban yourself';
  END IF;

  IF v_actor_role = 'admin' AND v_target_role IN ('owner','admin') THEN
    RAISE EXCEPTION 'Admins cannot ban owner/admin';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Owner cannot be banned';
  END IF;

  INSERT INTO public.social_group_bans (group_id, user_id, banned_by, reason)
  VALUES (p_group_id, p_user_id, v_uid, NULLIF(trim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason, created_at = NOW();

  UPDATE public.social_group_invites
     SET status = 'revoked', responded_at = NOW()
   WHERE group_id = p_group_id
     AND invited_user_id = p_user_id
     AND status = 'pending';

  SELECT chat_room_id INTO v_room_id FROM public.social_groups WHERE id = p_group_id;

  DELETE FROM public.social_group_members
   WHERE group_id = p_group_id AND user_id = p_user_id;

  IF v_room_id IS NOT NULL THEN
    DELETE FROM public.chat_room_members
     WHERE room_id = v_room_id AND user_id = p_user_id;
  END IF;

  PERFORM public.log_social_group_mod_action(
    p_group_id,
    'ban_member',
    p_user_id,
    NULL,
    jsonb_build_object('reason', NULLIF(trim(COALESCE(p_reason, '')), ''))
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.unban_social_group_member(
  p_group_id UUID,
  p_user_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.social_group_members
  WHERE group_id = p_group_id AND user_id = v_uid;

  IF v_actor_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only owners/admins can unban members';
  END IF;

  DELETE FROM public.social_group_bans
   WHERE group_id = p_group_id AND user_id = p_user_id;

  PERFORM public.log_social_group_mod_action(
    p_group_id,
    'unban_member',
    p_user_id,
    NULL,
    '{}'::jsonb
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_social_group_post(
  p_post_id UUID,
  p_reason TEXT,
  p_details TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group_id UUID;
  v_post_owner UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT group_id, user_id INTO v_group_id, v_post_owner
  FROM public.posts
  WHERE id = p_post_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Group post not found';
  END IF;

  IF NOT public.is_social_group_member(v_group_id, v_uid) THEN
    RAISE EXCEPTION 'Only members can report this post';
  END IF;

  IF v_post_owner = v_uid THEN
    RAISE EXCEPTION 'You cannot report your own post';
  END IF;

  INSERT INTO public.social_group_post_reports (
    group_id, post_id, reporter_id, reason, details
  ) VALUES (
    v_group_id,
    p_post_id,
    v_uid,
    trim(p_reason),
    NULLIF(trim(COALESCE(p_details, '')), '')
  )
  ON CONFLICT (post_id, reporter_id)
  DO UPDATE SET
    reason = EXCLUDED.reason,
    details = EXCLUDED.details,
    status = 'pending',
    resolved_at = NULL,
    resolved_by = NULL,
    resolution = NULL,
    created_at = NOW();

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_social_group_post_report(
  p_report_id UUID,
  p_resolution TEXT,
  p_delete_post BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor_role TEXT;
  v_report RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_report
  FROM public.social_group_post_reports
  WHERE id = p_report_id;

  IF v_report IS NULL THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.social_group_members
  WHERE group_id = v_report.group_id AND user_id = v_uid;

  IF v_actor_role NOT IN ('owner','admin','moderator') THEN
    RAISE EXCEPTION 'Only moderators can resolve reports';
  END IF;

  UPDATE public.social_group_post_reports
     SET status = CASE WHEN p_delete_post THEN 'resolved' ELSE 'dismissed' END,
         resolved_at = NOW(),
         resolved_by = v_uid,
         resolution = NULLIF(trim(COALESCE(p_resolution, '')), '')
   WHERE id = p_report_id;

  IF p_delete_post THEN
    DELETE FROM public.posts WHERE id = v_report.post_id AND group_id = v_report.group_id;
  END IF;

  PERFORM public.log_social_group_mod_action(
    v_report.group_id,
    CASE WHEN p_delete_post THEN 'resolve_report_delete_post' ELSE 'dismiss_report' END,
    NULL,
    v_report.post_id,
    jsonb_build_object('report_id', p_report_id, 'resolution', NULLIF(trim(COALESCE(p_resolution, '')), ''))
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_social_group_post(
  p_group_id UUID,
  p_post_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.social_group_members
  WHERE group_id = p_group_id AND user_id = v_uid;

  IF v_actor_role NOT IN ('owner','admin','moderator') THEN
    RAISE EXCEPTION 'Only moderators can remove posts';
  END IF;

  DELETE FROM public.posts
   WHERE id = p_post_id AND group_id = p_group_id;

  UPDATE public.social_group_post_reports
     SET status = 'resolved',
         resolved_at = NOW(),
         resolved_by = v_uid,
         resolution = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'Removed by moderator')
   WHERE post_id = p_post_id AND group_id = p_group_id AND status = 'pending';

  PERFORM public.log_social_group_mod_action(
    p_group_id,
    'remove_post',
    NULL,
    p_post_id,
    jsonb_build_object('reason', NULLIF(trim(COALESCE(p_reason, '')), ''))
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_social_group(
  p_group_id UUID,
  p_confirm_name TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor_role TEXT;
  v_group_name TEXT;
  v_room_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT gm.role, g.name, g.chat_room_id
    INTO v_actor_role, v_group_name, v_room_id
  FROM public.social_groups g
  JOIN public.social_group_members gm
    ON gm.group_id = g.id AND gm.user_id = v_uid
  WHERE g.id = p_group_id;

  IF v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can delete the group';
  END IF;

  IF trim(COALESCE(p_confirm_name, '')) <> trim(COALESCE(v_group_name, '')) THEN
    RAISE EXCEPTION 'Confirmation name does not match';
  END IF;

  PERFORM public.log_social_group_mod_action(
    p_group_id,
    'delete_group',
    NULL,
    NULL,
    jsonb_build_object('group_name', v_group_name)
  );

  DELETE FROM public.posts WHERE group_id = p_group_id;

  IF v_room_id IS NOT NULL THEN
    DELETE FROM public.chat_room_members WHERE room_id = v_room_id;
    DELETE FROM public.chat_messages WHERE room_id = v_room_id;
    DELETE FROM public.chat_rooms WHERE id = v_room_id;
  END IF;

  DELETE FROM public.social_groups WHERE id = p_group_id;

  RETURN TRUE;
END;
$$;

ALTER TABLE public.social_group_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_group_post_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_group_mod_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_group_bans_select ON public.social_group_bans;
CREATE POLICY social_group_bans_select ON public.social_group_bans FOR SELECT
  USING (public.is_social_group_mod(group_id));

DROP POLICY IF EXISTS social_group_post_reports_select ON public.social_group_post_reports;
CREATE POLICY social_group_post_reports_select ON public.social_group_post_reports FOR SELECT
  USING (public.is_social_group_mod(group_id) OR reporter_id = auth.uid());

DROP POLICY IF EXISTS social_group_post_reports_insert ON public.social_group_post_reports;
CREATE POLICY social_group_post_reports_insert ON public.social_group_post_reports FOR INSERT
  WITH CHECK (public.is_social_group_member(group_id) AND reporter_id = auth.uid());

DROP POLICY IF EXISTS social_group_mod_actions_select ON public.social_group_mod_actions;
CREATE POLICY social_group_mod_actions_select ON public.social_group_mod_actions FOR SELECT
  USING (public.is_social_group_mod(group_id));

GRANT EXECUTE ON FUNCTION public.is_social_group_owner(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_social_group_mod_action(UUID, TEXT, UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_social_group_settings(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pin_social_group_post(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_social_group_ownership(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ban_social_group_member(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unban_social_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_social_group_post(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_social_group_post_report(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_social_group_post(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_social_group(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
