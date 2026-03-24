-- ══════════════════════════════════════════════════════════════════════════════
-- Social group theming (Model A: per-user theme choice per group)
-- Preset themes live in app code; this schema stores user preference +
-- purchased custom themes scoped to a single group.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.social_group_theme_preferences (
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  group_id          UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  active_theme_type TEXT NOT NULL CHECK (active_theme_type IN ('preset', 'custom')),
  active_theme_id   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS public.social_group_custom_themes (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                 UUID NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  owner_user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 60),
  accent_color             TEXT NOT NULL,
  surface_color            TEXT NOT NULL,
  surface_secondary_color  TEXT NOT NULL,
  border_color             TEXT NOT NULL,
  chip_background_color    TEXT NOT NULL,
  chip_text_color          TEXT NOT NULL,
  text_color               TEXT NOT NULL DEFAULT '#ffffff',
  muted_text_color         TEXT NOT NULL DEFAULT '#b8bfd9',
  banner_image_url         TEXT,
  card_image_url           TEXT,
  overlay_strength         INTEGER NOT NULL DEFAULT 72 CHECK (overlay_strength BETWEEN 20 AND 92),
  status                   TEXT NOT NULL DEFAULT 'pending_payment'
                           CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'archived')),
  stripe_payment_intent    TEXT,
  purchase_amount_cents    INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_theme_pref_group ON public.social_group_theme_preferences(group_id);
CREATE INDEX IF NOT EXISTS idx_group_theme_pref_user ON public.social_group_theme_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_group_custom_themes_owner_group ON public.social_group_custom_themes(owner_user_id, group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_custom_themes_pi ON public.social_group_custom_themes(stripe_payment_intent);

DROP TRIGGER IF EXISTS trg_social_group_theme_preferences_updated_at ON public.social_group_theme_preferences;
CREATE TRIGGER trg_social_group_theme_preferences_updated_at
  BEFORE UPDATE ON public.social_group_theme_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_social_group_custom_themes_updated_at ON public.social_group_custom_themes;
CREATE TRIGGER trg_social_group_custom_themes_updated_at
  BEFORE UPDATE ON public.social_group_custom_themes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.social_group_theme_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_group_custom_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_group_theme_preferences_select ON public.social_group_theme_preferences;
CREATE POLICY social_group_theme_preferences_select ON public.social_group_theme_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS social_group_theme_preferences_insert ON public.social_group_theme_preferences;
CREATE POLICY social_group_theme_preferences_insert ON public.social_group_theme_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS social_group_theme_preferences_update ON public.social_group_theme_preferences;
CREATE POLICY social_group_theme_preferences_update ON public.social_group_theme_preferences
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS social_group_theme_preferences_delete ON public.social_group_theme_preferences;
CREATE POLICY social_group_theme_preferences_delete ON public.social_group_theme_preferences
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS social_group_custom_themes_select ON public.social_group_custom_themes;
CREATE POLICY social_group_custom_themes_select ON public.social_group_custom_themes
  FOR SELECT USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS social_group_custom_themes_insert ON public.social_group_custom_themes;
CREATE POLICY social_group_custom_themes_insert ON public.social_group_custom_themes
  FOR INSERT WITH CHECK (
    auth.uid() = owner_user_id
    AND EXISTS (
      SELECT 1
      FROM public.social_group_members gm
      WHERE gm.group_id = social_group_custom_themes.group_id
        AND gm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS social_group_custom_themes_update ON public.social_group_custom_themes;
CREATE POLICY social_group_custom_themes_update ON public.social_group_custom_themes
  FOR UPDATE USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS social_group_custom_themes_delete ON public.social_group_custom_themes;
CREATE POLICY social_group_custom_themes_delete ON public.social_group_custom_themes
  FOR DELETE USING (auth.uid() = owner_user_id);
