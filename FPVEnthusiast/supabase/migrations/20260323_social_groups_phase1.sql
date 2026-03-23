-- ══════════════════════════════════════════════════════════════════════════════
-- Social Groups / Communities — group feed + moderated group chat
-- ══════════════════════════════════════════════════════════════════════════════

-- 1) Schema ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 60),
  description TEXT,
  privacy     TEXT NOT NULL DEFAULT 'private'
              CHECK (privacy IN ('public','private','invite_only')),
  avatar_url  TEXT,
  cover_url   TEXT,
  created_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chat_room_id UUID REFERENCES public.chat_rooms(id) ON DELETE SET NULL,
  can_post    TEXT NOT NULL DEFAULT 'members'
              CHECK (can_post IN ('members','mods')),
  can_chat    TEXT NOT NULL DEFAULT 'members'
              CHECK (can_chat IN ('members','mods')),
  can_invite  TEXT NOT NULL DEFAULT 'mods'
              CHECK (can_invite IN ('members','mods')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.social_group_members (
  group_id    UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner','admin','moderator','member')),
  invited_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.social_group_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  invited_by      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin','moderator','member')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','declined','revoked')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at    TIMESTAMPTZ,
  UNIQUE (group_id, invited_user_id, status)
);

ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS social_group_id UUID REFERENCES public.social_groups(id) ON DELETE SET NULL;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.social_groups(id) ON DELETE SET NULL;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS post_scope TEXT NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_post_scope_check'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_post_scope_check
      CHECK (post_scope IN ('public','group'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_social_groups_created_by    ON public.social_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_social_groups_chat_room     ON public.social_groups(chat_room_id);
CREATE INDEX IF NOT EXISTS idx_social_group_members_user   ON public.social_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_social_group_members_group  ON public.social_group_members(group_id, role);
CREATE INDEX IF NOT EXISTS idx_social_group_invites_user   ON public.social_group_invites(invited_user_id, status);
CREATE INDEX IF NOT EXISTS idx_posts_group_visibility      ON public.posts(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_social_group     ON public.chat_rooms(social_group_id);

-- 2) updated_at trigger -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_social_groups_updated_at ON public.social_groups;
CREATE TRIGGER trg_social_groups_updated_at
  BEFORE UPDATE ON public.social_groups
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3) Permission helpers -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_social_group_member(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.social_group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = COALESCE(p_user_id, auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_social_group_mod(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.social_group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = COALESCE(p_user_id, auth.uid())
      AND gm.role IN ('owner','admin','moderator')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_post_to_social_group(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.social_groups g
    JOIN public.social_group_members gm
      ON gm.group_id = g.id
     AND gm.user_id = COALESCE(p_user_id, auth.uid())
    WHERE g.id = p_group_id
      AND (
        g.can_post = 'members'
        OR gm.role IN ('owner','admin','moderator')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_chat_in_social_group(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.social_groups g
    JOIN public.social_group_members gm
      ON gm.group_id = g.id
     AND gm.user_id = COALESCE(p_user_id, auth.uid())
    WHERE g.id = p_group_id
      AND (
        g.can_chat = 'members'
        OR gm.role IN ('owner','admin','moderator')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_invite_to_social_group(
  p_group_id UUID,
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.social_groups g
    JOIN public.social_group_members gm
      ON gm.group_id = g.id
     AND gm.user_id = COALESCE(p_user_id, auth.uid())
    WHERE g.id = p_group_id
      AND (
        g.can_invite = 'members'
        OR gm.role IN ('owner','admin','moderator')
      )
  );
$$;

-- 4) RLS ---------------------------------------------------------------------
ALTER TABLE public.social_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_group_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_groups_select ON public.social_groups;
CREATE POLICY social_groups_select ON public.social_groups FOR SELECT
  USING (
    privacy = 'public'
    OR public.is_social_group_member(id)
  );

DROP POLICY IF EXISTS social_groups_insert ON public.social_groups;
CREATE POLICY social_groups_insert ON public.social_groups FOR INSERT
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS social_groups_update ON public.social_groups;
CREATE POLICY social_groups_update ON public.social_groups FOR UPDATE
  USING (public.is_social_group_mod(id));

DROP POLICY IF EXISTS social_group_members_select ON public.social_group_members;
CREATE POLICY social_group_members_select ON public.social_group_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_social_group_member(group_id)
    OR EXISTS (
      SELECT 1 FROM public.social_groups g
      WHERE g.id = group_id AND g.privacy = 'public'
    )
  );

DROP POLICY IF EXISTS social_group_members_update_self ON public.social_group_members;
CREATE POLICY social_group_members_update_self ON public.social_group_members FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS social_group_invites_select ON public.social_group_invites;
CREATE POLICY social_group_invites_select ON public.social_group_invites FOR SELECT
  USING (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
    OR public.is_social_group_mod(group_id)
  );

DROP POLICY IF EXISTS social_group_invites_insert ON public.social_group_invites;
CREATE POLICY social_group_invites_insert ON public.social_group_invites FOR INSERT
  WITH CHECK (public.can_invite_to_social_group(group_id));

DROP POLICY IF EXISTS social_group_invites_update ON public.social_group_invites;
CREATE POLICY social_group_invites_update ON public.social_group_invites FOR UPDATE
  USING (
    invited_user_id = auth.uid()
    OR public.is_social_group_mod(group_id)
  );

-- Restrictive visibility for private group posts in member feed.
DROP POLICY IF EXISTS posts_group_visibility_gate ON public.posts;
CREATE POLICY posts_group_visibility_gate
  AS RESTRICTIVE
  ON public.posts FOR SELECT TO authenticated
  USING (
    group_id IS NULL
    OR public.is_social_group_member(group_id)
  );

-- Restrictive insert gate for group posting permissions.
DROP POLICY IF EXISTS posts_group_insert_gate ON public.posts;
CREATE POLICY posts_group_insert_gate
  AS RESTRICTIVE
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (
    group_id IS NULL
    OR public.can_post_to_social_group(group_id)
  );

-- Restrictive chat permission gate for moderated group chats.
DROP POLICY IF EXISTS cm_group_chat_permissions ON public.chat_messages;
CREATE POLICY cm_group_chat_permissions
  AS RESTRICTIVE
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1
      FROM public.chat_rooms cr
      WHERE cr.id = chat_messages.room_id
        AND cr.social_group_id IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public.chat_rooms cr
      WHERE cr.id = chat_messages.room_id
        AND cr.social_group_id IS NOT NULL
        AND public.can_chat_in_social_group(cr.social_group_id)
    )
  );

-- 5) RPCs --------------------------------------------------------------------
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

    INSERT INTO public.social_group_members (group_id, user_id, role, invited_by)
    VALUES (v_group_id, v_member_id, 'member', v_uid)
    ON CONFLICT (group_id, user_id) DO NOTHING;

    INSERT INTO public.chat_room_members (room_id, user_id, role)
    VALUES (v_room_id, v_member_id, 'member')
    ON CONFLICT (room_id, user_id) DO NOTHING;

    INSERT INTO public.social_group_invites (
      group_id, invited_user_id, invited_by, role, status, responded_at
    )
    VALUES (v_group_id, v_member_id, v_uid, 'member', 'accepted', NOW())
    ON CONFLICT (group_id, invited_user_id, status) DO NOTHING;
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
  v_actor_name TEXT;
  v_target_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_invite_to_social_group(p_group_id, v_uid) THEN
    RAISE EXCEPTION 'Not allowed to invite members';
  END IF;

  SELECT chat_room_id INTO v_room_id
  FROM public.social_groups
  WHERE id = p_group_id;

  INSERT INTO public.social_group_members (group_id, user_id, role, invited_by)
  VALUES (p_group_id, p_user_id, COALESCE(p_role, 'member'), v_uid)
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (
    v_room_id,
    p_user_id,
    CASE WHEN COALESCE(p_role, 'member') IN ('owner','admin','moderator') THEN 'admin' ELSE 'member' END
  )
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO public.social_group_invites (
    group_id, invited_user_id, invited_by, role, status, responded_at
  )
  VALUES (p_group_id, p_user_id, v_uid, COALESCE(p_role, 'member'), 'accepted', NOW())
  ON CONFLICT (group_id, invited_user_id, status) DO NOTHING;

  SELECT username INTO v_actor_name FROM public.users WHERE id = v_uid;
  SELECT username INTO v_target_name FROM public.users WHERE id = p_user_id;

  INSERT INTO public.chat_messages (room_id, sender_id, body, type)
  VALUES (
    v_room_id,
    v_uid,
    COALESCE(v_actor_name, 'Someone') || ' added ' || COALESCE(v_target_name, 'a member') || ' to the group.',
    'system'
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_social_group_member_role(
  p_group_id UUID,
  p_user_id UUID,
  p_role TEXT
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

  IF v_actor_role IS NULL OR v_target_role IS NULL THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;

  IF v_actor_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only owners/admins can change roles';
  END IF;

  IF v_actor_role = 'admin' AND v_target_role IN ('owner','admin') THEN
    RAISE EXCEPTION 'Admins cannot edit owner/admin roles';
  END IF;

  IF p_role NOT IN ('admin','moderator','member') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  UPDATE public.social_group_members
     SET role = p_role
   WHERE group_id = p_group_id AND user_id = p_user_id;

  SELECT chat_room_id INTO v_room_id
  FROM public.social_groups
  WHERE id = p_group_id;

  UPDATE public.chat_room_members
     SET role = CASE WHEN p_role IN ('admin','moderator') THEN 'admin' ELSE 'member' END
   WHERE room_id = v_room_id AND user_id = p_user_id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_social_group_member(
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

  IF v_target_role IS NULL THEN
    RETURN TRUE;
  END IF;

  IF v_uid <> p_user_id THEN
    IF v_actor_role NOT IN ('owner','admin') THEN
      RAISE EXCEPTION 'Only owners/admins can remove members';
    END IF;
    IF v_actor_role = 'admin' AND v_target_role IN ('owner','admin') THEN
      RAISE EXCEPTION 'Admins cannot remove owner/admin';
    END IF;
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Owner cannot be removed';
  END IF;

  SELECT chat_room_id INTO v_room_id
  FROM public.social_groups
  WHERE id = p_group_id;

  DELETE FROM public.social_group_members
   WHERE group_id = p_group_id AND user_id = p_user_id;

  DELETE FROM public.chat_room_members
   WHERE room_id = v_room_id AND user_id = p_user_id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_social_group_settings(
  p_group_id UUID,
  p_description TEXT DEFAULT NULL,
  p_privacy TEXT DEFAULT NULL,
  p_can_post TEXT DEFAULT NULL,
  p_can_chat TEXT DEFAULT NULL,
  p_can_invite TEXT DEFAULT NULL
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

  UPDATE public.social_groups
     SET description = COALESCE(NULLIF(trim(COALESCE(p_description, '')), ''), description),
         privacy = COALESCE(p_privacy, privacy),
         can_post = COALESCE(p_can_post, can_post),
         can_chat = COALESCE(p_can_chat, can_chat),
         can_invite = COALESCE(p_can_invite, can_invite)
   WHERE id = p_group_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_social_group(TEXT, TEXT, TEXT, UUID[], TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_social_group_member(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_social_group_member_role(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_social_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_social_group_settings(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_social_group_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_social_group_mod(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_post_to_social_group(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_chat_in_social_group(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_invite_to_social_group(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
