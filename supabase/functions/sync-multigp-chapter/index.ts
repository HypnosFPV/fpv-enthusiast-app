// supabase/functions/sync-multigp-chapter/index.ts
// Chapter owner: pull all scheduled races for a specific MultiGP chapter
// and upsert them into the race_events table.
//
// Deploy: supabase functions deploy sync-multigp-chapter
//
// Called by map.tsx → useMap.ts → syncChapterRaces(chapterId)
// Body: { chapter_id: string }  (e.g. "atl-fpv")

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { chapter_id } = await req.json() as { chapter_id?: string };
    if (!chapter_id?.trim()) {
      return new Response(JSON.stringify({ error: 'chapter_id is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const MGP_API_KEY = Deno.env.get('MULTIGP_API_KEY');
    if (!MGP_API_KEY) {
      return new Response(JSON.stringify({ synced: 0, message: 'MULTIGP_API_KEY not set' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const chapterId = chapter_id.trim().toLowerCase();

    // ── 1. Fetch chapter details (to get geocoords of chapter home) ──────────
    const chapterRes = await fetch(
      `https://www.multigp.com/mgp/multigpwebservice/chapter/get?apiKey=${MGP_API_KEY}&chapterName=${encodeURIComponent(chapterId)}`,
    );
    const chapterJson = await chapterRes.json().catch(() => ({}));
    const chapterData = chapterJson?.data ?? chapterJson;

    // ── 2. Fetch upcoming races for the chapter ──────────────────────────────
    const racesRes = await fetch(
      `https://www.multigp.com/mgp/multigpwebservice/race/listForChapter?apiKey=${MGP_API_KEY}&chapterName=${encodeURIComponent(chapterId)}&status=2`,
    );
    const racesJson = await racesRes.json().catch(() => ({ data: [] }));
    const races: any[] = racesJson?.data ?? [];

    if (!races.length) {
      return new Response(JSON.stringify({ synced: 0, message: 'No upcoming races found for chapter' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. Upsert into Supabase ──────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const chapterName: string = chapterData?.name ?? chapterId;
    const rows = races
      .filter((r: any) => r.startDate && r.latitude && r.longitude)
      .map((r: any) => ({
        name:                r.name ?? 'MultiGP Race',
        description:         r.description ?? null,
        event_type:          'race' as const,
        event_source:        'multigp' as const,
        latitude:            parseFloat(r.latitude),
        longitude:           parseFloat(r.longitude),
        venue_name:          r.chapterName ?? chapterName,
        city:                r.city ?? null,
        state:               r.state ?? null,
        country:             r.country ?? 'US',
        start_time:          new Date(r.startDate).toISOString(),
        end_time:            r.endDate ? new Date(r.endDate).toISOString() : null,
        multigp_race_id:     String(r.id ?? r.raceId ?? ''),
        multigp_chapter_name: chapterName,
        max_participants:    r.pilotCount ? parseInt(r.pilotCount) : null,
        registration_url:    r.raceUrl ?? null,
        rsvp_count:          0,
        is_cancelled:        false,
      }));

    if (!rows.length) {
      return new Response(JSON.stringify({ synced: 0, message: 'No valid race data to insert' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { error } = await supabase
      .from('race_events')
      .upsert(rows, { onConflict: 'multigp_race_id', ignoreDuplicates: false });

    if (error) throw new Error(error.message);

    return new Response(JSON.stringify({ synced: rows.length, chapter: chapterName }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? 'Unknown error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
