// supabase/functions/sync-multigp/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { lat, lng, distance = 500 } = body;

    // ── Load all active chapter connections ──────────────────────────────────
    const { data: connections, error: connError } = await supabase
      .from('multigp_connections')
      .select('id, user_id, api_key, chapter_name')
      .eq('is_active', true);

    if (connError) {
      return new Response(
        JSON.stringify({ error: 'Failed to load connections', detail: connError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!connections || connections.length === 0) {
      return new Response(
        JSON.stringify({ synced: 0, chapters: 0, message: 'No active MultiGP connections' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Loop every connected chapter ─────────────────────────────────────────
    let totalSynced = 0;
    let totalChapters = 0;
    const errors: string[] = [];

    for (const conn of connections) {
      try {
        // Build the search body — use provided lat/lng or fetch globally
        const searchBody: Record<string, any> = { apiKey: conn.api_key };
        if (lat !== undefined && lng !== undefined) {
          searchBody.latitude  = lat;
          searchBody.longitude = lng;
          searchBody.distance  = distance;
        }

        const mgpRes = await fetch(
          'https://www.multigp.com/api/multigp/pull/races/search',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(searchBody),
          },
        );

        if (!mgpRes.ok) {
          errors.push(`Chapter "${conn.chapter_name ?? conn.id}": HTTP ${mgpRes.status}`);
          continue;
        }

        const mgpJson = await mgpRes.json();

        // ── Validate key — MultiGP returns status:false for bad keys ──────────
        if (!mgpJson.status) {
          errors.push(`Chapter "${conn.chapter_name ?? conn.id}": invalid API key`);
          // Mark this connection as inactive so we stop hitting bad keys
          await supabase
            .from('multigp_connections')
            .update({ is_active: false })
            .eq('id', conn.id);
          continue;
        }

        const races: any[] = mgpJson?.data ?? [];
        if (races.length === 0) continue;

        // ── Map to race_events rows ───────────────────────────────────────────
        const rows = races.map((r: any) => ({
          multigp_race_id:      String(r.id),
          name:                 r.name ?? 'MultiGP Race',
          description:          r.description ?? null,
          event_type:           'race',
          event_source:         'multigp',
          latitude:             parseFloat(r.latitude),
          longitude:            parseFloat(r.longitude),
          venue_name:           r.venue ?? null,
          city:                 r.city ?? null,
          state:                r.state ?? null,
          country:              r.country ?? 'US',
          start_time:           new Date(r.startDate).toISOString(),
          end_time:             r.endDate ? new Date(r.endDate).toISOString() : null,
          rsvp_count:           parseInt(r.rsvpCount) || 0,
          max_participants:     r.maxPilots ? parseInt(r.maxPilots) : null,
          registration_url:     r.url ?? null,
          multigp_chapter_name: r.chapterName ?? conn.chapter_name ?? null,
          is_cancelled:         false,
        }));

        // ── Upsert — conflict on multigp_race_id updates existing rows ────────
        const { error: upsertError } = await supabase
          .from('race_events')
          .upsert(rows, { onConflict: 'multigp_race_id' });

        if (upsertError) {
          errors.push(`Chapter "${conn.chapter_name ?? conn.id}": ${upsertError.message}`);
          continue;
        }

        // ── Update last_synced_at for this connection ─────────────────────────
        await supabase
          .from('multigp_connections')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', conn.id);

        totalSynced += rows.length;
        totalChapters++;

      } catch (chapterErr) {
        errors.push(`Chapter "${conn.chapter_name ?? conn.id}": ${String(chapterErr)}`);
      }
    }

    // ── Final response ────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        synced:   totalSynced,
        chapters: totalChapters,
        errors:   errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
