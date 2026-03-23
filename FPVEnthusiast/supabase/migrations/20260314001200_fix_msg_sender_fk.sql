-- Fix: add FK from marketplace_messages.sender_id → public.users(id)
-- This lets PostgREST resolve the sender join in fetchMessages
-- Without this FK, the join fails silently and fetchMessages returns null

-- 1. Drop the old auth.users FK on sender_id
ALTER TABLE public.marketplace_messages
  DROP CONSTRAINT IF EXISTS marketplace_messages_sender_id_fkey;

-- 2. Add new FK pointing to public.users instead
ALTER TABLE public.marketplace_messages
  ADD CONSTRAINT marketplace_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Do the same for buyer_id and seller_id so joins work for those too
ALTER TABLE public.marketplace_messages
  DROP CONSTRAINT IF EXISTS marketplace_messages_buyer_id_fkey;
ALTER TABLE public.marketplace_messages
  ADD CONSTRAINT marketplace_messages_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.marketplace_messages
  DROP CONSTRAINT IF EXISTS marketplace_messages_seller_id_fkey;
ALTER TABLE public.marketplace_messages
  ADD CONSTRAINT marketplace_messages_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
