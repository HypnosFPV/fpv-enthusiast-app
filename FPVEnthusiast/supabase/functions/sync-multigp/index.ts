// supabase/functions/sync-multigp/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const apiKey = Deno.env.get('MULTIGP_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'MULTIGP_API_KEY not set' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { lat, lng, distance } = await req.json();

    // ── Call MultiGP API ────────────────────────────────────────────────────
    const mgpRes = await fetch('https://www.multigp.com/api/multigp/pull/races/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, latitude: lat, longitude: lng, distance }),
    });

    if (!mgpRes.ok) {
      return new Response(JSON.stringify({ error: 'MultiGP API error', status: mgpRes.status }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    const mgpJson = await mgpRes.json();
    const races: any[] = mgpJson?.data ?? [];

    if (races.length === 0) {
      return new Response(JSON.stringify({ synced: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Upsert into Supabase ────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const rows = races.map((r: any) => ({
      multigp_race_id:      String(r.id),
      name:                 r.name ?? 'MultiGP Race',
      description:          null,
      event_type:           'race',
      event_source:         'multigp',
      latitude:             parseFloat(r.latitude),
      longitude:            parseFloat(r.longitude),
      venue_name:           null,
      city:                 r.city ?? null,
      state:                r.state ?? null,
      country:              r.country ?? 'US',
      start_time:           new Date(r.startDate).toISOString(),
      end_time:             r.endDate ? new Date(r.endDate).toISOString() : null,
      rsvp_count:           parseInt(r.rsvpCount) || 0,
      max_participants:     r.maxPilots ? parseInt(r.maxPilots) : null,
      registration_url:     r.url ?? null,
      multigp_chapter_name: r.chapterName ?? null,
      is_cancelled:         false,
    }));

    const { error } = await supabase
      .from('race_events')
      .upsert(rows, { onConflict: 'multigp_race_id' });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ synced: rows.length }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
