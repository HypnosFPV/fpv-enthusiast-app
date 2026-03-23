// src/hooks/useChat.ts
// Full chat system — DMs, group chats, marketplace chats
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMember {
  user_id:     string;
  role:        'owner' | 'admin' | 'member';
  last_read_at: string;
  user?: { username: string | null; avatar_url: string | null };
}

export interface ChatRoom {
  id:              string;
  type:            'dm' | 'group' | 'marketplace';
  name:            string | null;
  avatar_url:      string | null;
  listing_id:      string | null;
  social_group_id?: string | null;
  last_message:    string | null;
  last_message_at: string | null;
  updated_at:      string;
  created_by:      string | null;
  members?:        ChatMember[];
  unread_count?:   number;
  listing?:        { title: string; price: number; image_url?: string | null } | null;
  social_group?:   { id: string; name: string; privacy?: string | null; can_chat?: string | null } | null;
}

export interface ChatMessage {
  id:         string;
  room_id:    string;
  sender_id:  string;
  body:       string;
  type:       'text' | 'image' | 'offer' | 'system';
  metadata:   Record<string, unknown> | null;
  deleted_at: string | null;
  created_at: string;
  sender?:    { username: string | null; avatar_url: string | null } | null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useChat(currentUserId?: string) {
  const [rooms,     setRooms]     = useState<ChatRoom[]>([]);
  const [roomsLoad, setRoomsLoad] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Fetch room list ────────────────────────────────────────────────────────
  const fetchRooms = useCallback(async () => {
    if (!currentUserId) return;
    setRoomsLoad(true);

    // Strategy 1: full query with member join (requires is_room_member RLS fix)
    let data: ChatRoom[] | null = null;
    let error: { message: string } | null = null;

    const res1 = await supabase
      .from('chat_rooms')
      .select(`
        id, type, name, avatar_url, listing_id, social_group_id,
        last_message, last_message_at, updated_at, created_by,
        members:chat_room_members (
          user_id, role, last_read_at,
          user:user_id ( username, avatar_url )
        ),
        listing:listing_id ( title, price ),
        social_group:social_group_id ( id, name, privacy, can_chat )
      `)
      .order('updated_at', { ascending: false });

    if (!res1.error) {
      data = res1.data as ChatRoom[];
    } else {
      // Strategy 2: RLS recursion bug — fall back to membership-first approach.
      // Query chat_room_members for rooms this user belongs to, then fetch rooms.
      console.warn('[useChat] fetchRooms join failed, trying fallback:', res1.error.message);
      const { data: memberRows, error: mErr } = await supabase
        .from('chat_room_members')
        .select('room_id')
        .eq('user_id', currentUserId);

      if (mErr || !memberRows?.length) {
        console.warn('[useChat] fetchRooms fallback also failed:', mErr?.message);
        error = mErr ?? { message: 'No rooms found' };
      } else {
        const roomIds = memberRows.map(r => r.room_id);
        const res2 = await supabase
          .from('chat_rooms')
          .select(`
            id, type, name, avatar_url, listing_id, social_group_id,
            last_message, last_message_at, updated_at, created_by,
            social_group:social_group_id ( id, name, privacy, can_chat )
          `)
          .in('id', roomIds)
          .order('updated_at', { ascending: false });
        if (!res2.error) {
          // Fetch members separately for each room
          const roomsWithMembers = await Promise.all(
            ((res2.data ?? []) as ChatRoom[]).map(async room => {
              const { data: mems } = await supabase
                .from('chat_room_members')
                .select('user_id, role, last_read_at, user:user_id ( username, avatar_url )')
                .eq('room_id', room.id);
              return { ...room, members: (mems ?? []) as ChatMember[], listing: null };
            })
          );
          data = roomsWithMembers;
        } else {
          error = res2.error;
        }
      }
    }

    if (error || !data) {
      console.warn('[useChat] fetchRooms all strategies failed:', error?.message);
      setRoomsLoad(false);
      return;
    }

    // Compute unread count per room
    const roomsWithUnread = ((data ?? []) as ChatRoom[]).map(room => {
      const myMember = room.members?.find(m => m.user_id === currentUserId);
      const lastRead = myMember?.last_read_at ?? '1970-01-01';
      // We'll compute unread lazily — just flag rooms newer than last_read
      const hasUnread = room.last_message_at
        ? room.last_message_at > lastRead
        : false;
      return { ...room, unread_count: hasUnread ? 1 : 0 };
    });

    // Deduplicate by room ID (Strategy 1 + fallback can occasionally return
    // the same room twice; also filter to rooms this user is actually in)
    const seen = new Set<string>();
    const deduped = roomsWithUnread.filter(room => {
      if (seen.has(room.id)) return false;
      seen.add(room.id);
      // Only show rooms where currentUser is a member
      if (room.members && room.members.length > 0) {
        return room.members.some(m => m.user_id === currentUserId);
      }
      return true; // fallback path (no members array) — keep it
    });

    setRooms(deduped);
    setRoomsLoad(false);
  }, [currentUserId]);

  // ── Get or create DM room ──────────────────────────────────────────────────
  const getOrCreateDM = useCallback(async (
    otherUserId: string
  ): Promise<string | null> => {
    if (!currentUserId) return null;
    const { data, error } = await supabase.rpc('get_or_create_dm', {
      p_other_id: otherUserId,
    });
    if (error) { console.warn('[useChat] getOrCreateDM error:', error.message); return null; }
    await fetchRooms();
    return data as string;
  }, [currentUserId, fetchRooms]);

  // ── Get or create marketplace chat ────────────────────────────────────────
  const getOrCreateMarketplaceChat = useCallback(async (
    listingId: string,
    sellerId:  string
  ): Promise<string | null> => {
    if (!currentUserId) return null;
    const { data, error } = await supabase.rpc('get_or_create_marketplace_chat', {
      p_listing_id: listingId,
      p_seller_id:  sellerId,
    });
    if (error) { console.warn('[useChat] marketplace chat error:', error.message); return null; }
    await fetchRooms();
    return data as string;
  }, [currentUserId, fetchRooms]);

  // ── Create group chat ─────────────────────────────────────────────────────
  const createGroup = useCallback(async (
    name:      string,
    memberIds: string[]
  ): Promise<string | null> => {
    if (!currentUserId) return null;

    const { data: room, error: rErr } = await supabase
      .from('chat_rooms')
      .insert({ type: 'group', name, created_by: currentUserId })
      .select()
      .single();
    if (rErr || !room) { console.warn('[useChat] createGroup error:', rErr?.message); return null; }

    const allMembers = Array.from(new Set([currentUserId, ...memberIds]));
    const rows = allMembers.map((uid, i) => ({
      room_id: (room as ChatRoom).id,
      user_id: uid,
      role: (i === 0 ? 'owner' : 'member') as 'owner' | 'member',
    }));
    await supabase.from('chat_room_members').insert(rows);
    await fetchRooms();
    return (room as ChatRoom).id;
  }, [currentUserId, fetchRooms]);

  // ── Mark room as read ─────────────────────────────────────────────────────
  const markRoomRead = useCallback(async (roomId: string) => {
    if (!currentUserId) return;
    await supabase
      .from('chat_room_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .eq('user_id', currentUserId);
    setRooms(prev => prev.map(r =>
      r.id === roomId ? { ...r, unread_count: 0 } : r
    ));
  }, [currentUserId]);

  // ── Realtime: subscribe to room list changes ───────────────────────────────
  const subscribeRooms = useCallback(() => {
    if (!currentUserId) return;
    channelRef.current = supabase
      .channel(`chat_rooms_${currentUserId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chat_rooms',
      }, () => { fetchRooms(); })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
      }, () => { fetchRooms(); })
      .subscribe();
  }, [currentUserId, fetchRooms]);

  useEffect(() => {
    fetchRooms();
    subscribeRooms();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [fetchRooms, subscribeRooms]);

  const totalUnread = rooms.reduce((s, r) => s + (r.unread_count ?? 0), 0);

  return {
    rooms, roomsLoad, fetchRooms,
    getOrCreateDM,
    getOrCreateMarketplaceChat,
    createGroup,
    markRoomRead,
    totalUnread,
  };
}

// ─── Single-room messages hook ────────────────────────────────────────────────

export function useChatRoom(roomId: string | null, currentUserId?: string) {
  const [messages,     setMessages]     = useState<ChatMessage[]>([]);
  const [messagesLoad, setMessagesLoad] = useState(false);
  const [sending,      setSending]      = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!roomId) return;
    setMessagesLoad(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select(`
        id, room_id, sender_id, body, type, metadata, deleted_at, created_at,
        sender:sender_id ( username, avatar_url )
      `)
      .eq('room_id', roomId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) console.warn('[useChatRoom] fetchMessages error:', error.message);
    setMessages((data ?? []) as ChatMessage[]);
    setMessagesLoad(false);
  }, [roomId]);

  const sendMessage = useCallback(async (
    body:     string,
    type:     ChatMessage['type'] = 'text',
    metadata: Record<string, unknown> | null = null,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!roomId || !currentUserId || !body.trim()) return { ok: false, error: 'Missing room or user' };
    setSending(true);

    // ── Optimistic update — show immediately without waiting for realtime ──
    const optimisticId = `optimistic_${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id:         optimisticId,
      room_id:    roomId,
      sender_id:  currentUserId,
      body:       body.trim(),
      type,
      metadata,
      deleted_at: null,
      created_at: new Date().toISOString(),
      sender:     null,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    // ── INSERT only — do NOT chain .select() here.
    // Chaining .select().single() after .insert() fires a second SELECT that is
    // blocked by the chat_messages RLS SELECT policy on Supabase free tier,
    // returning an error even though the INSERT succeeded.  That error was
    // incorrectly triggering the optimistic-rollback path, making the message
    // vanish from the UI until the user re-entered the room.
    const { error: insertError } = await supabase
      .from('chat_messages')
      .insert({
        room_id:   roomId,
        sender_id: currentUserId,
        body:      body.trim(),
        type,
        metadata,
      });

    setSending(false);

    if (insertError) {
      // Genuine write failure — roll back optimistic message and restore draft
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
      console.warn('[useChatRoom] sendMessage insert error:', insertError.message, insertError.code);
      return { ok: false, error: insertError.message };
    }

    // INSERT succeeded.  The optimistic message is already visible.
    // Fetch from DB after a short delay so the optimistic placeholder is
    // replaced with the real server row (gets the proper UUID + timestamps).
    setTimeout(() => fetchMessages(), 600);

    return { ok: true };
  }, [roomId, currentUserId, fetchMessages]);

  const subscribeMessages = useCallback(() => {
    if (!roomId) return;
    // Broadcast channel — works regardless of RLS (no postgres_changes RLS check)
    // Falls back to polling via fetchMessages every 4s
    channelRef.current = supabase
      .channel(`chat_room_${roomId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'chat_messages',
        filter: `room_id=eq.${roomId}`,
      }, payload => {
        const msg = payload.new as ChatMessage;
        setMessages(prev => {
          // Skip exact duplicate by real UUID (already in list from a prior fetch)
          if (prev.some(m => m.id === msg.id)) return prev;

          // If there is an optimistic placeholder from the SAME sender with the
          // same body, swap it out for the confirmed server row in-place.
          // This avoids calling fetchMessages() (which would schedule a second
          // fetch alongside the 600 ms one in sendMessage) and eliminates the
          // race that caused messages to appear twice.
          const optimisticIndex = prev.findIndex(
            m =>
              m.id.startsWith('optimistic_') &&
              m.sender_id === msg.sender_id &&
              m.body === msg.body,
          );
          if (optimisticIndex !== -1) {
            const updated = [...prev];
            // Replace the optimistic placeholder with the real server row.
            // Cast because the realtime payload lacks the joined `sender` field;
            // the 600 ms fetchMessages() call will hydrate it shortly after.
            updated[optimisticIndex] = { ...msg, sender: prev[optimisticIndex].sender };
            return updated;
          }

          return [...prev, msg];
        });
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Realtime unavailable — start polling every 4s
          console.warn('[useChatRoom] realtime unavailable, polling every 4s');
          const poll = setInterval(() => fetchMessages(), 4000);
          // Store cleanup on channelRef as a side-effect flag
          (channelRef as any)._pollInterval = poll;
        }
      });
  }, [roomId, fetchMessages]);

  useEffect(() => {
    fetchMessages();
    subscribeMessages();
    return () => {
      if (channelRef.current) {
        // Clear any fallback poll interval
        if ((channelRef as any)._pollInterval) {
          clearInterval((channelRef as any)._pollInterval);
        }
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchMessages, subscribeMessages]);

  return { messages, messagesLoad, sendMessage, sending, fetchMessages };
}
