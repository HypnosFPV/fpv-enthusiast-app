-- Add missing columns to challenge_entries + add delete RLS policy
-- Run in Supabase SQL Editor

-- 1. Add caption and duration_s columns (safe, idempotent)
ALTER TABLE challenge_entries ADD COLUMN IF NOT EXISTS caption    text;
ALTER TABLE challenge_entries ADD COLUMN IF NOT EXISTS duration_s float;

-- 2. Allow users to delete their OWN entry (needed for Replace Entry feature)
DROP POLICY IF EXISTS "owner delete entry" ON challenge_entries;
CREATE POLICY "owner delete entry"
  ON challenge_entries FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Reload schema cache (forces Supabase to pick up new columns immediately)
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'challenge_entries'
ORDER BY ordinal_position;
