-- Compatibility migration for permanent group deletion without the moderation suite
-- Safe to run even if delete_social_group already exists; it will replace it.

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

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Group not found or you are not a member';
  END IF;

  IF v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can delete the group';
  END IF;

  IF trim(COALESCE(p_confirm_name, '')) <> trim(COALESCE(v_group_name, '')) THEN
    RAISE EXCEPTION 'Confirmation name does not match';
  END IF;

  DELETE FROM public.posts WHERE group_id = p_group_id;
  DELETE FROM public.social_group_invites WHERE group_id = p_group_id;
  DELETE FROM public.social_group_members WHERE group_id = p_group_id;

  IF v_room_id IS NOT NULL THEN
    DELETE FROM public.chat_room_members WHERE room_id = v_room_id;
    DELETE FROM public.chat_messages WHERE room_id = v_room_id;
    DELETE FROM public.chat_rooms WHERE id = v_room_id;
  END IF;

  DELETE FROM public.social_groups WHERE id = p_group_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_social_group(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
