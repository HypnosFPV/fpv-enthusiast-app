// supabase/functions/challenge-notifications/index.ts
// =============================================================================
// Edge Function: challenge-notifications
//
// Triggered by pg_cron (or manually) to:
//  1. Insert in-app notification rows via DB helper functions.
//  2. Send Expo push notifications to opted-in users.
//
// POST body:
//   { "type": "voting_open" | "voting_closing" | "results", "challenge_id"?: uuid }
//
// If challenge_id is omitted the function finds the current voting challenge
// automatically.
//
// Schedule (pg_cron – set up in Supabase Dashboard → Database → Extensions):
//   voting_open    : '5 0 * * 6'   – Saturday  00:05 UTC
//   voting_closing : '0 22 * * 0'  – Sunday    22:00 UTC (2 h before close)
//   results        : '10 0 * * 1'  – Monday    00:10 UTC (after advance runs)
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH    = 100; // Expo recommends ≤ 100 per request

// ─── Types ────────────────────────────────────────────────────────────────────
type NotifType = 'voting_open' | 'voting_closing' | 'results';

interface ExpoMessage {
  to:    string;
  title: string;
  body:  string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Send a batch of Expo push messages (max 100 per call). */
async function sendExpoBatch(messages: ExpoMessage[]): Promise<void> {
  if (!messages.length) return;
  const res = await fetch(EXPO_PUSH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    JSON.stringify(messages),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[challenge-notifications] Expo push error:', res.status, text);
  }
}

/** Chunk an array into smaller arrays of at most `size` elements. */
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: { type?: NotifType; challenge_id?: string } =
      await req.json().catch(() => ({}));

    const notifType: NotifType = body.type ?? 'voting_open';

    // ── Find the target challenge ────────────────────────────────────────────
    let challengeId: string | null = body.challenge_id ?? null;

    if (!challengeId) {
      const statusFilter =
        notifType === 'results' ? ['completed'] : ['voting', 'active'];

      const { data: ch } = await supabase
        .from('challenges')
        .select('id, title, voting_closes_at')
        .in('status', statusFilter)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!ch) return json({ error: 'No matching challenge found' }, 404);
      challengeId = ch.id;
    }

    // ── Insert in-app notification rows via DB function ──────────────────────
    const rpcName =
      notifType === 'voting_open'    ? 'notify_challenge_voting_open'    :
      notifType === 'voting_closing' ? 'notify_challenge_voting_closing' :
                                       'notify_challenge_results';

    const { data: inAppCount, error: rpcErr } = await supabase
      .rpc(rpcName, { p_challenge_id: challengeId });

    if (rpcErr) {
      console.error('[challenge-notifications] RPC error:', rpcErr.message);
    }

    // ── Fetch push tokens for recipients ────────────────────────────────────
    // Which users received in-app notifications for this challenge + type?
    const { data: newNotifs } = await supabase
      .from('notifications')
      .select('user_id, message')
      .eq('type',
        notifType === 'voting_open'    ? 'challenge_voting_open'    :
        notifType === 'voting_closing' ? 'challenge_voting_closing' :
                                         'challenge_result'
      )
      .eq('challenge_id', challengeId)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(5000);

    // Collect unique user IDs and a message sample
    const userIds = [...new Set((newNotifs ?? []).map(n => n.user_id))];
    const msgSample = newNotifs?.[0]?.message ?? '';

    let pushSent = 0;

    if (userIds.length > 0) {
      // Fetch Expo push tokens for these users
      const { data: tokens } = await supabase
        .from('user_push_tokens')
        .select('user_id, token')
        .in('user_id', userIds);

      if (tokens && tokens.length > 0) {
        const { title, body: notifBody } = buildPushContent(notifType, msgSample);

        const messages: ExpoMessage[] = tokens.map(t => ({
          to:    t.token,
          title,
          body:  notifBody,
          sound: 'default',
          data:  { type: notifType, challenge_id: challengeId, navigate: 'challenges' },
        }));

        // Send in batches of 100
        for (const batch of chunks(messages, EXPO_BATCH)) {
          await sendExpoBatch(batch);
          pushSent += batch.length;
        }
      }
    }

    return json({
      ok:          true,
      type:        notifType,
      challenge_id: challengeId,
      in_app_sent: inAppCount ?? 0,
      push_sent:   pushSent,
    });

  } catch (err) {
    console.error('[challenge-notifications] Fatal:', err);
    return json({ error: String(err) }, 500);
  }
});

// ─── Push message copy ────────────────────────────────────────────────────────
function buildPushContent(type: NotifType, _dbMessage: string): { title: string; body: string } {
  switch (type) {
    case 'voting_open':
      return {
        title: '🏆 Voting is Open!',
        body:  'Cast your vote in this week\'s FPV challenge before Sunday night.',
      };
    case 'voting_closing':
      return {
        title: '⏰ Last Chance to Vote!',
        body:  'Only 2 hours left to vote in this week\'s challenge. Don\'t miss it!',
      };
    case 'results':
      return {
        title: '🥇 Challenge Results Are In!',
        body:  'See who won this week\'s FPV challenge and how many Props you earned.',
      };
  }
}
