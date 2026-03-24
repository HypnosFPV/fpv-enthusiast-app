-- Searchable communities + request-to-join flow

CREATE TABLE IF NOT EXISTS public.social_group_join_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  responded_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_group_join_requests_pending
  ON public.social_group_join_requests(group_id, user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_group_status
  ON public.social_group_join_requests(group_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_group_join_requests_user_status
  ON public.social_group_join_requests(user_id, status, created_at DESC);

ALTER TABLE public.social_group_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_group_join_requests_select ON public.social_group_join_requests;
CREATE POLICY social_group_join_requests_select ON public.social_group_join_requests FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.can_invite_to_social_group(group_id)
    OR public.is_social_group_mod(group_id)
  );

DROP POLICY IF EXISTS social_group_join_requests_insert ON public.social_group_join_requests;
CREATE POLICY social_group_join_requests_insert ON public.social_group_join_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS social_group_join_requests_update ON public.social_group_join_requests;
CREATE POLICY social_group_join_requests_update ON public.social_group_join_requests FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.can_invite_to_social_group(group_id)
    OR public.is_social_group_mod(group_id)
  );

CREATE OR REPLACE FUNCTION public.search_social_groups(
  p_query TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
) RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  privacy TEXT,
  avatar_url TEXT,
  cover_url TEXT,
  created_by UUID,
  chat_room_id UUID,
  can_post TEXT,
  can_chat TEXT,
  can_invite TEXT,
  moderation_mode TEXT,
  pinned_post_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  member_count BIGINT,
  my_role TEXT,
  has_pending_invite BOOLEAN,
  has_pending_request BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT NULLIF(trim(COALESCE(p_query, '')), '') AS value,
           LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50) AS max_rows,
           auth.uid() AS uid
  )
  SELECT
    g.id,
    g.name,
    g.description,
    g.privacy,
    g.avatar_url,
    g.cover_url,
    g.created_by,
    g.chat_room_id,
    g.can_post,
    g.can_chat,
    g.can_invite,
    COALESCE(g.moderation_mode, 'normal') AS moderation_mode,
    g.pinned_post_id,
    g.created_at,
    g.updated_at,
    COALESCE(member_counts.member_count, 0) AS member_count,
    membership.role AS my_role,
    COALESCE(invites.has_pending_invite, FALSE) AS has_pending_invite,
    COALESCE(requests.has_pending_request, FALSE) AS has_pending_request
  FROM public.social_groups g
  CROSS JOIN q
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::BIGINT AS member_count
    FROM public.social_group_members gm
    WHERE gm.group_id = g.id
  ) member_counts ON TRUE
  LEFT JOIN LATERAL (
    SELECT gm.role
    FROM public.social_group_members gm
    WHERE gm.group_id = g.id
      AND gm.user_id = q.uid
    LIMIT 1
  ) membership ON TRUE
  LEFT JOIN LATERAL (
    SELECT TRUE AS has_pending_invite
    FROM public.social_group_invites gi
    WHERE gi.group_id = g.id
      AND gi.invited_user_id = q.uid
      AND gi.status = 'pending'
    LIMIT 1
  ) invites ON TRUE
  LEFT JOIN LATERAL (
    SELECT TRUE AS has_pending_request
    FROM public.social_group_join_requests jr
    WHERE jr.group_id = g.id
      AND jr.user_id = q.uid
      AND jr.status = 'pending'
    LIMIT 1
  ) requests ON TRUE
  WHERE q.uid IS NOT NULL
    AND (
      q.value IS NULL
      OR g.name ILIKE '%' || q.value || '%'
      OR COALESCE(g.description, '') ILIKE '%' || q.value || '%'
    )
  ORDER BY
    CASE WHEN q.value IS NOT NULL AND lower(g.name) = lower(q.value) THEN 0 ELSE 1 END,
    CASE WHEN q.value IS NOT NULL AND lower(g.name) LIKE lower(q.value) || '%' THEN 0 ELSE 1 END,
    g.updated_at DESC
  LIMIT (SELECT max_rows FROM q);
$$;

CREATE OR REPLACE FUNCTION public.request_to_join_social_group(
  p_group_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_group RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT g.id, g.name, g.privacy, g.chat_room_id
    INTO v_group
  FROM public.social_groups g
  WHERE g.id = p_group_id
  LIMIT 1;

  IF v_group IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.social_group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = v_uid
  ) THEN
    RETURN 'already_member';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.social_group_invites gi
    WHERE gi.group_id = p_group_id
      AND gi.invited_user_id = v_uid
      AND gi.status = 'pending'
  ) THEN
    RETURN 'pending_invite';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.social_group_join_requests jr
    WHERE jr.group_id = p_group_id
      AND jr.user_id = v_uid
      AND jr.status = 'pending'
  ) THEN
    RETURN 'pending_request';
  END IF;

  IF v_group.privacy = 'public' THEN
    INSERT INTO public.social_group_members (group_id, user_id, role, invited_by)
    VALUES (p_group_id, v_uid, 'member', v_uid)
    ON CONFLICT (group_id, user_id) DO NOTHING;

    IF v_group.chat_room_id IS NOT NULL THEN
      INSERT INTO public.chat_room_members (room_id, user_id, role)
      VALUES (v_group.chat_room_id, v_uid, 'member')
      ON CONFLICT (room_id, user_id) DO NOTHING;

      INSERT INTO public.chat_messages (room_id, sender_id, body, type)
      VALUES (v_group.chat_room_id, v_uid, 'A new member joined the community.', 'system');
    END IF;

    RETURN 'joined';
  END IF;

  INSERT INTO public.social_group_join_requests (group_id, user_id, status)
  VALUES (p_group_id, v_uid, 'pending')
  ON CONFLICT DO NOTHING;

  RETURN 'requested';
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_social_group_join_request(
  p_request_id UUID,
  p_action TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_request RECORD;
  v_action TEXT := lower(trim(COALESCE(p_action, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT jr.*, g.chat_room_id, g.name AS group_name
    INTO v_request
  FROM public.social_group_join_requests jr
  JOIN public.social_groups g ON g.id = jr.group_id
  WHERE jr.id = p_request_id
    AND jr.status = 'pending'
  LIMIT 1;

  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Join request not found';
  END IF;

  IF NOT (
    public.can_invite_to_social_group(v_request.group_id, v_uid)
    OR public.is_social_group_mod(v_request.group_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'Not allowed to respond to join requests';
  END IF;

  IF v_action = 'approve' THEN
    UPDATE public.social_group_join_requests
       SET status = 'approved', responded_at = NOW(), responded_by = v_uid
     WHERE id = p_request_id;

    INSERT INTO public.social_group_members (group_id, user_id, role, invited_by)
    VALUES (v_request.group_id, v_request.user_id, 'member', v_uid)
    ON CONFLICT (group_id, user_id) DO NOTHING;

    IF v_request.chat_room_id IS NOT NULL THEN
      INSERT INTO public.chat_room_members (room_id, user_id, role)
      VALUES (v_request.chat_room_id, v_request.user_id, 'member')
      ON CONFLICT (room_id, user_id) DO NOTHING;

      INSERT INTO public.chat_messages (room_id, sender_id, body, type)
      VALUES (v_request.chat_room_id, v_uid, 'A join request was approved.', 'system');
    END IF;
  ELSIF v_action = 'decline' THEN
    UPDATE public.social_group_join_requests
       SET status = 'declined', responded_at = NOW(), responded_by = v_uid
     WHERE id = p_request_id;
  ELSE
    RAISE EXCEPTION 'Unsupported action';
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_social_groups(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_to_join_social_group(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_social_group_join_request(UUID, TEXT) TO authenticated;
