import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const { thumbnailBase64 } = await req.json();
    if (!thumbnailBase64) {
      return new Response(JSON.stringify({ approved: true, issues: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY');
    if (!apiKey) {
      console.warn('GOOGLE_VISION_API_KEY not set — skipping check');
      return new Response(JSON.stringify({ approved: true, issues: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Call Google Cloud Vision API
    const visionResp = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: thumbnailBase64 },
            features: [
              { type: 'FACE_DETECTION',       maxResults: 10 },
              { type: 'LOGO_DETECTION',        maxResults: 10 },
              { type: 'SAFE_SEARCH_DETECTION'              },
              { type: 'OBJECT_LOCALIZATION',   maxResults: 20 },
            ],
          }],
        }),
      }
    );

    if (!visionResp.ok) {
      console.error('Vision API error:', await visionResp.text());
      return new Response(JSON.stringify({ approved: true, issues: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const visionData = await visionResp.json();
    const result     = visionData.responses?.[0] ?? {};

    const issues: string[] = [];

    // ── Face / person detection ──────────────────────────────────────────
    const faces = result.faceAnnotations ?? [];
    if (faces.length > 0) {
      issues.push(
        `Person or face detected (${faces.length} found). Please ensure no people are visible.`
      );
    }

    // Check OBJECT_LOCALIZATION for 'Person' objects as backup
    const objects: any[] = result.localizedObjectAnnotations ?? [];
    const personObjects = objects.filter((o: any) =>
      o.name?.toLowerCase() === 'person' && (o.score ?? 0) > 0.65
    );
    if (personObjects.length > 0 && faces.length === 0) {
      issues.push('Person or rider visible in frame. Please ensure no identifiable people appear.');
    }

    // ── Logo detection ───────────────────────────────────────────────────
    const logos: any[] = result.logoAnnotations ?? [];
    if (logos.length > 0) {
      const names = logos.map((l: any) => l.description).join(', ');
      issues.push(`Logo or branding detected: ${names}. Remove logos/watermarks before submitting.`);
    }

    // ── Safe search (adult / violent content) ────────────────────────────
    const safe = result.safeSearchAnnotation ?? {};
    const flagged = (['adult','violence','racy'] as const).filter(
      (k) => safe[k] === 'LIKELY' || safe[k] === 'VERY_LIKELY'
    );
    if (flagged.length > 0) {
      issues.push(`Content flagged as inappropriate (${flagged.join(', ')}). Not allowed.`);
    }

    const approved = issues.length === 0;

    console.log(`[check-video-content] approved=${approved} issues=${JSON.stringify(issues)}`);

    return new Response(
      JSON.stringify({ approved, issues }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[check-video-content] error:', err);
    // Fail open — don't block submission on unexpected errors
    return new Response(
      JSON.stringify({ approved: true, issues: [] }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
