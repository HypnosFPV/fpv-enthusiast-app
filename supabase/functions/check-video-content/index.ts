import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Known OSD labels that are NOT pilot names ──────────────────────────────
const KNOWN_OSD_LABELS = new Set([
  'GPS','RSSI','ALT','SPD','HDG','SAT','BAT','MAH','WP',
  'KM/H','M/S','FT','MPH','KPH','VBAT','CURR','CAP',
  'ARMED','DISARMED','FAILSAFE','ACRO','ANGLE','HORIZON',
  'AIR','MODE','CRAFT','PILOT','NAME',
]);

function looksLikeCallsign(raw: string): boolean {
  const t = raw.trim().toUpperCase();
  if (t.length < 2 || t.length > 30) return false;
  if (/^[\d\s:\.\-\+%°VvAaWwMmGgKk\/]+$/.test(t)) return false;
  if (KNOWN_OSD_LABELS.has(t)) return false;
  if (!/[A-Z]{2,}/.test(t)) return false;
  return true;
}

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

    // Call Google Cloud Vision API — include TEXT_DETECTION for OSD scanning
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
              { type: 'TEXT_DETECTION',        maxResults: 50 },  // ← OSD pilot name detection
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

    // ── Face / person detection ────────────────────────────────────────────
    const faces = result.faceAnnotations ?? [];
    if (faces.length > 0) {
      issues.push(
        `Person or face detected (${faces.length} found). Please ensure no people are visible.`
      );
    }

    // OBJECT_LOCALIZATION backup for person detection
    const objects: any[] = result.localizedObjectAnnotations ?? [];
    const personObjects = objects.filter((o: any) =>
      o.name?.toLowerCase() === 'person' && (o.score ?? 0) > 0.65
    );
    if (personObjects.length > 0 && faces.length === 0) {
      issues.push('Person or rider visible in frame. Please ensure no identifiable people appear.');
    }

    // ── Logo detection ─────────────────────────────────────────────────────
    const logos: any[] = result.logoAnnotations ?? [];
    if (logos.length > 0) {
      const names = logos.map((l: any) => l.description).join(', ');
      issues.push(`Logo or branding detected: ${names}. Remove logos/watermarks before submitting.`);
    }

    // ── Safe search ────────────────────────────────────────────────────────
    const safe = result.safeSearchAnnotation ?? {};
    const flagged = (['adult','violence','racy'] as const).filter(
      (k) => safe[k] === 'LIKELY' || safe[k] === 'VERY_LIKELY'
    );
    if (flagged.length > 0) {
      issues.push(`Content flagged as inappropriate (${flagged.join(', ')}). Not allowed.`);
    }

    // ── OSD Pilot Name / Callsign detection ────────────────────────────────
    // Scans for Betaflight OSD text that looks like a pilot name/callsign.
    // Per contest rules, pilot names in OSD are not permitted and will be
    // automatically blurred — we warn the pilot here so they know.
    const textAnnotations: any[] = result.textAnnotations ?? [];
    const detectedCallsigns: string[] = [];
    for (const ann of textAnnotations.slice(1)) { // skip index 0 (full block)
      const text = ann.description ?? '';
      if (looksLikeCallsign(text)) {
        detectedCallsigns.push(text);
      }
    }
    if (detectedCallsigns.length > 0) {
      const names = [...new Set(detectedCallsigns)].join(', ');
      issues.push(
        `OSD pilot name detected: "${names}". Per contest rules, pilot names must be removed from OSD. ` +
        `Your video will be automatically processed to blur this text — no action needed.`
      );
    }

    // OSD callsigns are auto-blurred (not hard-rejected), so we still approve
    // but include the warning so the pilot is informed.
    const hardRejectionIssues = issues.filter(i => !i.includes('OSD pilot name detected'));
    const approved = hardRejectionIssues.length === 0;

    console.log(`[check-video-content] approved=${approved} issues=${JSON.stringify(issues)}`);

    return new Response(
      JSON.stringify({ approved, issues }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[check-video-content] error:', err);
    return new Response(
      JSON.stringify({ approved: true, issues: [] }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
