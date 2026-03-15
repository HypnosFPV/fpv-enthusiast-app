// app/chat/[roomId].tsx
// Individual chat room — works for DMs, group chats, and marketplace threads
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Image, KeyboardAvoidingView,
  Platform, Pressable, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { useChatRoom, ChatMessage, ChatRoom } from '../../src/hooks/useChat';
import { useChatContext } from '../../src/context/ChatContext';
import { supabase } from '../../src/services/supabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg, isMe, showAvatar, showSenderName,
}: {
  msg: ChatMessage;
  isMe: boolean;
  showAvatar: boolean;
  showSenderName: boolean;
}) {
  const isDeleted = !!msg.deleted_at;

  if (msg.type === 'system') {
    return (
      <View style={styles.systemMsgWrap}>
        <Text style={styles.systemMsg}>{msg.body}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowThem]}>
      {/* Left avatar placeholder for alignment */}
      {!isMe && (
        <View style={styles.avatarSlot}>
          {showAvatar
            ? msg.sender?.avatar_url
              ? <Image source={{ uri: msg.sender.avatar_url }} style={styles.senderAvatar} />
              : <View style={[styles.senderAvatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={14} color="#666" />
                </View>
            : <View style={styles.senderAvatar} />
          }
        </View>
      )}

      <View style={[styles.bubbleWrap, isMe ? styles.bubbleWrapMe : styles.bubbleWrapThem]}>
        {!isMe && showSenderName && msg.sender?.username && (
          <Text style={styles.senderName}>{msg.sender.username}</Text>
        )}
        <View style={[
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          isDeleted && styles.bubbleDeleted,
        ]}>
          <Text style={[styles.bubbleText, isDeleted && styles.bubbleTextDeleted]}>
            {isDeleted ? 'Message deleted' : msg.body}
          </Text>
        </View>
        <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
          {formatTime(msg.created_at)}
        </Text>
      </View>
    </View>
  );
}

// ─── Date Separator ───────────────────────────────────────────────────────────

function DateSeparator({ date }: { date: string }) {
  return (
    <View style={styles.dateSep}>
      <View style={styles.dateLine} />
      <Text style={styles.dateLabel}>{formatDateLabel(date)}</Text>
      <View style={styles.dateLine} />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ChatRoomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const {
    messages, messagesLoad, sendMessage, sending, fetchMessages,
  } = useChatRoom(roomId ?? null, user?.id);

  const { markRoomRead } = useChatContext();

  const [draft, setDraft] = useState('');
  const [room,  setRoom]  = useState<ChatRoom | null>(null);
  const listRef = useRef<FlatList>(null);
  // Track whether user has scrolled up (don't snap to bottom if reading history)
  const isNearBottom = useRef(true);

  // Fetch room metadata for the header
  useEffect(() => {
    if (!roomId) return;
    supabase
      .from('chat_rooms')
      .select(`
        id, type, name, avatar_url, listing_id,
        members:chat_room_members (
          user_id, role, last_read_at,
          user:user_id ( username, avatar_url )
        ),
        listing:listing_id ( title, price )
      `)
      .eq('id', roomId)
      .single()
      .then(({ data }) => { if (data) setRoom(data as ChatRoom); });
  }, [roomId]);

  // Mark read when screen mounts
  useEffect(() => {
    if (roomId) markRoomRead(roomId);
  }, [roomId]);

  // ── Scroll to bottom whenever the last message ID changes ────────────────
  // Using lastMsgId (not messages.length) catches BOTH:
  //  1. A brand-new message being appended (length grows)
  //  2. The optimistic placeholder being swapped for the real server row
  //     (length stays the same but the last item's id changes)
  // This prevents the FlatList from jumping back up when fetchMessages()
  // replaces the optimistic key with the real UUID 600 ms after send.
  const lastMsgId = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!lastMsgId) return;
    // Small delay lets the FlatList finish its layout pass first
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: !!lastMsgId }), 80);
    return () => clearTimeout(t);
  }, [lastMsgId]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const result = await sendMessage(text, 'text');
    if (!result.ok) {
      // Genuine DB failure — restore draft so user doesn't lose their message
      console.warn('[Chat] sendMessage failed:', result.error);
      setDraft(text);
    }
    // Scrolling is handled entirely by the lastMsgId useEffect above —
    // no manual scrollToEnd calls needed here.
  }, [draft, sendMessage]);

  // ── Header info ────────────────────────────────────────────────────────────
  const getRoomTitle = (): string => {
    if (!room) return 'Chat';
    if (room.type === 'group') return room.name ?? 'Group Chat';
    if (room.type === 'marketplace') {
      const listing = room.listing as any;
      return listing?.title ? `📦 ${listing.title}` : 'Marketplace Chat';
    }
    // DM
    const other = room.members?.find(m => m.user_id !== user?.id);
    return other?.user?.username ?? 'Direct Message';
  };

  const getRoomSubtitle = (): string | null => {
    if (!room) return null;
    if (room.type === 'group') {
      const count = room.members?.length ?? 0;
      return `${count} members`;
    }
    if (room.type === 'marketplace') {
      const listing = room.listing as any;
      if (listing?.price) return `$${(listing.price / 100).toFixed(2)}`;
    }
    return null;
  };

  // ── Render list with date separators ──────────────────────────────────────
  type ListItem = ChatMessage | { type: '__date'; date: string; id: string };

  const listData: ListItem[] = [];
  let lastDateLabel = '';
  for (const msg of messages) {
    const label = formatDateLabel(msg.created_at);
    if (label !== lastDateLabel) {
      listData.push({ type: '__date', date: msg.created_at, id: `date_${msg.id}` });
      lastDateLabel = label;
    }
    listData.push(msg);
  }

  const renderItem = ({ item, index }: { item: ListItem; index: number }) => {
    if ('type' in item && item.type === '__date') {
      return <DateSeparator date={(item as any).date} />;
    }
    const msg = item as ChatMessage;
    const isMe = msg.sender_id === user?.id;
    // Show avatar + name if previous message from different sender
    const prevMsg = listData[index - 1];
    const prevSenderId = prevMsg && !('type' in prevMsg && (prevMsg as any).type === '__date')
      ? (prevMsg as ChatMessage).sender_id
      : null;
    const showAvatar = !isMe && prevSenderId !== msg.sender_id;
    const showSenderName = !isMe && (room?.type === 'group') && prevSenderId !== msg.sender_id;

    return (
      <MessageBubble
        msg={msg}
        isMe={isMe}
        showAvatar={showAvatar}
        showSenderName={showSenderName}
      />
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 64 : 0}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color="#ff4500" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{getRoomTitle()}</Text>
          {getRoomSubtitle() && (
            <Text style={styles.headerSub} numberOfLines={1}>{getRoomSubtitle()}</Text>
          )}
        </View>

        {/* Members button for group chats */}
        {room?.type === 'group' && (
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => Alert.alert(
              'Members',
              room.members?.map(m => m.user?.username ?? m.user_id).join('\n') ?? ''
            )}
          >
            <Ionicons name="people-outline" size={22} color="#aaa" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Messages ──────────────────────────────────────────────────────── */}
      {messagesLoad && messages.length === 0
        ? <ActivityIndicator color="#ff4500" style={{ flex: 1 }} />
        : (
          <FlatList
            ref={listRef}
            data={listData}
            keyExtractor={item => (item as any).id}
            renderItem={renderItem}
            style={{ flex: 1 }}
            contentContainerStyle={styles.messageList}
            onRefresh={fetchMessages}
            refreshing={messagesLoad}
            // Pin scroll to bottom whenever content grows (new messages / optimistic swap)
            onContentSizeChange={() => {
              if (isNearBottom.current) {
                listRef.current?.scrollToEnd({ animated: false });
              }
            }}
            // Also scroll to bottom when layout changes (keyboard open/close)
            onLayout={() => {
              listRef.current?.scrollToEnd({ animated: false });
            }}
            onScroll={e => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              const distFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
              isNearBottom.current = distFromBottom < 80;
            }}
            scrollEventThrottle={100}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={48} color="#333" />
                <Text style={styles.emptyText}>No messages yet. Say hello! 👋</Text>
              </View>
            }
          />
        )
      }

      {/* ── Input bar ─────────────────────────────────────────────────────── */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message…"
          placeholderTextColor="#555"
          multiline
          maxLength={2000}
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || sending}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="send" size={18} color="#fff" />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0a0a0a' },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingBottom: 12, paddingHorizontal: 8, backgroundColor: '#111', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#222' },
  backBtn:          { padding: 8 },
  headerCenter:     { flex: 1, marginHorizontal: 4 },
  headerTitle:      { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerSub:        { color: '#888', fontSize: 12, marginTop: 1 },
  headerAction:     { padding: 8 },

  // Messages
  messageList:      { paddingVertical: 12, paddingHorizontal: 8 },

  emptyWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText:        { color: '#555', marginTop: 12, fontSize: 15, textAlign: 'center' },

  // Date separator
  dateSep:          { flexDirection: 'row', alignItems: 'center', marginVertical: 12, paddingHorizontal: 8 },
  dateLine:         { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#222' },
  dateLabel:        { color: '#666', fontSize: 12, marginHorizontal: 10 },

  // System message
  systemMsgWrap:    { alignItems: 'center', marginVertical: 6 },
  systemMsg:        { color: '#666', fontSize: 12, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 24 },

  // Bubbles
  bubbleRow:        { flexDirection: 'row', marginVertical: 2, alignItems: 'flex-end' },
  bubbleRowMe:      { justifyContent: 'flex-end', paddingLeft: 52 },
  bubbleRowThem:    { justifyContent: 'flex-start', paddingRight: 52 },
  avatarSlot:       { width: 32, marginRight: 6 },
  senderAvatar:     { width: 28, height: 28, borderRadius: 14 },
  avatarFallback:   { backgroundColor: '#1e1e1e', justifyContent: 'center', alignItems: 'center' },
  bubbleWrap:       { maxWidth: '80%' },
  bubbleWrapMe:     { alignItems: 'flex-end' },
  bubbleWrapThem:   { alignItems: 'flex-start' },
  senderName:       { color: '#aaa', fontSize: 11, marginBottom: 2, marginLeft: 12 },
  bubble:           { borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14 },
  bubbleMe:         { backgroundColor: '#ff4500' },
  bubbleThem:       { backgroundColor: '#1e1e1e' },
  bubbleDeleted:    { backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a' },
  bubbleText:       { color: '#fff', fontSize: 15, lineHeight: 20 },
  bubbleTextDeleted:{ color: '#555', fontStyle: 'italic' },
  bubbleTime:       { color: '#666', fontSize: 10, marginTop: 3, marginLeft: 4 },
  bubbleTimeMe:     { marginRight: 4 },

  // Input
  inputBar:         { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, backgroundColor: '#111', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#222', gap: 8 },
  input:            { flex: 1, backgroundColor: '#1e1e1e', color: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontSize: 15, maxHeight: 120 },
  sendBtn:          { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ff4500', justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled:  { backgroundColor: '#333' },
});
