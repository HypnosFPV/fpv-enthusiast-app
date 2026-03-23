-- ============================================================
-- Migration: props_log table + trigger + RLS
-- File: FPVEnthusiast/supabase/migrations/20260311_props_log_and_awards.sql
-- ============================================================

-- 1. Create props_log table
-- Each row = one props award event. UNIQUE constraint prevents double-awarding.
CREATE TABLE IF NOT EXISTS public.props_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount        integer     NOT NULL CHECK (amount > 0),
  reason        text        NOT NULL,        -- e.g. 'first_post', 'easter_egg'
  reference_id  text        NOT NULL DEFAULT '',  -- dedup key (user_id, post_id, etc.)
  created_at    timestamptz DEFAULT now(),
  -- Prevent the same event from being awarded twice
  CONSTRAINT props_log_dedup UNIQUE (user_id, reason, reference_id)
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS props_log_user_idx ON public.props_log (user_id);

-- 2. Trigger function: increment users.total_props on each new props_log row
CREATE OR REPLACE FUNCTION public.apply_props_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET total_props = COALESCE(total_props, 0) + NEW.amount
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger to ensure idempotency
DROP TRIGGER IF EXISTS trg_apply_props_log ON public.props_log;
CREATE TRIGGER trg_apply_props_log
AFTER INSERT ON public.props_log
FOR EACH ROW EXECUTE FUNCTION public.apply_props_log();

-- 3. Row Level Security
ALTER TABLE public.props_log ENABLE ROW LEVEL SECURITY;

-- Users can only read their own log
DROP POLICY IF EXISTS "Users can view own props log" ON public.props_log;
CREATE POLICY "Users can view own props log"
  ON public.props_log FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own awards (dedup constraint prevents double-awarding)
DROP POLICY IF EXISTS "Users can insert own props" ON public.props_log;
CREATE POLICY "Users can insert own props"
  ON public.props_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role can do anything (needed by finalize_challenge RPC)
DROP POLICY IF EXISTS "Service role full access" ON public.props_log;
CREATE POLICY "Service role full access"
  ON public.props_log FOR ALL
  USING (auth.role() = 'service_role');

-- 4. Grant permissions
GRANT SELECT, INSERT ON public.props_log TO authenticated;
GRANT ALL ON public.props_log TO service_role;

-- ============================================================
-- Done. Run SELECT * FROM props_log LIMIT 1; to verify table.
-- ============================================================
