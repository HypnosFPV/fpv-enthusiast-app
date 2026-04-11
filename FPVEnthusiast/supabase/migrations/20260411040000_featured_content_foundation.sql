-- =============================================================================
-- Featured feed content foundation
-- -----------------------------------------------------------------------------
-- Goal:
--   Build a moderation-first foundation for featured posts / events / livestreams
--   without exposing unsafe paid placements at the top of the feed.
--
-- Key ideas:
--   • Requests enter a pending_moderation queue first.
--   • Approval moves them to pending_payment (or later to active by service role).
--   • Featured placements are stricter than normal posts.
--   • Banner/logo and livestream metadata are stored with the request.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin_user(
  p_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT u.is_admin
    FROM public.users u
    WHERE u.id = COALESCE(p_user_id, auth.uid())
  ), false);
$$;

CREATE TABLE IF NOT EXISTS public.featured_content_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content_kind TEXT NOT NULL CHECK (content_kind IN ('post', 'event')),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.race_events(id) ON DELETE CASCADE,
  feature_kind TEXT NOT NULL CHECK (feature_kind IN ('post_spotlight', 'event_spotlight', 'livestream_spotlight')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('props', 'iap')),
  status TEXT NOT NULL DEFAULT 'pending_moderation'
    CHECK (status IN ('draft', 'pending_moderation', 'needs_review', 'approved', 'rejected', 'pending_payment', 'scheduled', 'active', 'expired', 'cancelled')),
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'needs_review', 'approved', 'rejected')),
  moderation_provider TEXT,
  moderation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  moderation_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  moderation_reason TEXT,
  moderation_score NUMERIC(5,4),
  banner_label TEXT CHECK (banner_label IS NULL OR char_length(trim(banner_label)) BETWEEN 1 AND 40),
  banner_image_url TEXT,
  livestream_url TEXT,
  livestream_platform TEXT,
  livestream_autoplay_muted BOOLEAN NOT NULL DEFAULT true,
  duration_hours INTEGER NOT NULL DEFAULT 24 CHECK (duration_hours BETWEEN 1 AND 168),
  props_cost INTEGER,
  price_cents INTEGER,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  moderated_at TIMESTAMPTZ,
  moderated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT featured_content_exactly_one_target CHECK (
    (content_kind = 'post'  AND post_id IS NOT NULL AND event_id IS NULL)
    OR
    (content_kind = 'event' AND event_id IS NOT NULL AND post_id IS NULL)
  ),
  CONSTRAINT featured_content_livestream_requirements CHECK (
    feature_kind <> 'livestream_spotlight' OR NULLIF(trim(COALESCE(livestream_url, '')), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_featured_content_owner_created
  ON public.featured_content_requests(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_featured_content_status_created
  ON public.featured_content_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_featured_content_active_window
  ON public.featured_content_requests(starts_at, ends_at)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_content_open_post_request
  ON public.featured_content_requests(post_id)
  WHERE post_id IS NOT NULL
    AND status IN ('pending_moderation', 'needs_review', 'approved', 'pending_payment', 'scheduled', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_content_open_event_request
  ON public.featured_content_requests(event_id)
  WHERE event_id IS NOT NULL
    AND status IN ('pending_moderation', 'needs_review', 'approved', 'pending_payment', 'scheduled', 'active');

CREATE OR REPLACE FUNCTION public.tg_set_featured_content_requests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_featured_content_requests_updated_at ON public.featured_content_requests;
CREATE TRIGGER trg_featured_content_requests_updated_at
  BEFORE UPDATE ON public.featured_content_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_featured_content_requests_updated_at();

ALTER TABLE public.featured_content_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "featured_content_owner_select" ON public.featured_content_requests;
CREATE POLICY "featured_content_owner_select"
  ON public.featured_content_requests FOR SELECT
  USING (auth.uid() = owner_user_id OR public.is_admin_user(auth.uid()));

CREATE OR REPLACE FUNCTION public.submit_featured_post_request(
  p_post_id UUID,
  p_feature_kind TEXT DEFAULT 'post_spotlight',
  p_payment_method TEXT DEFAULT 'props',
  p_duration_hours INTEGER DEFAULT 24,
  p_banner_label TEXT DEFAULT NULL,
  p_banner_image_url TEXT DEFAULT NULL,
  p_livestream_url TEXT DEFAULT NULL,
  p_livestream_platform TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_existing UUID;
  v_request_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_feature_kind NOT IN ('post_spotlight', 'livestream_spotlight') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_feature_kind');
  END IF;

  IF p_payment_method NOT IN ('props', 'iap') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  END IF;

  SELECT user_id INTO v_owner
  FROM public.posts
  WHERE id = p_post_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'post_not_found');
  END IF;

  IF v_owner IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_post_owner');
  END IF;

  SELECT id INTO v_existing
  FROM public.featured_content_requests
  WHERE post_id = p_post_id
    AND status IN ('pending_moderation', 'needs_review', 'approved', 'pending_payment', 'scheduled', 'active')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'existing_open_request', 'request_id', v_existing);
  END IF;

  INSERT INTO public.featured_content_requests (
    owner_user_id,
    content_kind,
    post_id,
    feature_kind,
    payment_method,
    status,
    moderation_status,
    banner_label,
    banner_image_url,
    livestream_url,
    livestream_platform,
    duration_hours
  ) VALUES (
    v_uid,
    'post',
    p_post_id,
    p_feature_kind,
    p_payment_method,
    'pending_moderation',
    'pending',
    NULLIF(trim(COALESCE(p_banner_label, '')), ''),
    NULLIF(trim(COALESCE(p_banner_image_url, '')), ''),
    NULLIF(trim(COALESCE(p_livestream_url, '')), ''),
    NULLIF(trim(COALESCE(p_livestream_platform, '')), ''),
    COALESCE(p_duration_hours, 24)
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'status', 'pending_moderation',
    'moderation_status', 'pending'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_featured_event_request(
  p_event_id UUID,
  p_feature_kind TEXT DEFAULT 'event_spotlight',
  p_payment_method TEXT DEFAULT 'props',
  p_duration_hours INTEGER DEFAULT 24,
  p_banner_label TEXT DEFAULT NULL,
  p_banner_image_url TEXT DEFAULT NULL,
  p_livestream_url TEXT DEFAULT NULL,
  p_livestream_platform TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_existing UUID;
  v_request_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_feature_kind NOT IN ('event_spotlight', 'livestream_spotlight') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_feature_kind');
  END IF;

  IF p_payment_method NOT IN ('props', 'iap') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  END IF;

  SELECT organizer_id INTO v_owner
  FROM public.race_events
  WHERE id = p_event_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
  END IF;

  IF v_owner IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_event_owner');
  END IF;

  SELECT id INTO v_existing
  FROM public.featured_content_requests
  WHERE event_id = p_event_id
    AND status IN ('pending_moderation', 'needs_review', 'approved', 'pending_payment', 'scheduled', 'active')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'existing_open_request', 'request_id', v_existing);
  END IF;

  INSERT INTO public.featured_content_requests (
    owner_user_id,
    content_kind,
    event_id,
    feature_kind,
    payment_method,
    status,
    moderation_status,
    banner_label,
    banner_image_url,
    livestream_url,
    livestream_platform,
    duration_hours
  ) VALUES (
    v_uid,
    'event',
    p_event_id,
    p_feature_kind,
    p_payment_method,
    'pending_moderation',
    'pending',
    NULLIF(trim(COALESCE(p_banner_label, '')), ''),
    NULLIF(trim(COALESCE(p_banner_image_url, '')), ''),
    NULLIF(trim(COALESCE(p_livestream_url, '')), ''),
    NULLIF(trim(COALESCE(p_livestream_platform, '')), ''),
    COALESCE(p_duration_hours, 24)
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'status', 'pending_moderation',
    'moderation_status', 'pending'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_featured_content_request(
  p_request_id UUID
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

  UPDATE public.featured_content_requests
  SET status = 'cancelled'
  WHERE id = p_request_id
    AND owner_user_id = v_uid
    AND status IN ('draft', 'pending_moderation', 'needs_review', 'approved', 'pending_payment');

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_featured_content_requests()
RETURNS TABLE (
  request_id UUID,
  owner_user_id UUID,
  owner_username TEXT,
  content_kind TEXT,
  feature_kind TEXT,
  payment_method TEXT,
  status TEXT,
  moderation_status TEXT,
  duration_hours INTEGER,
  banner_label TEXT,
  banner_image_url TEXT,
  livestream_platform TEXT,
  livestream_url TEXT,
  moderation_flags TEXT[],
  moderation_reason TEXT,
  moderation_score NUMERIC,
  created_at TIMESTAMPTZ,
  target_id UUID,
  target_title TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.owner_user_id,
    u.username,
    r.content_kind,
    r.feature_kind,
    r.payment_method,
    r.status,
    r.moderation_status,
    r.duration_hours,
    r.banner_label,
    r.banner_image_url,
    r.livestream_platform,
    r.livestream_url,
    r.moderation_flags,
    r.moderation_reason,
    r.moderation_score,
    r.created_at,
    COALESCE(r.post_id, r.event_id) AS target_id,
    COALESCE(NULLIF(trim(p.caption), ''), e.name, 'Untitled content') AS target_title
  FROM public.featured_content_requests r
  JOIN public.users u ON u.id = r.owner_user_id
  LEFT JOIN public.posts p ON p.id = r.post_id
  LEFT JOIN public.race_events e ON e.id = r.event_id
  WHERE public.is_admin_user(auth.uid())
  ORDER BY
    CASE r.status
      WHEN 'pending_moderation' THEN 0
      WHEN 'needs_review' THEN 1
      WHEN 'pending_payment' THEN 2
      WHEN 'approved' THEN 3
      WHEN 'active' THEN 4
      ELSE 5
    END,
    r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_featured_content_request(
  p_request_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL,
  p_flags TEXT[] DEFAULT NULL,
  p_summary JSONB DEFAULT NULL,
  p_score NUMERIC DEFAULT NULL,
  p_price_cents INTEGER DEFAULT NULL,
  p_props_cost INTEGER DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_status TEXT;
  v_moderation_status TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin_user(v_uid) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_decision NOT IN ('approve', 'reject', 'needs_review') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  v_status := CASE p_decision
    WHEN 'approve' THEN 'pending_payment'
    WHEN 'reject' THEN 'rejected'
    ELSE 'needs_review'
  END;

  v_moderation_status := CASE p_decision
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    ELSE 'needs_review'
  END;

  UPDATE public.featured_content_requests
  SET status = v_status,
      moderation_status = v_moderation_status,
      moderation_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
      moderation_flags = COALESCE(p_flags, moderation_flags),
      moderation_summary = COALESCE(p_summary, moderation_summary),
      moderation_score = COALESCE(p_score, moderation_score),
      price_cents = COALESCE(p_price_cents, price_cents),
      props_cost = COALESCE(p_props_cost, props_cost),
      moderated_at = NOW(),
      moderated_by = v_uid,
      review_notes = NULLIF(trim(COALESCE(p_reason, '')), '')
  WHERE id = p_request_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_featured_content_request(
  p_request_id UUID,
  p_starts_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.featured_content_requests%ROWTYPE;
  v_starts_at TIMESTAMPTZ := COALESCE(p_starts_at, NOW());
  v_ends_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_request
  FROM public.featured_content_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_request.status NOT IN ('approved', 'pending_payment', 'scheduled', 'active') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_request.status);
  END IF;

  v_ends_at := v_starts_at + make_interval(hours => v_request.duration_hours);

  UPDATE public.featured_content_requests
  SET status = 'active',
      starts_at = v_starts_at,
      ends_at = v_ends_at
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'starts_at', v_starts_at, 'ends_at', v_ends_at);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_featured_post_request(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_featured_post_request(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_featured_event_request(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_featured_event_request(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_featured_content_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_featured_content_request(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_featured_content_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_featured_content_requests() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_review_featured_content_request(UUID, TEXT, TEXT, TEXT[], JSONB, NUMERIC, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_featured_content_request(UUID, TEXT, TEXT, TEXT[], JSONB, NUMERIC, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.activate_featured_content_request(UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_featured_content_request(UUID, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_featured_content_requests()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.featured_content_requests
  SET status = 'expired'
  WHERE status = 'active'
    AND ends_at IS NOT NULL
    AND ends_at < NOW();
END;
$$;

CREATE OR REPLACE VIEW public.active_featured_feed_requests AS
SELECT r.*
FROM public.featured_content_requests r
WHERE r.status = 'active'
  AND r.starts_at IS NOT NULL
  AND r.ends_at IS NOT NULL
  AND r.starts_at <= NOW()
  AND r.ends_at > NOW()
ORDER BY r.starts_at DESC, r.created_at DESC;

COMMENT ON TABLE public.featured_content_requests IS
  'Moderation-first queue for featured posts, events, and livestream spotlights. Approval should happen before charging the user or activating feed placement.';

NOTIFY pgrst, 'reload schema';
