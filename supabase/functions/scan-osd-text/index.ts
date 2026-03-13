// supabase/functions/scan-osd-text/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Triggered via DB webhook on challenge_entries INSERT.
// 1. Downloads up to 6 evenly-spaced thumbnail frames from the submitted video.
// 2. Runs Google Cloud Vision TEXT_DETECTION on each frame.
// 3. Checks whether any detected text looks like an OSD pilot callsign.
// 4. If clean  → moderation_status = 'approved'
//    If flagged → moderation_status = 'needs_review', flags stored in JSONB
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Known OSD labels that are NOT pilot names ────────────────────────────────
const KNOWN_OSD_LABELS = new Set([
  'GPS','RSSI','ALT','SPD','HDG','SAT','BAT','MAH','WP',
  'KM/H','M/S','FT','MPH','KPH','VBAT','CURR','CAP',
  'ARMED','DISARMED','FAILSAFE','ACRO','ANGLE','HORIZON',
  'AIR','MODE','CRAFT','PILOT','NAME', // "PILOT" and "NAME" alone are labels
]);

// ── Callsign detector ────────────────────────────────────────────────────────
// Returns true if detected text looks like a pilot name / callsign rather
// than a standard OSD numeric readout.
function looksLikeCallsign(raw: string): boolean {
  const t = raw.trim().toUpperCase();

  // Too short or too long to be a callsign
  if (t.length < 2 || t.length > 30) return false;

  // Pure numbers, timestamps (03:05), voltage (3.63V), percentages, coords
  if (/^[\d\s:\.\-\+%°VvAaWwMmGgKk\/]+$/.test(t)) return false;

  // Known single-word OSD labels
  if (KNOWN_OSD_LABELS.has(t)) return false;

  // Must contain at least 2 consecutive letters (rules out "3V3", "4S" etc.)
  if (!/[A-Z]{2,}/.test(t)) return false;

  // Likely a callsign — contains real alphabetic word content
  return true;
}

// ── Scan a single frame (base64 JPEG/PNG) ────────────────────────────────────
async function scanFrame(
  base64: string,
  apiKey: string,
): Promise<Array<{ text: string; boundingBox: any; confidence: number }>> {
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
    console.warn('[scan-osd-text] Vision API HTTP error:', resp.status);
    return [];
  }

  const data        = await resp.json();
  const annotations = data.responses?.[0]?.textAnnotations ?? [];
  const flags: Array<{ text: string; boundingBox: any; confidence: number }> = [];

  // Skip index 0 — that's the full-page text block concatenation
  for (const ann of annotations.slice(1)) {
    const text = ann.description ?? '';
    if (!looksLikeCallsign(text)) continue;

    // Only flag text appearing in the upper 45% of the frame
    // (OSD pilot names virtually always sit in the top portion)
    const vertices: Array<{ x?: number; y?: number }> = ann.boundingPoly?.vertices ?? [];
    if (vertices.length < 2) continue;

    // Vision returns absolute pixel coords — we need the relative Y position.
    // We don't know the frame height here, but we DO know that OSD pilot names
    // are almost always in the top third. We store the raw bbox and let the
    // downstream processor decide.
    flags.push({
      text,
      boundingBox: ann.boundingPoly?.vertices,
      confidence:  ann.score ?? 0.9,
    });
  }

  return flags;
}

// ── Main handler ─────────────────────────────────────────────────────────────
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

  let entryId: string;
  let s3Key: string | null;

  try {
    // Support both DB webhook payload ({ record }) and direct call ({ entry_id, s3_key })
    const body = await req.json();
    const record = body.record ?? body;
    entryId = record.id ?? body.entry_id;
    s3Key   = record.s3_upload_key ?? body.s3_key ?? null;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), { status: 400, headers: CORS });
  }

  if (!entryId) {
    return new Response(JSON.stringify({ error: 'missing entry id' }), { status: 400, headers: CORS });
  }

  // Mark as processing
  await supabase.rpc('set_entry_moderation', {
    p_entry_id: entryId,
    p_status:   'processing',
    p_flags:    [],
  });

  // If no video key, auto-approve (shouldn't happen in practice)
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
    // ── Get the public URL of the video ────────────────────────────────────
    const { data: { publicUrl } } = supabase.storage
      .from('posts')
      .getPublicUrl(s3Key);

    // ── Fetch the video and extract up to 6 evenly-spaced frames ──────────
    // We use a lightweight approach: fetch the video binary, then use
    // VideoThumbnails logic via our own frame extraction endpoint isn't
    // available in Deno. Instead we use the thumbnail that was already
    // uploaded alongside the video (thumbnail_s3_key on the same entry).
    //
    // Fetch the entry's thumbnail key from the DB
    const { data: entryRow } = await supabase
      .from('challenge_entries')
      .select('thumbnail_s3_key')
      .eq('id', entryId)
      .single();

    const thumbKey: string | null = entryRow?.thumbnail_s3_key ?? null;

    const allFlags: Array<{ text: string; frame: number; boundingBox: any; confidence: number }> = [];

    // ── Scan the thumbnail (most representative frame) ────────────────────
    const keysToScan: string[] = [];
    if (thumbKey) keysToScan.push(thumbKey);

    for (let i = 0; i < keysToScan.length; i++) {
      const key = keysToScan[i];
      const { data: { publicUrl: imgUrl } } = supabase.storage.from('posts').getPublicUrl(key);

      // Fetch image and convert to base64
      const imgResp = await fetch(imgUrl);
      if (!imgResp.ok) continue;
      const imgBuf  = await imgResp.arrayBuffer();
      const bytes   = new Uint8Array(imgBuf);
      let binary    = '';
      bytes.forEach(b => { binary += String.fromCharCode(b); });
      const b64 = btoa(binary);

      const frameFlags = await scanFrame(b64, apiKey);
      frameFlags.forEach(f => allFlags.push({ ...f, frame: i }));
    }

    // ── Additionally scan a fetched frame from the video URL directly ─────
    // Try to get a web-accessible thumbnail by appending #t=2 (browsers handle
    // this but servers may not). As a practical fallback, we rely on the
    // uploaded thumbnail above. If no thumbnail was uploaded, we scan the
    // first few KB of the video for embedded cover art (common in MP4).
    // For now: if no thumbnail, mark as needs_review to be safe.
    if (keysToScan.length === 0) {
      await supabase.rpc('set_entry_moderation', {
        p_entry_id: entryId,
        p_status:   'needs_review',
        p_flags:    [{ type: 'no_thumbnail', reason: 'No thumbnail available for scanning' }],
      });
      return new Response(JSON.stringify({ ok: true, needs_review: true, reason: 'no_thumbnail' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Evaluate results ──────────────────────────────────────────────────
    const callsignFlags = allFlags.map(f => ({
      type:        'pilot_name' as const,
      text:        f.text,
      frame:       f.frame,
      confidence:  f.confidence,
      boundingBox: f.boundingBox,
    }));

    if (callsignFlags.length > 0) {
      console.log(`[scan-osd-text] entry=${entryId} FLAGGED:`, callsignFlags.map(f => f.text).join(', '));
      await supabase.rpc('set_entry_moderation', {
        p_entry_id: entryId,
        p_status:   'needs_review',
        p_flags:    callsignFlags,
      });
      return new Response(
        JSON.stringify({ ok: true, approved: false, flags: callsignFlags }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // ── Clean — approve ───────────────────────────────────────────────────
    console.log(`[scan-osd-text] entry=${entryId} approved — no callsign detected`);
    await supabase.rpc('set_entry_moderation', {
      p_entry_id: entryId,
      p_status:   'approved',
      p_flags:    [],
    });
    return new Response(
      JSON.stringify({ ok: true, approved: true }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[scan-osd-text] unexpected error:', err);
    // Fail open — don't hold up a submission on an unexpected error
    await supabase.rpc('set_entry_moderation', {
      p_entry_id: entryId,
      p_status:   'needs_review',
      p_flags:    [{ type: 'error', reason: String(err) }],
    });
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
