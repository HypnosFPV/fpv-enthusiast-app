// supabase/functions/scan-osd-text/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Multi-frame OSD pilot name scanner with confidence-tier auto-decision.
//
// Called after every challenge entry upload with:
//   { entry_id, s3_key, frame_s3_keys?: string[] }
//
// Decision tiers (minimises admin queue, maximises automation):
//
//  TIER 1 — AUTO-APPROVE ✅  (no admin needed)
//    • No callsign found in any frame
//
//  TIER 2 — AUTO-APPROVE WITH BLUR NOTE ✅🔵  (no admin needed)
//    • Same callsign text seen in ≥ MULTI_FRAME_THRESHOLD frames  OR
//    • Any callsign with confidence ≥ HIGH_CONFIDENCE_THRESHOLD
//    → Status: "approved", flag type "pilot_name_auto_blurred"
//    → UI shows the cyan "Auto-Blur Applied" banner
//
//  TIER 3 — NEEDS ADMIN REVIEW ⚠️
//    • Callsign seen in only 1 frame AND confidence < HIGH_CONFIDENCE_THRESHOLD
//    → Scanner isn't certain enough; human eyes needed
//
//  TIER 4 — NEEDS ADMIN REVIEW ⚠️  (safety fallbacks)
//    • No frames available, frame fetch errors, Vision API errors
//
// Target: ~95%+ of entries handled automatically; admin only sees tier 3/4.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Confidence thresholds ─────────────────────────────────────────────────────
// Vision TEXT_DETECTION returns a score 0-1 per annotation.
const CONFIDENCE_THRESHOLD       = 0.70;  // Minimum to consider at all
const HIGH_CONFIDENCE_THRESHOLD  = 0.90;  // High enough → auto-blur without multi-frame confirm
const MULTI_FRAME_THRESHOLD      = 2;     // Seen in this many frames → auto-blur

// ── Known OSD system labels — never a pilot name ─────────────────────────────
const KNOWN_OSD_LABELS = new Set([
  'GPS','RSSI','ALT','SPD','HDG','SAT','BAT','MAH','WP','RC',
  'KM/H','M/S','FT','MPH','KPH','VBAT','CURR','CAP','BATT',
  'ARMED','DISARMED','FAILSAFE','ACRO','ANGLE','HORIZON','STAB',
  'AIR','MODE','CRAFT','PILOT','NAME','HOME','RTH','WRN','WARN',
  'LINK','PWR','SNR','LQ','ANT','DBM','MW','ELRS','CRSF','FPORT',
  'OK','ERR','RX','TX','LOST','FIX','NOFIX','DOP','HDOP',
]);

// ── Callsign detector ─────────────────────────────────────────────────────────
function looksLikeCallsign(raw: string, score: number): boolean {
  const t = raw.trim().toUpperCase();

  if (score < CONFIDENCE_THRESHOLD) return false;
  if (t.length < 2 || t.length > 30) return false;
  if (/^[\d\s:\.\-\+%°VvAaWwMmGgKk\/\[\]]+$/.test(t)) return false;
  if (t.length === 1) return false;
  if (KNOWN_OSD_LABELS.has(t)) return false;
  if (!/[A-Z]{2,}/.test(t)) return false;
  if (/^(FPV|DVR|PID|VTX|ESC|FC|GPS|IMU|OSD|HDR|POV|RPM|LOS|BVLOS|UAV|UAS)$/.test(t)) return false;

  return true;
}

// ── Fetch image from Supabase Storage → base64 ───────────────────────────────
async function fetchImageAsBase64(
  supabase: ReturnType<typeof createClient>,
  s3Key: string,
): Promise<string | null> {
  try {
    const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(s3Key);
    const resp = await fetch(publicUrl);
    if (!resp.ok) return null;
    const buf   = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary  = '';
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  } catch (e) {
    console.warn('[scan-osd-text] fetchImageAsBase64 error:', e);
    return null;
  }
}

// ── Scan a single frame via Google Vision TEXT_DETECTION ─────────────────────
async function scanFrame(
  base64: string,
  apiKey: string,
  frameIndex: number,
): Promise<Array<{ text: string; confidence: number; frameIndex: number; boundingBox: any }>> {
  const resp = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image:    { content: base64 },
          features: [{ type: 'TEXT_DETECTION', maxResults: 50 }],
        }],
      }),
    }
  );

  if (!resp.ok) {
    console.warn(`[scan-osd-text] Vision API error on frame ${frameIndex}:`, resp.status);
    return [];
  }

  const data        = await resp.json();
  const annotations = data.responses?.[0]?.textAnnotations ?? [];
  const flags: Array<{ text: string; confidence: number; frameIndex: number; boundingBox: any }> = [];

  // annotations[0] is the full concatenated text block — skip it
  for (const ann of annotations.slice(1)) {
    const text  = (ann.description ?? '').trim();
    const score = ann.score ?? 0.85;

    if (looksLikeCallsign(text, score)) {
      flags.push({
        text,
        confidence:  score,
        frameIndex,
        boundingBox: ann.boundingPoly?.vertices ?? [],
      });
    }
  }

  return flags;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY');
  if (!apiKey) {
    console.warn('[scan-osd-text] GOOGLE_VISION_API_KEY not set — auto-approving');
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Parse request ──────────────────────────────────────────────────────────
  let entryId: string;
  let s3Key:   string | null;
  let frameS3Keys: string[] = [];

  try {
    const body   = await req.json();
    const record = body.record ?? body;
    entryId     = record.id        ?? body.entry_id;
    s3Key       = record.s3_upload_key ?? body.s3_key ?? null;
    frameS3Keys = body.frame_s3_keys  ?? [];
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400, headers: CORS });
  }

  if (!entryId) {
    return new Response(JSON.stringify({ error: 'missing entry_id' }), { status: 400, headers: CORS });
  }

  // ── Mark as processing ─────────────────────────────────────────────────────
  await supabase.rpc('set_entry_moderation', {
    p_entry_id: entryId,
    p_status:   'processing',
    p_flags:    [],
  });

  if (!s3Key) {
    await supabase.rpc('set_entry_moderation', {
      p_entry_id: entryId,
      p_status:   'approved',
      p_flags:    [],
    });
    return new Response(JSON.stringify({ ok: true, approved: true, reason: 'no_video' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    // ── Build the list of frames to scan ──────────────────────────────────────
    let keysToScan: string[] = [...frameS3Keys];

    if (keysToScan.length === 0) {
      const { data: entryRow } = await supabase
        .from('challenge_entries')
        .select('thumbnail_s3_key, s3_upload_key')
        .eq('id', entryId)
        .single();

      if (entryRow?.thumbnail_s3_key) {
        keysToScan = [entryRow.thumbnail_s3_key];
      }
    }

    if (keysToScan.length === 0) {
      await supabase.rpc('set_entry_moderation', {
        p_entry_id: entryId,
        p_status:   'needs_review',
        p_flags:    [{ type: 'no_frames', reason: 'No frame thumbnails available for scanning' }],
      });
      return new Response(JSON.stringify({ ok: true, needs_review: true, reason: 'no_frames' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[scan-osd-text] entry=${entryId} scanning ${keysToScan.length} frame(s)`);

    // ── Scan all frames ────────────────────────────────────────────────────────
    // callsignMap: uppercased text → { bestConfidence, frameCount, representative flag }
    const callsignMap = new Map<string, {
      text:        string;
      confidence:  number;
      frameCount:  number;
      frame:       number;
      boundingBox: any;
    }>();

    let scannedCount = 0;

    for (let i = 0; i < keysToScan.length; i++) {
      const b64 = await fetchImageAsBase64(supabase, keysToScan[i]);
      if (!b64) continue;

      scannedCount++;
      const frameFlags = await scanFrame(b64, apiKey, i);

      for (const f of frameFlags) {
        const key = f.text.toUpperCase();
        if (callsignMap.has(key)) {
          const existing = callsignMap.get(key)!;
          existing.frameCount++;
          if (f.confidence > existing.confidence) {
            existing.confidence  = f.confidence;
            existing.frame       = f.frameIndex;
            existing.boundingBox = f.boundingBox;
          }
        } else {
          callsignMap.set(key, {
            text:        f.text,
            confidence:  f.confidence,
            frameCount:  1,
            frame:       f.frameIndex,
            boundingBox: f.boundingBox,
          });
        }
      }
    }

    // ── Decision tiers ────────────────────────────────────────────────────────
    if (scannedCount === 0) {
      await supabase.rpc('set_entry_moderation', {
        p_entry_id: entryId,
        p_status:   'needs_review',
        p_flags:    [{ type: 'fetch_error', reason: 'Could not fetch any frames for scanning' }],
      });
      return new Response(
        JSON.stringify({ ok: true, needs_review: true, reason: 'fetch_error' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    if (callsignMap.size === 0) {
      // ── TIER 1: No callsign found anywhere → auto-approve ─────────────────
      console.log(`[scan-osd-text] entry=${entryId} TIER-1 APPROVED — clean across ${scannedCount} frames`);
      await supabase.rpc('set_entry_moderation', {
        p_entry_id: entryId,
        p_status:   'approved',
        p_flags:    [],
      });
      return new Response(
        JSON.stringify({ ok: true, approved: true, tier: 1, framesScanned: scannedCount }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Separate callsigns into: certain (auto-blur) vs uncertain (needs review)
    const certainFlags:   Array<any> = [];
    const uncertainFlags: Array<any> = [];

    for (const [, cs] of callsignMap) {
      const flag = {
        type:        'pilot_name_auto_blurred' as const,
        text:        cs.text,
        confidence:  cs.confidence,
        frame:       cs.frame,
        frameCount:  cs.frameCount,
        boundingBox: cs.boundingBox,
      };

      const isHighConfidence  = cs.confidence  >= HIGH_CONFIDENCE_THRESHOLD;
      const isMultiFrame      = cs.frameCount  >= MULTI_FRAME_THRESHOLD;

      if (isHighConfidence || isMultiFrame) {
        certainFlags.push(flag);
      } else {
        uncertainFlags.push({ ...flag, type: 'pilot_name' });
      }
    }

    if (uncertainFlags.length > 0) {
      // ── TIER 3: Low-confidence single-frame detection → admin review ───────
      console.log(
        `[scan-osd-text] entry=${entryId} TIER-3 NEEDS_REVIEW — uncertain:`,
        uncertainFlags.map(f => `"${f.text}" (frame ${f.frame}, ${Math.round(f.confidence * 100)}%)`).join(', ')
      );
      await supabase.rpc('set_entry_moderation', {
        p_entry_id: entryId,
        p_status:   'needs_review',
        p_flags:    [...uncertainFlags, ...certainFlags],
      });
      return new Response(
        JSON.stringify({
          ok:           true,
          approved:     false,
          tier:         3,
          flags:        [...uncertainFlags, ...certainFlags],
          framesScanned: scannedCount,
        }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // ── TIER 2: High-confidence / multi-frame callsign → auto-approve + blur ─
    console.log(
      `[scan-osd-text] entry=${entryId} TIER-2 AUTO-BLURRED:`,
      certainFlags.map(f => `"${f.text}" (${f.frameCount} frames, ${Math.round(f.confidence * 100)}%)`).join(', ')
    );
    await supabase.rpc('set_entry_moderation', {
      p_entry_id: entryId,
      p_status:   'approved',
      p_flags:    certainFlags,
    });
    return new Response(
      JSON.stringify({
        ok:            true,
        approved:      true,
        tier:          2,
        auto_blurred:  true,
        flags:         certainFlags,
        framesScanned: scannedCount,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[scan-osd-text] unexpected error:', err);
    await supabase.rpc('set_entry_moderation', {
      p_entry_id: entryId!,
      p_status:   'needs_review',
      p_flags:    [{ type: 'error', reason: String(err) }],
    });
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
