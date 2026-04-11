import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ModerationDecision = 'approve' | 'needs_review' | 'reject';

type FeaturedRequestRow = {
  id: string;
  owner_user_id: string;
  content_kind: 'post' | 'event';
  post_id: string | null;
  event_id: string | null;
  feature_kind: 'post_spotlight' | 'event_spotlight' | 'livestream_spotlight';
  status: string;
  moderation_status: string;
  banner_label: string | null;
  banner_image_url: string | null;
  livestream_url: string | null;
  livestream_platform: string | null;
  duration_hours: number;
};

type PostRow = {
  id: string;
  caption: string | null;
  media_type: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
};

type EventRow = {
  id: string;
  name: string | null;
  description: string | null;
  venue_name: string | null;
  city: string | null;
  state: string | null;
  registration_url: string | null;
  start_time: string | null;
};

type HeuristicResult = {
  provider: 'heuristic';
  decision: ModerationDecision;
  flags: string[];
  reason: string | null;
  score: number;
  matchedTerms: string[];
};

type OpenAIModerationResult = {
  provider: 'openai';
  decision: ModerationDecision;
  flags: string[];
  reason: string | null;
  score: number;
  flagged: boolean;
  categories: string[];
  raw: Record<string, unknown> | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function log(stage: string, payload: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ fn: 'moderate-featured-content', stage, ...payload }));
}

const HARD_BLOCK_TERMS = [
  'onlyfans',
  'sex tape',
  'porn',
  'xxx',
  'nudes',
  'nude pics',
  'beheading',
  'gore',
  'swastika',
  'kkk',
  'buy cocaine',
  'buy meth',
  'buy fentanyl',
  'escort service',
  'counterfeit',
  'fake id',
];

const REVIEW_TERMS = [
  'adult',
  '18+',
  'nsfw',
  'betting',
  'gambling',
  'raffle',
  'cash app only',
  'venmo only',
  'telegram',
  'dm for price',
  'guaranteed return',
  'double your money',
  'violent',
  'blood',
  'weed',
  'cannabis',
];

function normalizeText(parts: Array<string | null | undefined>) {
  return parts
    .map(part => (typeof part === 'string' ? part.trim().toLowerCase() : ''))
    .filter(Boolean)
    .join('\n');
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeDecision(a: ModerationDecision, b: ModerationDecision): ModerationDecision {
  const rank = { approve: 0, needs_review: 1, reject: 2 } as const;
  return rank[b] > rank[a] ? b : a;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.9999, value));
}

function containsTerm(haystack: string, term: string) {
  return haystack.includes(term.toLowerCase());
}

function runHeuristics(text: string): HeuristicResult {
  const hardMatches = HARD_BLOCK_TERMS.filter(term => containsTerm(text, term));
  const reviewMatches = REVIEW_TERMS.filter(term => containsTerm(text, term));

  if (hardMatches.length > 0) {
    return {
      provider: 'heuristic',
      decision: 'reject',
      flags: uniq(hardMatches.map(term => `text:${term.replace(/\s+/g, '_')}`)),
      reason: 'Featured request matched blocked premium-placement keywords.',
      score: 0.99,
      matchedTerms: hardMatches,
    };
  }

  if (reviewMatches.length > 0) {
    return {
      provider: 'heuristic',
      decision: 'needs_review',
      flags: uniq(reviewMatches.map(term => `review:${term.replace(/\s+/g, '_')}`)),
      reason: 'Featured request contains terms that require manual review.',
      score: 0.72,
      matchedTerms: reviewMatches,
    };
  }

  return {
    provider: 'heuristic',
    decision: 'approve',
    flags: [],
    reason: null,
    score: 0.04,
    matchedTerms: [],
  };
}

function mapOpenAICategoryToDecision(category: string, score: number): ModerationDecision {
  if (
    category.includes('sexual/minors') ||
    category.includes('sexual') ||
    category.includes('hate') ||
    category.includes('violence/graphic') ||
    category.includes('illicit/violent')
  ) {
    return score >= 0.55 ? 'reject' : 'needs_review';
  }

  if (
    category.includes('violence') ||
    category.includes('harassment') ||
    category.includes('self-harm') ||
    category.includes('illicit')
  ) {
    return 'needs_review';
  }

  return score >= 0.75 ? 'needs_review' : 'approve';
}

async function runOpenAITextModeration(apiKey: string, text: string): Promise<OpenAIModerationResult> {
  const response = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'omni-moderation-latest',
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI moderation failed (${response.status}): ${errorText || 'unknown error'}`);
  }

  const payload = await response.json();
  const result = Array.isArray(payload?.results) ? payload.results[0] : null;
  const categoriesObj = (result?.categories ?? {}) as Record<string, boolean>;
  const scoresObj = (result?.category_scores ?? {}) as Record<string, number>;
  const trueCategories = Object.entries(categoriesObj)
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  const maxScore = clampScore(
    Math.max(
      0,
      ...Object.values(scoresObj)
        .map(value => Number(value))
        .filter(value => Number.isFinite(value)),
    ),
  );

  let decision: ModerationDecision = 'approve';
  for (const category of trueCategories) {
    decision = mergeDecision(decision, mapOpenAICategoryToDecision(category, Number(scoresObj[category] ?? 0)));
  }

  return {
    provider: 'openai',
    decision,
    flags: uniq(trueCategories.map(category => `openai:${category.replace(/\//g, '_')}`)),
    reason: trueCategories.length > 0 ? 'AI moderation flagged one or more safety categories.' : null,
    score: maxScore,
    flagged: !!result?.flagged,
    categories: trueCategories,
    raw: payload as Record<string, unknown>,
  };
}

function coerceString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildContentText(request: FeaturedRequestRow, post: PostRow | null, event: EventRow | null) {
  const location = event
    ? [event.venue_name, event.city, event.state].filter(Boolean).join(', ')
    : '';

  return normalizeText([
    request.feature_kind,
    request.banner_label,
    request.livestream_platform,
    request.livestream_url,
    post?.caption,
    event?.name,
    event?.description,
    event?.registration_url,
    location,
  ]);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  const requestTraceId = crypto.randomUUID();

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

    if (!token) {
      return json({ ok: false, error: 'Unauthorized', requestId: requestTraceId }, 401);
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ ok: false, error: 'Missing Supabase env', requestId: requestTraceId }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: authErr,
    } = await admin.auth.getUser(token);

    if (authErr || !user) {
      log('auth_failed', { requestTraceId, error: authErr?.message ?? 'no_user' });
      return json({ ok: false, error: 'Unauthorized', requestId: requestTraceId }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const requestId = coerceString(body?.requestId);

    if (!requestId) {
      return json({ ok: false, error: 'requestId is required', requestId: requestTraceId }, 400);
    }

    const { data: requestRow, error: requestErr } = await admin
      .from('featured_content_requests')
      .select('id, owner_user_id, content_kind, post_id, event_id, feature_kind, status, moderation_status, banner_label, banner_image_url, livestream_url, livestream_platform, duration_hours')
      .eq('id', requestId)
      .maybeSingle();

    if (requestErr || !requestRow) {
      return json({ ok: false, error: requestErr?.message ?? 'Request not found', requestId: requestTraceId }, 404);
    }

    const { data: requesterProfile } = await admin
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    const isOwner = requestRow.owner_user_id === user.id;
    const isAdmin = requesterProfile?.is_admin === true;
    if (!isOwner && !isAdmin) {
      return json({ ok: false, error: 'Forbidden', requestId: requestTraceId }, 403);
    }

    if (!['pending_moderation', 'needs_review'].includes(requestRow.status)) {
      return json({
        ok: false,
        error: 'Request is not in a moderatable state',
        status: requestRow.status,
        requestId: requestTraceId,
      }, 409);
    }

    let post: PostRow | null = null;
    let event: EventRow | null = null;

    if (requestRow.content_kind === 'post' && requestRow.post_id) {
      const { data } = await admin
        .from('posts')
        .select('id, caption, media_type, media_url, thumbnail_url')
        .eq('id', requestRow.post_id)
        .maybeSingle();
      post = (data ?? null) as PostRow | null;
    }

    if (requestRow.content_kind === 'event' && requestRow.event_id) {
      const { data } = await admin
        .from('race_events')
        .select('id, name, description, venue_name, city, state, registration_url, start_time')
        .eq('id', requestRow.event_id)
        .maybeSingle();
      event = (data ?? null) as EventRow | null;
    }

    const contentText = buildContentText(requestRow as FeaturedRequestRow, post, event);
    const heuristic = runHeuristics(contentText);

    let providerNames = ['heuristic'];
    let decision: ModerationDecision = heuristic.decision;
    let flags = [...heuristic.flags];
    let reason = heuristic.reason;
    let score = heuristic.score;
    let openai: OpenAIModerationResult | null = null;

    if (openAiApiKey && contentText) {
      try {
        openai = await runOpenAITextModeration(openAiApiKey, contentText);
        providerNames.push('openai');
        decision = mergeDecision(decision, openai.decision);
        flags = uniq([...flags, ...openai.flags]);
        score = Math.max(score, openai.score);
        if (!reason && openai.reason) {
          reason = openai.reason;
        }
      } catch (error) {
        flags = uniq([...flags, 'openai:error']);
        decision = mergeDecision(decision, 'needs_review');
        score = Math.max(score, 0.5);
        reason = 'Automatic moderation provider errored, manual review required.';
        log('openai_error', {
          requestTraceId,
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const hasBannerMedia = !!requestRow.banner_image_url;
    const hasPostMedia = !!post?.media_url || !!post?.thumbnail_url;
    const hasLivestream = requestRow.feature_kind === 'livestream_spotlight' || !!requestRow.livestream_url;

    if ((hasBannerMedia || hasPostMedia) && decision === 'approve') {
      decision = 'needs_review';
      flags = uniq([...flags, 'media:manual_review_required']);
      score = Math.max(score, 0.45);
      reason = 'Media-bearing featured content still requires manual image/video review before approval.';
    }

    if (hasLivestream && decision === 'approve') {
      decision = 'needs_review';
      flags = uniq([...flags, 'livestream:manual_review_required']);
      score = Math.max(score, 0.46);
      reason = 'Livestream spotlights require manual review before activation.';
    }

    const nextStatus = decision === 'approve'
      ? 'pending_payment'
      : decision === 'reject'
        ? 'rejected'
        : 'needs_review';
    const nextModerationStatus = decision === 'approve'
      ? 'approved'
      : decision === 'reject'
        ? 'rejected'
        : 'needs_review';

    const moderationSummary = {
      request_trace_id: requestTraceId,
      scanned_at: new Date().toISOString(),
      content_kind: requestRow.content_kind,
      feature_kind: requestRow.feature_kind,
      content_text_length: contentText.length,
      has_banner_media: hasBannerMedia,
      has_post_media: hasPostMedia,
      has_livestream: hasLivestream,
      heuristic: {
        decision: heuristic.decision,
        score: heuristic.score,
        matched_terms: heuristic.matchedTerms,
      },
      openai: openai
        ? {
            decision: openai.decision,
            score: openai.score,
            categories: openai.categories,
            flagged: openai.flagged,
          }
        : null,
      final_decision: decision,
    };

    const { error: updateErr } = await admin
      .from('featured_content_requests')
      .update({
        status: nextStatus,
        moderation_status: nextModerationStatus,
        moderation_provider: providerNames.join('+'),
        moderation_summary: moderationSummary,
        moderation_flags: flags,
        moderation_reason: reason,
        moderation_score: clampScore(score),
        moderated_at: new Date().toISOString(),
        review_notes: decision === 'approve' ? null : reason,
      })
      .eq('id', requestId);

    if (updateErr) {
      return json({ ok: false, error: updateErr.message, requestId: requestTraceId }, 500);
    }

    log('success', {
      requestTraceId,
      requestId,
      userId: user.id,
      decision,
      status: nextStatus,
      flagsCount: flags.length,
      usedOpenAI: providerNames.includes('openai'),
    });

    return json({
      ok: true,
      requestId: requestTraceId,
      featuredRequestId: requestId,
      decision,
      status: nextStatus,
      moderationStatus: nextModerationStatus,
      flags,
      provider: providerNames.join('+'),
    });
  } catch (error) {
    log('fatal_error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
    });
    return json({ ok: false, error: error instanceof Error ? error.message : String(error), requestId: requestTraceId }, 500);
  }
});
