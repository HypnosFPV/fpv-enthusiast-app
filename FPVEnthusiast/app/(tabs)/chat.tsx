// app/(tabs)/chat.tsx
// FPV Chat — DMs, group chats, marketplace threads
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Image, Modal, Alert,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { useChat, ChatRoom } from '../../src/hooks/useChat';
import { supabase } from '../../src/services/supabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function getRoomDisplayName(room: ChatRoom, myId: string): string {
  if (room.type === 'group') return room.name ?? 'Group Chat';
  if (room.type === 'marketplace') {
    const other = room.members?.find(m => m.user_id !== myId);
    return other?.user?.username ?? 'Marketplace Chat';
  }
  // DM — show other person's username
  const other = room.members?.find(m => m.user_id !== myId);
  return other?.user?.username ?? 'Direct Message';
}

function getRoomAvatar(room: ChatRoom, myId: string): string | null {
  if (room.avatar_url) return room.avatar_url;
  if (room.type === 'group') return null;
  const other = room.members?.find(m => m.user_id !== myId);
  return other?.user?.avatar_url ?? null;
}

// ─── New Group Modal ──────────────────────────────────────────────────────────

function NewGroupModal({
  visible, onClose, currentUserId, onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  currentUserId: string;
  onCreate: (name: string, memberIds: string[]) => Promise<void>;
}) {
  const [groupName, setGroupName] = useState('');
  const [search,    setSearch]    = useState('');
  const [results,   setResults]   = useState<{id:string;username:string;avatar_url:string|null}[]>([]);
  const [selected,  setSelected]  = useState<{id:string;username:string}[]>([]);
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (!visible) { setGroupName(''); setSearch(''); setResults([]); setSelected([]); }
  }, [visible]);

  const searchUsers = useCallback(async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) { setResults([]); return; }
    const { data } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .ilike('username', `%${q.trim()}%`)
      .neq('id', currentUserId)
      .limit(10);
    setResults((data ?? []) as typeof results);
  }, [currentUserId]);

  const toggle = (u: {id:string;username:string}) => {
    setSelected(prev =>
      prev.some(s => s.id === u.id)
        ? prev.filter(s => s.id !== u.id)
        : [...prev, u]
    );
  };

  const handleCreate = async () => {
    if (!groupName.trim() || selected.length === 0) return;
    setSaving(true);
    await onCreate(groupName.trim(), selected.map(s => s.id));
    setSaving(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Group</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="#aaa" />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.groupNameInput}
            placeholder="Group name…"
            placeholderTextColor="#555"
            value={groupName}
            onChangeText={setGroupName}
          />

          <TextInput
            style={styles.searchInput}
            placeholder="Search users to add…"
            placeholderTextColor="#555"
            value={search}
            onChangeText={searchUsers}
          />

          {selected.length > 0 && (
            <View style={styles.selectedChips}>
              {selected.map(u => (
                <TouchableOpacity
                  key={u.id}
                  style={styles.chip}
                  onPress={() => toggle(u)}
                >
                  <Text style={styles.chipTxt}>{u.username}</Text>
                  <Ionicons name="close-circle" size={14} color="#fff" />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <FlatList
            data={results}
            keyExtractor={u => u.id}
            style={{ maxHeight: 200 }}
            renderItem={({ item }) => {
              const isSelected = selected.some(s => s.id === item.id);
              return (
                <TouchableOpacity
                  style={[styles.userRow, isSelected && styles.userRowSelected]}
                  onPress={() => toggle(item)}
                >
                  {item.avatar_url
                    ? <Image source={{ uri: item.avatar_url }} style={styles.userAvatar} />
                    : <View style={[styles.userAvatar, styles.avatarFallback]}>
                        <Ionicons name="person" size={16} color="#666" />
                      </View>
                  }
                  <Text style={styles.userRowName}>{item.username}</Text>
                  {isSelected && <Ionicons name="checkmark-circle" size={18} color="#ff4500" />}
                </TouchableOpacity>
              );
            }}
          />

          <TouchableOpacity
            style={[styles.createBtn, (saving || !groupName.trim() || selected.length === 0) && { opacity: 0.4 }]}
            onPress={handleCreate}
            disabled={saving || !groupName.trim() || selected.length === 0}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.createBtnTxt}>Create Group ({selected.length} members)</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── New DM Search ────────────────────────────────────────────────────────────

function NewDMModal({
  visible, onClose, currentUserId,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  currentUserId: string;
  onSelect: (userId: string) => Promise<void>;
}) {
  const [search,  setSearch]  = useState('');
  const [results, setResults] = useState<{id:string;username:string;avatar_url:string|null}[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!visible) { setSearch(''); setResults([]); } }, [visible]);

  const searchUsers = useCallback(async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .ilike('username', `%${q.trim()}%`)
      .neq('id', currentUserId)
      .limit(15);
    setResults((data ?? []) as typeof results);
    setLoading(false);
  }, [currentUserId]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.modalSheet, { minHeight: 300 }]} onPress={e => e.stopPropagation()}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Message</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="#aaa" />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search users…"
            placeholderTextColor="#555"
            value={search}
            onChangeText={searchUsers}
            autoFocus
          />
          {loading && <ActivityIndicator color="#ff4500" style={{ marginTop: 12 }} />}
          <FlatList
            data={results}
            keyExtractor={u => u.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.userRow}
                onPress={async () => { onClose(); await onSelect(item.id); }}
              >
                {item.avatar_url
                  ? <Image source={{ uri: item.avatar_url }} style={styles.userAvatar} />
                  : <View style={[styles.userAvatar, styles.avatarFallback]}>
                      <Ionicons name="person" size={18} color="#666" />
                    </View>
                }
                <Text style={styles.userRowName}>{item.username}</Text>
                <Ionicons name="chevron-forward" size={16} color="#555" />
              </TouchableOpacity>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Room Row ────────────────────────────────────────────────────────────────

function RoomRow({
  room, myId, onPress,
}: {
  room: ChatRoom; myId: string; onPress: () => void;
}) {
  const displayName = getRoomDisplayName(room, myId);
  const avatarUri   = getRoomAvatar(room, myId);
  const isGroup     = room.type === 'group';
  const isMkt       = room.type === 'marketplace';
  const hasUnread   = (room.unread_count ?? 0) > 0;

  return (
    <TouchableOpacity style={styles.roomRow} onPress={onPress} activeOpacity={0.75}>
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {avatarUri
          ? <Image source={{ uri: avatarUri }} style={styles.roomAvatar} />
          : <View style={[styles.roomAvatar, styles.avatarFallback]}>
              <Ionicons
                name={isGroup ? 'people' : isMkt ? 'storefront-outline' : 'person'}
                size={22}
                color="#666"
              />
            </View>
        }
        {isMkt && (
          <View style={styles.mktBadge}>
            <Ionicons name="storefront" size={9} color="#fff" />
          </View>
        )}
      </View>

      {/* Text */}
      <View style={styles.roomMeta}>
        <View style={styles.roomMetaRow}>
          <Text style={[styles.roomName, hasUnread && styles.roomNameUnread]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.roomTime}>{timeAgo(room.last_message_at)}</Text>
        </View>
        <View style={styles.roomMetaRow}>
          <Text style={[styles.roomPreview, hasUnread && styles.roomPreviewUnread]} numberOfLines={1}>
            {isMkt && room.listing
              ? `📦 ${(room.listing as any).title ?? 'Listing'}`
              : (room.last_message ?? 'No messages yet')}
          </Text>
          {hasUnread && <View style={styles.unreadDot} />}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ChatTab() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    rooms, roomsLoad, fetchRooms,
    getOrCreateDM, createGroup,
  } = useChat(user?.id);

  const [showNewDM,    setShowNewDM]    = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [search,       setSearch]       = useState('');

  const filtered = search.trim()
    ? rooms.filter(r => {
        const name = getRoomDisplayName(r, user?.id ?? '');
        return name.toLowerCase().includes(search.toLowerCase());
      })
    : rooms;

  const openRoom = (roomId: string) => {
    router.push(`/chat/${roomId}` as any);
  };

  const handleNewDM = async (otherUserId: string) => {
    const roomId = await getOrCreateDM(otherUserId);
    if (roomId) openRoom(roomId);
    else Alert.alert('Error', 'Could not open chat');
  };

  const handleNewGroup = async (name: string, memberIds: string[]) => {
    const roomId = await createGroup(name, memberIds);
    if (roomId) openRoom(roomId);
    else Alert.alert('Error', 'Could not create group');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewGroup(true)}>
            <Ionicons name="people-outline" size={22} color="#ff4500" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewDM(true)}>
            <Ionicons name="create-outline" size={22} color="#ff4500" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color="#666" />
        <TextInput
          style={styles.searchField}
          placeholder="Search conversations…"
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {/* Room list */}
      {roomsLoad && rooms.length === 0
        ? <ActivityIndicator color="#ff4500" style={{ marginTop: 40 }} />
        : (
          <FlatList
            data={filtered}
            keyExtractor={r => r.id}
            renderItem={({ item }) => (
              <RoomRow
                room={item}
                myId={user?.id ?? ''}
                onPress={() => openRoom(item.id)}
              />
            )}
            refreshing={roomsLoad}
            onRefresh={fetchRooms}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={48} color="#333" />
                <Text style={styles.emptyTitle}>No conversations yet</Text>
                <Text style={styles.emptySub}>
                  Tap the ✏️ icon to start a DM or the 👥 icon for a group chat
                </Text>
              </View>
            }
          />
        )
      }

      {/* Modals */}
      <NewDMModal
        visible={showNewDM}
        onClose={() => setShowNewDM(false)}
        currentUserId={user?.id ?? ''}
        onSelect={handleNewDM}
      />
      <NewGroupModal
        visible={showNewGroup}
        onClose={() => setShowNewGroup(false)}
        currentUserId={user?.id ?? ''}
        onCreate={handleNewGroup}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0a' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12 },
  headerTitle:    { fontSize: 28, fontWeight: '700', color: '#fff' },
  headerActions:  { flexDirection: 'row', gap: 8 },
  headerBtn:      { padding: 8 },

  searchBar:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  searchField:    { flex: 1, color: '#fff', fontSize: 15 },

  roomRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1a1a1a' },
  avatarWrap:     { position: 'relative', marginRight: 12 },
  roomAvatar:     { width: 50, height: 50, borderRadius: 25 },
  avatarFallback: { backgroundColor: '#1e1e1e', justifyContent: 'center', alignItems: 'center' },
  mktBadge:       { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#ff4500', borderRadius: 8, width: 16, height: 16, justifyContent: 'center', alignItems: 'center' },
  roomMeta:       { flex: 1 },
  roomMetaRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  roomName:       { fontSize: 15, fontWeight: '600', color: '#e5e5e5', flex: 1, marginRight: 8 },
  roomNameUnread: { color: '#fff', fontWeight: '700' },
  roomTime:       { fontSize: 12, color: '#666' },
  roomPreview:    { fontSize: 13, color: '#666', flex: 1, marginRight: 8 },
  roomPreviewUnread: { color: '#aaa' },
  unreadDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff4500' },

  empty:          { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle:     { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  emptySub:       { color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  // Modal
  modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet:     { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 },
  modalHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#222' },
  modalTitle:     { color: '#fff', fontSize: 17, fontWeight: '700' },
  groupNameInput: { backgroundColor: '#1e1e1e', color: '#fff', borderRadius: 10, padding: 12, marginHorizontal: 16, marginTop: 12, fontSize: 15 },
  searchInput:    { backgroundColor: '#1e1e1e', color: '#fff', borderRadius: 10, padding: 12, marginHorizontal: 16, marginTop: 8, fontSize: 15 },
  selectedChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  chip:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ff4500', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4, gap: 4 },
  chipTxt:        { color: '#fff', fontSize: 13, fontWeight: '600' },
  userRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e1e' },
  userRowSelected:{ backgroundColor: '#1a1a1a' },
  userAvatar:     { width: 38, height: 38, borderRadius: 19 },
  userRowName:    { flex: 1, color: '#fff', fontSize: 15 },
  createBtn:      { backgroundColor: '#ff4500', margin: 16, borderRadius: 12, padding: 14, alignItems: 'center' },
  createBtnTxt:   { color: '#fff', fontSize: 16, fontWeight: '700' },
});
