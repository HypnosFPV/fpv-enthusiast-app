-- Social groups phase 2: true invite consent, pending invite notifications,
-- and accept/decline RPCs.

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
        'like', 'comment', 'follow', 'mention', 'reply',
        'challenge_voting_open', 'challenge_voting_closing', 'challenge_result',
        'new_message', 'new_offer', 'offer_accepted', 'offer_declined',
        'marketplace_dispute', 'dispute_resolved',
        'group_invite'
      )
    );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.create_social_group(
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_privacy TEXT DEFAULT 'private',
  p_member_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_can_post TEXT DEFAULT 'members',
  p_can_chat TEXT DEFAULT 'members',
  p_can_invite TEXT DEFAULT 'mods'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room_id UUID;
  v_group_id UUID;
  v_member_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.chat_rooms (type, name, created_by)
  VALUES ('group', trim(p_name), v_uid)
  RETURNING id INTO v_room_id;

  INSERT INTO public.social_groups (
    name, description, privacy, created_by, chat_room_id,
    can_post, can_chat, can_invite
  )
  VALUES (
    trim(p_name),
    NULLIF(trim(COALESCE(p_description, '')), ''),
    COALESCE(p_privacy, 'private'),
    v_uid,
    v_room_id,
    COALESCE(p_can_post, 'members'),
    COALESCE(p_can_chat, 'members'),
    COALESCE(p_can_invite, 'mods')
  )
  RETURNING id INTO v_group_id;

  UPDATE public.chat_rooms
     SET social_group_id = v_group_id
   WHERE id = v_room_id;

  INSERT INTO public.social_group_members (group_id, user_id, role, invited_by)
  VALUES (v_group_id, v_uid, 'owner', v_uid)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (v_room_id, v_uid, 'owner')
  ON CONFLICT (room_id, user_id) DO NOTHING;

  FOREACH v_member_id IN ARRAY COALESCE(p_member_ids, ARRAY[]::UUID[])
  LOOP
    CONTINUE WHEN v_member_id IS NULL OR v_member_id = v_uid;

    UPDATE public.social_group_invites
       SET status = 'revoked', responded_at = NOW()
     WHERE group_id = v_group_id
       AND invited_user_id = v_member_id
       AND status = 'pending';

    INSERT INTO public.social_group_invites (
      group_id, invited_user_id, invited_by, role, status, responded_at
    )
    VALUES (v_group_id, v_member_id, v_uid, 'member', 'pending', NULL)
    ON CONFLICT (group_id, invited_user_id, status)
    DO UPDATE SET
      invited_by = EXCLUDED.invited_by,
      role = EXCLUDED.role,
      responded_at = NULL,
      created_at = NOW();

    INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, message)
    VALUES (
      v_member_id,
      v_uid,
      'group_invite',
      v_group_id,
      'social_group',
      trim(p_name) || ' invited you to join.'
    );
  END LOOP;

  INSERT INTO public.chat_messages (room_id, sender_id, body, type)
  VALUES (v_room_id, v_uid, trim(p_name) || ' was created.', 'system');

  RETURN v_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_social_group_member(
  p_group_id UUID,
  p_user_id UUID,
  p_role TEXT DEFAULT 'member'
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_room_id UUID;
  v_group_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'Cannot invite yourself';
  END IF;

  IF NOT public.can_invite_to_social_group(p_group_id, v_uid) THEN
    RAISE EXCEPTION 'Not allowed to invite members';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.social_group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RETURN TRUE;
  END IF;

  SELECT chat_room_id, name INTO v_room_id, v_group_name
  FROM public.social_groups
  WHERE id = p_group_id;

  UPDATE public.social_group_invites
     SET status = 'revoked', responded_at = NOW()
   WHERE group_id = p_group_id
     AND invited_user_id = p_user_id
     AND status = 'pending';

  INSERT INTO public.social_group_invites (
    group_id, invited_user_id, invited_by, role, status, responded_at
  )
  VALUES (p_group_id, p_user_id, v_uid, COALESCE(p_role, 'member'), 'pending', NULL)
  ON CONFLICT (group_id, invited_user_id, status)
  DO UPDATE SET
    invited_by = EXCLUDED.invited_by,
    role = EXCLUDED.role,
    responded_at = NULL,
    created_at = NOW();

  INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, message)
  VALUES (
    p_user_id,
    v_uid,
    'group_invite',
    p_group_id,
    'social_group',
    COALESCE(v_group_name, 'A community') || ' invited you to join.'
  );

  IF v_room_id IS NOT NULL THEN
    INSERT INTO public.chat_messages (room_id, sender_id, body, type)
    VALUES (
      v_room_id,
      v_uid,
      'An invite was sent to a new member.',
      'system'
    );
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_social_group_invite(
  p_invite_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_invite RECORD;
  v_actor_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT i.*, g.chat_room_id, g.name AS group_name
    INTO v_invite
  FROM public.social_group_invites i
  JOIN public.social_groups g ON g.id = i.group_id
  WHERE i.id = p_invite_id
    AND i.invited_user_id = v_uid
    AND i.status = 'pending'
  LIMIT 1;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  UPDATE public.social_group_invites
     SET status = 'accepted', responded_at = NOW()
   WHERE id = p_invite_id;

  INSERT INTO public.social_group_members (group_id, user_id, role, invited_by)
  VALUES (v_invite.group_id, v_uid, COALESCE(v_invite.role, 'member'), v_invite.invited_by)
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    invited_by = EXCLUDED.invited_by;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (
    v_invite.chat_room_id,
    v_uid,
    CASE WHEN COALESCE(v_invite.role, 'member') IN ('owner','admin','moderator') THEN 'admin' ELSE 'member' END
  )
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  SELECT username INTO v_actor_name FROM public.users WHERE id = v_uid;

  INSERT INTO public.chat_messages (room_id, sender_id, body, type)
  VALUES (
    v_invite.chat_room_id,
    v_uid,
    COALESCE(v_actor_name, 'Someone') || ' joined ' || COALESCE(v_invite.group_name, 'the group') || '.',
    'system'
  );

  RETURN v_invite.group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_social_group_invite(
  p_invite_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.social_group_invites
     SET status = 'declined', responded_at = NOW()
   WHERE id = p_invite_id
     AND invited_user_id = v_uid
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_social_group(TEXT, TEXT, TEXT, UUID[], TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_social_group_member(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_social_group_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_social_group_invite(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
