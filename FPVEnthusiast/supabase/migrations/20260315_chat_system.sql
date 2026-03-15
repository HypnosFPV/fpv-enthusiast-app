-- ══════════════════════════════════════════════════════════════════════════════
-- FPV Chat System — DMs, Group Chats, Marketplace Chat Integration
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. chat_rooms
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL DEFAULT 'dm'
                  CHECK (type IN ('dm','group','marketplace')),
  name            TEXT,                                    -- null for DMs
  avatar_url      TEXT,                                    -- group icon
  listing_id      UUID REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  last_message    TEXT,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. chat_room_members
CREATE TABLE IF NOT EXISTS public.chat_room_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner','admin','member')),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, user_id)
);

-- 3. chat_messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES public.chat_rooms(id)   ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES public.users(id)        ON DELETE CASCADE,
  body        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'text'
              CHECK (type IN ('text','image','offer','system')),
  metadata    JSONB,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_crm_room    ON public.chat_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_crm_user    ON public.chat_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_cm_room     ON public.chat_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cm_sender   ON public.chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_cr_updated  ON public.chat_rooms(updated_at DESC);

-- 5. RLS
ALTER TABLE public.chat_rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages     ENABLE ROW LEVEL SECURITY;

-- chat_rooms: member can select
CREATE POLICY cr_select ON public.chat_rooms FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.chat_room_members
    WHERE room_id = id AND user_id = auth.uid()
  ));

-- chat_rooms: any auth user can insert (they'll add themselves as member next)
CREATE POLICY cr_insert ON public.chat_rooms FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- chat_rooms: only members can update (last_message, etc.)
CREATE POLICY cr_update ON public.chat_rooms FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.chat_room_members
    WHERE room_id = id AND user_id = auth.uid()
  ));

-- chat_room_members: members can see other members of their rooms
CREATE POLICY crm_select ON public.chat_room_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.chat_room_members crm2
    WHERE crm2.room_id = room_id AND crm2.user_id = auth.uid()
  ));

CREATE POLICY crm_insert ON public.chat_room_members FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY crm_update ON public.chat_room_members FOR UPDATE
  USING (user_id = auth.uid());

-- chat_messages: room members can read
CREATE POLICY cm_select ON public.chat_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.chat_room_members
    WHERE room_id = chat_messages.room_id AND user_id = auth.uid()
  ));

CREATE POLICY cm_insert ON public.chat_messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.chat_room_members
      WHERE room_id = chat_messages.room_id AND user_id = auth.uid()
    )
  );

-- 6. Function: get_or_create_dm(other_user_id) → room_id
CREATE OR REPLACE FUNCTION public.get_or_create_dm(p_other_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_room_id UUID;
BEGIN
  -- Look for existing DM between the two users
  SELECT cr.id INTO v_room_id
  FROM public.chat_rooms cr
  WHERE cr.type = 'dm'
    AND (SELECT COUNT(*) FROM public.chat_room_members WHERE room_id = cr.id) = 2
    AND EXISTS (SELECT 1 FROM public.chat_room_members WHERE room_id = cr.id AND user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.chat_room_members WHERE room_id = cr.id AND user_id = p_other_id)
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- Create new DM room
  INSERT INTO public.chat_rooms (type, created_by)
  VALUES ('dm', auth.uid())
  RETURNING id INTO v_room_id;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (v_room_id, auth.uid(), 'owner'), (v_room_id, p_other_id, 'member');

  RETURN v_room_id;
END;
$$;

-- 7. Function: get_or_create_marketplace_chat(listing_id, seller_id)
CREATE OR REPLACE FUNCTION public.get_or_create_marketplace_chat(
  p_listing_id UUID,
  p_seller_id  UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_room_id UUID;
BEGIN
  -- Seller opening their own listing chat — not allowed to DM yourself
  IF auth.uid() = p_seller_id THEN
    -- Find any marketplace chat for this listing the seller is in
    SELECT cr.id INTO v_room_id
    FROM public.chat_rooms cr
    WHERE cr.type = 'marketplace' AND cr.listing_id = p_listing_id
      AND EXISTS (SELECT 1 FROM public.chat_room_members WHERE room_id = cr.id AND user_id = auth.uid())
    ORDER BY cr.last_message_at DESC NULLS LAST
    LIMIT 1;
    RETURN v_room_id;
  END IF;

  -- Find existing chat for this buyer+listing
  SELECT cr.id INTO v_room_id
  FROM public.chat_rooms cr
  WHERE cr.type = 'marketplace' AND cr.listing_id = p_listing_id
    AND EXISTS (SELECT 1 FROM public.chat_room_members WHERE room_id = cr.id AND user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.chat_room_members WHERE room_id = cr.id AND user_id = p_seller_id)
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- Create new marketplace chat
  INSERT INTO public.chat_rooms (type, listing_id, created_by)
  VALUES ('marketplace', p_listing_id, auth.uid())
  RETURNING id INTO v_room_id;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (v_room_id, auth.uid(), 'member'), (v_room_id, p_seller_id, 'member');

  RETURN v_room_id;
END;
$$;

-- 8. Trigger: update chat_rooms.last_message + updated_at on new message
CREATE OR REPLACE FUNCTION public.update_chat_room_last_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.chat_rooms
  SET last_message    = LEFT(NEW.body, 80),
      last_message_at = NEW.created_at,
      updated_at      = NEW.created_at
  WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_last_msg ON public.chat_messages;
CREATE TRIGGER trg_chat_last_msg
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_chat_room_last_message();

GRANT EXECUTE ON FUNCTION public.get_or_create_dm(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_marketplace_chat(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
