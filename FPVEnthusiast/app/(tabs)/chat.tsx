import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  RefreshControl,
  FlatList,
  Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { ChatRoom, useChat } from '../../src/hooks/useChat';
import {
  SocialGroupInvite,
  SocialGroupPermission,
  SocialGroupPrivacy,
  useSocialGroups,
} from '../../src/hooks/useSocialGroups';
import { supabase } from '../../src/services/supabase';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function getRoomDisplayName(room: ChatRoom, myId: string): string {
  if (room.social_group?.name) return room.social_group.name;
  if (room.type === 'group') return room.name ?? 'Group Chat';
  const other = room.members?.find(m => m.user_id !== myId);
  return other?.user?.username ?? (room.type === 'marketplace' ? 'Marketplace Chat' : 'Direct Message');
}

function getRoomAvatar(room: ChatRoom, myId: string): string | null {
  if (room.avatar_url) return room.avatar_url;
  const other = room.members?.find(m => m.user_id !== myId);
  return other?.user?.avatar_url ?? null;
}

function Avatar({ uri, icon, size = 48 }: { uri?: string | null; icon: keyof typeof Ionicons.glyphMap; size?: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name={icon} size={Math.round(size * 0.45)} color="#8a8a8a" />
    </View>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );
}

function ConversationRow({
  title,
  subtitle,
  time,
  unreadCount,
  avatarUri,
  icon,
  badge,
  onPress,
}: {
  title: string;
  subtitle: string;
  time?: string;
  unreadCount?: number;
  avatarUri?: string | null;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: string;
  onPress: () => void;
}) {
  const hasUnread = (unreadCount ?? 0) > 0;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.78}>
      <Avatar uri={avatarUri} icon={icon} />
      <View style={styles.rowMeta}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, hasUnread && styles.rowTitleUnread]} numberOfLines={1}>
            {title}
          </Text>
          {!!time && <Text style={styles.rowTime}>{time}</Text>}
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.rowSubtitle, hasUnread && styles.rowSubtitleUnread]} numberOfLines={1}>
            {subtitle}
          </Text>
          {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
          {hasUnread ? (
            <View style={styles.unreadPill}>
              <Text style={styles.unreadPillText}>{unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function PendingInviteCard({
  invite,
  onAccept,
  onDecline,
}: {
  invite: SocialGroupInvite;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.inviteCard}>
      <View style={styles.inviteTopRow}>
        <Avatar uri={invite.group?.avatar_url ?? invite.inviter?.avatar_url ?? null} icon="people" />
        <View style={{ flex: 1 }}>
          <View style={styles.inviteTitleRow}>
            <Text style={styles.rowTitle} numberOfLines={1}>{invite.group?.name ?? 'Community invite'}</Text>
            <View style={styles.inviteBadge}>
              <Text style={styles.inviteBadgeText}>INVITE</Text>
            </View>
          </View>
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {invite.inviter?.username
              ? `@${invite.inviter.username} invited you to join ${invite.group?.name ?? 'this community'}.`
              : 'You have a pending community invite.'}
          </Text>
          <Text style={styles.inviteMeta} numberOfLines={1}>
            {invite.group?.privacy === 'public' ? 'Public' : invite.group?.privacy === 'invite_only' ? 'Invite only' : 'Private'}
            {' • '}
            received {timeAgo(invite.created_at)} ago
          </Text>
        </View>
      </View>

      <View style={styles.inviteActions}>
        <TouchableOpacity style={styles.inviteDeclineBtn} onPress={onDecline} activeOpacity={0.8}>
          <Text style={styles.inviteDeclineText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.inviteAcceptBtn} onPress={onAccept} activeOpacity={0.8}>
          <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
          <Text style={styles.inviteAcceptText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MarketplaceBundleCard({
  sellerName,
  sellerAvatar,
  rooms,
  expanded,
  onToggle,
  onOpenRoom,
}: {
  sellerName: string;
  sellerAvatar?: string | null;
  rooms: ChatRoom[];
  expanded: boolean;
  onToggle: () => void;
  onOpenRoom: (roomId: string) => void;
}) {
  const latestRoom = rooms[0];
  const unreadCount = rooms.reduce((sum, room) => sum + (room.unread_count ?? 0), 0);
  const subtitle = latestRoom.listing?.title
    ? `${rooms.length} listing${rooms.length === 1 ? '' : 's'} • latest: ${latestRoom.listing.title}`
    : `${rooms.length} marketplace thread${rooms.length === 1 ? '' : 's'}`;

  return (
    <View style={styles.bundleCard}>
      <TouchableOpacity style={styles.bundleHeader} onPress={onToggle} activeOpacity={0.78}>
        <View style={styles.bundleHeaderLeft}>
          <View style={styles.bundleAvatarWrap}>
            <Avatar uri={sellerAvatar} icon="storefront-outline" />
            <View style={styles.marketBadge}>
              <Ionicons name="storefront" size={10} color="#fff" />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.bundleTitleRow}>
              <Text style={styles.bundleTitle} numberOfLines={1}>{sellerName}</Text>
              {unreadCount > 0 ? (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadPillText}>{unreadCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.bundleSubtitle} numberOfLines={1}>{subtitle}</Text>
          </View>
        </View>
        <View style={styles.bundleHeaderRight}>
          <Text style={styles.bundleTime}>{timeAgo(latestRoom.last_message_at)}</Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#9b9b9b" />
        </View>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.bundleChildren}>
          {rooms.map(room => (
            <TouchableOpacity
              key={room.id}
              style={styles.bundleChildRow}
              onPress={() => onOpenRoom(room.id)}
              activeOpacity={0.78}
            >
              <View style={styles.bundleThreadIcon}>
                <Ionicons name="pricetag-outline" size={14} color="#ff8b4d" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bundleChildTitle} numberOfLines={1}>
                  {room.listing?.title ?? 'Marketplace thread'}
                </Text>
                <Text style={styles.bundleChildSubtitle} numberOfLines={1}>
                  {room.last_message ?? 'Open thread'}
                </Text>
              </View>
              <Text style={styles.bundleChildTime}>{timeAgo(room.last_message_at)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function NewDMModal({
  visible,
  onClose,
  currentUserId,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  currentUserId: string;
  onSelect: (userId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) {
      setSearch('');
      setResults([]);
    }
  }, [visible]);

  const searchUsers = useCallback(async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .ilike('username', `%${q.trim()}%`)
      .neq('id', currentUserId)
      .limit(15);
    setResults((data ?? []) as typeof results);
    setLoading(false);
  }, [currentUserId, results]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New message</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color="#aaa" /></TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Search pilots…"
            placeholderTextColor="#777"
            value={search}
            onChangeText={searchUsers}
            autoFocus
          />
          {loading ? <ActivityIndicator color="#ff6a2f" style={{ marginTop: 12 }} /> : null}
          <FlatList
            data={results}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.userRow}
                onPress={async () => {
                  onClose();
                  await onSelect(item.id);
                }}
              >
                <Avatar uri={item.avatar_url} icon="person" size={40} />
                <Text style={styles.userName}>{item.username}</Text>
                <Ionicons name="chevron-forward" size={16} color="#666" />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              search.trim().length >= 2 && !loading
                ? <Text style={styles.emptySearch}>No pilots found</Text>
                : null
            }
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ChoicePill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.choicePill, active && styles.choicePillActive]} onPress={onPress}>
      <Text style={[styles.choicePillText, active && styles.choicePillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function NewCommunityModal({
  visible,
  onClose,
  currentUserId,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  currentUserId: string;
  onCreate: (payload: {
    name: string;
    description: string;
    privacy: SocialGroupPrivacy;
    memberIds: string[];
    canPost: SocialGroupPermission;
    canChat: SocialGroupPermission;
    canInvite: SocialGroupPermission;
  }) => Promise<void>;
}) {
  const handleDismiss = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<SocialGroupPrivacy>('private');
  const [canPost, setCanPost] = useState<SocialGroupPermission>('members');
  const [canChat, setCanChat] = useState<SocialGroupPermission>('members');
  const [canInvite, setCanInvite] = useState<SocialGroupPermission>('mods');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const [selected, setSelected] = useState<{ id: string; username: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setName('');
      setDescription('');
      setPrivacy('private');
      setCanPost('members');
      setCanChat('members');
      setCanInvite('mods');
      setSearch('');
      setResults([]);
      setSelected([]);
      setSaving(false);
    }
  }, [visible]);

  const searchUsers = useCallback(async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const { data } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .ilike('username', `%${q.trim()}%`)
      .neq('id', currentUserId)
      .limit(12);
    setResults((data ?? []) as typeof results);
  }, [currentUserId, results]);

  const toggleSelected = (user: { id: string; username: string }) => {
    setSelected(prev => prev.some(item => item.id === user.id)
      ? prev.filter(item => item.id !== user.id)
      : [...prev, user]);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onCreate({
      name: name.trim(),
      description: description.trim(),
      privacy,
      memberIds: selected.map(item => item.id),
      canPost,
      canChat,
      canInvite,
    });
    setSaving(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={handleDismiss}>
      <View style={styles.modalOverlay}>
        <Pressable style={{ flex: 1 }} onPress={handleDismiss} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0}
        >
          <View style={[styles.modalSheet, styles.communitySheet]}>
            <View style={styles.sheetHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create community</Text>
              <TouchableOpacity onPress={handleDismiss}><Ionicons name="close" size={22} color="#aaa" /></TouchableOpacity>
            </View>

            <ScrollView
              style={styles.communityScroll}
              contentContainerStyle={styles.communityScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
            >
            <TextInput
              style={styles.input}
              placeholder="Community name"
              placeholderTextColor="#777"
              value={name}
              onChangeText={setName}
              autoFocus
              returnKeyType="next"
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What is this group for?"
              placeholderTextColor="#777"
              multiline
              value={description}
              onChangeText={setDescription}
            />

            <SectionHeader title="Privacy" subtitle="Who can discover and open the community" />
            <View style={styles.choiceRow}>
              <ChoicePill label="Public" active={privacy === 'public'} onPress={() => setPrivacy('public')} />
              <ChoicePill label="Private" active={privacy === 'private'} onPress={() => setPrivacy('private')} />
              <ChoicePill label="Invite only" active={privacy === 'invite_only'} onPress={() => setPrivacy('invite_only')} />
            </View>

            <SectionHeader title="Permissions" subtitle="Moderation defaults for posts, chat, and invites" />
            <Text style={styles.permissionLabel}>Who can post?</Text>
            <View style={styles.choiceRow}>
              <ChoicePill label="Members" active={canPost === 'members'} onPress={() => setCanPost('members')} />
              <ChoicePill label="Mods only" active={canPost === 'mods'} onPress={() => setCanPost('mods')} />
            </View>
            <Text style={styles.permissionLabel}>Who can chat?</Text>
            <View style={styles.choiceRow}>
              <ChoicePill label="Members" active={canChat === 'members'} onPress={() => setCanChat('members')} />
              <ChoicePill label="Mods only" active={canChat === 'mods'} onPress={() => setCanChat('mods')} />
            </View>
            <Text style={styles.permissionLabel}>Who can invite?</Text>
            <View style={styles.choiceRow}>
              <ChoicePill label="Members" active={canInvite === 'members'} onPress={() => setCanInvite('members')} />
              <ChoicePill label="Mods only" active={canInvite === 'mods'} onPress={() => setCanInvite('mods')} />
            </View>

            <SectionHeader title="Invite people" subtitle="Add initial members now or invite them later" />
            <TextInput
              style={styles.input}
              placeholder="Search usernames"
              placeholderTextColor="#777"
              value={search}
              onChangeText={searchUsers}
            />

            {selected.length > 0 ? (
              <View style={styles.selectedWrap}>
                {selected.map(item => (
                  <TouchableOpacity key={item.id} style={styles.selectedChip} onPress={() => toggleSelected(item)}>
                    <Text style={styles.selectedChipText}>{item.username}</Text>
                    <Ionicons name="close-circle" size={14} color="#fff" />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {results.map(item => {
              const picked = selected.some(user => user.id === item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.userRow, picked && styles.userRowSelected]}
                  onPress={() => toggleSelected(item)}
                >
                  <Avatar uri={item.avatar_url} icon="person" size={40} />
                  <Text style={styles.userName}>{item.username}</Text>
                  <Ionicons name={picked ? 'checkmark-circle' : 'add-circle-outline'} size={18} color="#ff6a2f" />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

            <View style={styles.communityFooter}>
              <TouchableOpacity
                style={[styles.primaryBtn, styles.primaryBtnNoMargin, (!name.trim() || saving) && { opacity: 0.45 }]}
                disabled={!name.trim() || saving}
                onPress={handleCreate}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Create community</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default function ChatTab() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { user } = useAuth();
  const {
    rooms,
    roomsLoad,
    fetchRooms,
    getOrCreateDM,
  } = useChat(user?.id);
  const {
    groups,
    discoverableGroups,
    pendingInvites,
    loading: groupsLoad,
    refreshing: groupsRefreshing,
    refreshGroups,
    createGroup,
    acceptInvite,
    declineInvite,
  } = useSocialGroups(user?.id);

  const initialTab: 'all' | 'marketplace' | 'dm' | 'groups' = params.tab === 'groups' || params.tab === 'marketplace' || params.tab === 'dm' || params.tab === 'all'
    ? params.tab
    : 'all';
  const [tab, setTab] = useState<'all' | 'marketplace' | 'dm' | 'groups'>(initialTab);
  const [search, setSearch] = useState('');
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewCommunity, setShowNewCommunity] = useState(false);
  const [expandedBundles, setExpandedBundles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (params.tab === 'groups' || params.tab === 'marketplace' || params.tab === 'dm' || params.tab === 'all') {
      setTab(params.tab);
    }
  }, [params.tab]);

  const openRoom = (roomId: string) => router.push(`/chat/${roomId}` as any);
  const openGroup = (groupId: string) => router.push(`/group/${groupId}` as any);

  const resolveCreatedGroupId = useCallback(async (candidateId: string | null, candidateName: string) => {
    const normalizedName = candidateName.trim().toLowerCase();
    if (!user?.id) return candidateId;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (candidateId) {
        const { data: directMembership } = await supabase
          .from('social_group_members')
          .select('group_id')
          .eq('user_id', user.id)
          .eq('group_id', candidateId)
          .maybeSingle();

        if (directMembership?.group_id) {
          return directMembership.group_id as string;
        }
      }

      const { data: membershipRows } = await supabase
        .from('social_group_members')
        .select(`
          joined_at,
          group:group_id ( id, name )
        `)
        .eq('user_id', user.id)
        .order('joined_at', { ascending: false })
        .limit(12);

      const nameMatch = (membershipRows ?? []).find((row: any) => {
        const group = Array.isArray(row.group) ? (row.group[0] ?? null) : row.group;
        return (group?.name ?? '').trim().toLowerCase() === normalizedName;
      });

      const matchedGroup = nameMatch
        ? (Array.isArray((nameMatch as any).group) ? ((nameMatch as any).group[0] ?? null) : (nameMatch as any).group)
        : null;

      if (matchedGroup?.id) {
        return matchedGroup.id as string;
      }

      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }

    return candidateId;
  }, [user?.id]);

  const handleNewDM = async (otherUserId: string) => {
    const roomId = await getOrCreateDM(otherUserId);
    if (roomId) openRoom(roomId);
    else Alert.alert('Error', 'Could not open direct message');
  };

  const handleCreateCommunity = async (payload: {
    name: string;
    description: string;
    privacy: SocialGroupPrivacy;
    memberIds: string[];
    canPost: SocialGroupPermission;
    canChat: SocialGroupPermission;
    canInvite: SocialGroupPermission;
  }) => {
    Keyboard.dismiss();
    const groupId = await createGroup(payload);
    if (!groupId) {
      Alert.alert('Error', 'Could not create community');
      return;
    }

    await refreshGroups();
    const resolvedGroupId = await resolveCreatedGroupId(String(groupId), payload.name);

    setShowNewCommunity(false);

    if (!resolvedGroupId) {
      Alert.alert('Community created', 'The community was created, but opening it failed. Pull to refresh and open it from the Groups tab.');
      return;
    }

    openGroup(resolvedGroupId);
  };

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(room => {
      const display = getRoomDisplayName(room, user?.id ?? '').toLowerCase();
      const listingTitle = room.listing?.title?.toLowerCase() ?? '';
      const preview = (room.last_message ?? '').toLowerCase();
      return display.includes(q) || listingTitle.includes(q) || preview.includes(q);
    });
  }, [rooms, search, user?.id]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(group => {
      const hay = `${group.name} ${group.description ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [groups, search]);

  const filteredPendingInvites = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pendingInvites;
    return pendingInvites.filter(invite => {
      const hay = `${invite.group?.name ?? ''} ${invite.group?.description ?? ''} ${invite.inviter?.username ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [pendingInvites, search]);

  const filteredDiscoverableGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return discoverableGroups;
    return discoverableGroups.filter(group => {
      const hay = `${group.name} ${group.description ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [discoverableGroups, search]);

  const dmRooms = useMemo(
    () => filteredRooms.filter(room => room.type === 'dm'),
    [filteredRooms]
  );

  const adHocGroupChats = useMemo(
    () => filteredRooms.filter(room => room.type === 'group' && !room.social_group_id),
    [filteredRooms]
  );

  const marketplaceBundles = useMemo(() => {
    const bundles = new Map<string, { sellerName: string; sellerAvatar: string | null; rooms: ChatRoom[] }>();
    const marketplaceRooms = filteredRooms.filter(room => room.type === 'marketplace');

    for (const room of marketplaceRooms) {
      const other = room.members?.find(member => member.user_id !== user?.id);
      const sellerName = other?.user?.username ?? 'Marketplace Seller';
      const sellerAvatar = other?.user?.avatar_url ?? null;
      const key = other?.user_id ?? sellerName;
      if (!bundles.has(key)) {
        bundles.set(key, { sellerName, sellerAvatar, rooms: [] });
      }
      bundles.get(key)!.rooms.push(room);
    }

    return Array.from(bundles.entries())
      .map(([key, value]) => ({ key, ...value, rooms: value.rooms.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')) }))
      .sort((a, b) => (b.rooms[0]?.updated_at || '').localeCompare(a.rooms[0]?.updated_at || ''));
  }, [filteredRooms, user?.id]);

  const onRefresh = async () => {
    await Promise.all([fetchRooms(), refreshGroups()]);
  };

  const handleAcceptInvite = async (invite: SocialGroupInvite) => {
    const ok = await acceptInvite(invite.id);
    if (!ok) {
      Alert.alert('Error', 'Could not accept the invite.');
      return;
    }
    openGroup(invite.group_id);
  };

  const handleDeclineInvite = async (invite: SocialGroupInvite) => {
    const ok = await declineInvite(invite.id);
    if (!ok) {
      Alert.alert('Error', 'Could not decline the invite.');
    }
  };

  const isRefreshing = roomsLoad || groupsRefreshing;
  const isLoading = roomsLoad || groupsLoad;

  const renderMarketplace = () => {
    if (marketplaceBundles.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="storefront-outline" size={48} color="#2f2f2f" />
          <Text style={styles.emptyTitle}>No marketplace threads yet</Text>
          <Text style={styles.emptySubtitle}>Chats from the same seller will collapse together here.</Text>
        </View>
      );
    }

    return marketplaceBundles.map(bundle => (
      <MarketplaceBundleCard
        key={bundle.key}
        sellerName={bundle.sellerName}
        sellerAvatar={bundle.sellerAvatar}
        rooms={bundle.rooms}
        expanded={search.trim().length > 0 || !!expandedBundles[bundle.key]}
        onToggle={() => setExpandedBundles(prev => ({ ...prev, [bundle.key]: !prev[bundle.key] }))}
        onOpenRoom={openRoom}
      />
    ));
  };

  const renderDMs = () => {
    if (dmRooms.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="paper-plane-outline" size={48} color="#2f2f2f" />
          <Text style={styles.emptyTitle}>No direct messages yet</Text>
          <Text style={styles.emptySubtitle}>Tap the compose button to message another pilot.</Text>
        </View>
      );
    }

    return dmRooms.map(room => (
      <ConversationRow
        key={room.id}
        title={getRoomDisplayName(room, user?.id ?? '')}
        subtitle={room.last_message ?? 'Start the conversation'}
        time={timeAgo(room.last_message_at)}
        unreadCount={room.unread_count}
        avatarUri={getRoomAvatar(room, user?.id ?? '')}
        icon="person"
        onPress={() => openRoom(room.id)}
      />
    ));
  };

  const renderGroups = () => {
    if (
      filteredPendingInvites.length === 0
      && filteredGroups.length === 0
      && filteredDiscoverableGroups.length === 0
      && adHocGroupChats.length === 0
    ) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={48} color="#2f2f2f" />
          <Text style={styles.emptyTitle}>No communities yet</Text>
          <Text style={styles.emptySubtitle}>Create a moderated team space with posts, members, and group chat.</Text>
          <TouchableOpacity style={styles.emptyCtaBtn} onPress={() => setShowNewCommunity(true)}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.emptyCtaText}>Create community</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <>
        {filteredPendingInvites.length > 0 ? <SectionHeader title="Invites" subtitle="Accept or decline before you join a community" /> : null}
        {filteredPendingInvites.map(invite => (
          <PendingInviteCard
            key={invite.id}
            invite={invite}
            onAccept={() => handleAcceptInvite(invite)}
            onDecline={() => handleDeclineInvite(invite)}
          />
        ))}

        {filteredGroups.length > 0 ? <SectionHeader title="Your communities" subtitle="Posts, moderation, and a linked group chat" /> : null}
        {filteredGroups.map(group => (
          <ConversationRow
            key={group.id}
            title={group.name}
            subtitle={group.description || `${group.member_count ?? 1} members • ${group.privacy.replace('_', ' ')}`}
            time={timeAgo(group.updated_at)}
            avatarUri={group.avatar_url}
            icon="people"
            badge={(group.my_role ?? 'member').toUpperCase()}
            onPress={() => openGroup(group.id)}
          />
        ))}

        {filteredDiscoverableGroups.length > 0 ? <SectionHeader title="Discover communities" subtitle="Public communities you can open even before joining" /> : null}
        {filteredDiscoverableGroups.map(group => (
          <ConversationRow
            key={`discover-${group.id}`}
            title={group.name}
            subtitle={group.description || `${group.member_count ?? 1} members • ${group.privacy.replace('_', ' ')}`}
            time={timeAgo(group.updated_at)}
            avatarUri={group.avatar_url}
            icon="compass-outline"
            badge="OPEN"
            onPress={() => openGroup(group.id)}
          />
        ))}

        {adHocGroupChats.length > 0 ? <SectionHeader title="Group chats" subtitle="Standalone group threads without a community feed" /> : null}
        {adHocGroupChats.map(room => (
          <ConversationRow
            key={room.id}
            title={room.name ?? 'Group Chat'}
            subtitle={room.last_message ?? 'Open group chat'}
            time={timeAgo(room.last_message_at)}
            unreadCount={room.unread_count}
            avatarUri={room.avatar_url}
            icon="people"
            onPress={() => openRoom(room.id)}
          />
        ))}
      </>
    );
  };

  const renderAll = () => {
    const hasAnything = marketplaceBundles.length || dmRooms.length || filteredPendingInvites.length || filteredGroups.length || filteredDiscoverableGroups.length || adHocGroupChats.length;

    if (!hasAnything) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="chatbubbles-outline" size={54} color="#2f2f2f" />
          <Text style={styles.emptyTitle}>Your inbox is clean</Text>
          <Text style={styles.emptySubtitle}>Marketplace chats now group by seller, and communities live in their own section.</Text>
        </View>
      );
    }

    return (
      <>
        {marketplaceBundles.length > 0 ? <SectionHeader title="Marketplace" subtitle="Collapsed by seller to keep your inbox tidy" /> : null}
        {renderMarketplace()}

        {dmRooms.length > 0 ? <SectionHeader title="Direct messages" subtitle="1:1 pilot conversations" /> : null}
        {dmRooms.slice(0, 6).map(room => (
          <ConversationRow
            key={room.id}
            title={getRoomDisplayName(room, user?.id ?? '')}
            subtitle={room.last_message ?? 'Start the conversation'}
            time={timeAgo(room.last_message_at)}
            unreadCount={room.unread_count}
            avatarUri={getRoomAvatar(room, user?.id ?? '')}
            icon="person"
            onPress={() => openRoom(room.id)}
          />
        ))}

        {(filteredPendingInvites.length > 0 || filteredGroups.length > 0 || filteredDiscoverableGroups.length > 0 || adHocGroupChats.length > 0) ? <SectionHeader title="Groups" subtitle="Invites first, then your communities, public communities, and classic group chats" /> : null}
        {filteredPendingInvites.slice(0, 2).map(invite => (
          <PendingInviteCard
            key={invite.id}
            invite={invite}
            onAccept={() => handleAcceptInvite(invite)}
            onDecline={() => handleDeclineInvite(invite)}
          />
        ))}
        {filteredGroups.slice(0, 4).map(group => (
          <ConversationRow
            key={group.id}
            title={group.name}
            subtitle={group.description || `${group.member_count ?? 1} members`}
            time={timeAgo(group.updated_at)}
            avatarUri={group.avatar_url}
            icon="people"
            badge={(group.my_role ?? 'member').toUpperCase()}
            onPress={() => openGroup(group.id)}
          />
        ))}
        {filteredDiscoverableGroups.slice(0, 3).map(group => (
          <ConversationRow
            key={`discover-all-${group.id}`}
            title={group.name}
            subtitle={group.description || `${group.member_count ?? 1} members • public`}
            time={timeAgo(group.updated_at)}
            avatarUri={group.avatar_url}
            icon="compass-outline"
            badge="OPEN"
            onPress={() => openGroup(group.id)}
          />
        ))}
        {adHocGroupChats.slice(0, 3).map(room => (
          <ConversationRow
            key={room.id}
            title={room.name ?? 'Group Chat'}
            subtitle={room.last_message ?? 'Open group chat'}
            time={timeAgo(room.last_message_at)}
            unreadCount={room.unread_count}
            avatarUri={room.avatar_url}
            icon="people"
            onPress={() => openRoom(room.id)}
          />
        ))}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Messages</Text>
          <Text style={styles.headerSubtitle}>Cleaner inbox, grouped marketplace threads, and real communities.</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewCommunity(true)}>
            <Ionicons name="people-outline" size={22} color="#ff6a2f" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setShowNewDM(true)}>
            <Ionicons name="create-outline" size={22} color="#ff6a2f" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color="#666" />
        <TextInput
          style={styles.searchField}
          placeholder="Search chats or communities…"
          placeholderTextColor="#666"
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#666" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.tabsWrap}>
        {[
          { key: 'all', label: 'All' },
          { key: 'marketplace', label: 'Marketplace' },
          { key: 'dm', label: 'DMs' },
          { key: 'groups', label: 'Groups' },
        ].map(item => (
          <TouchableOpacity
            key={item.key}
            style={[styles.tabBtn, tab === item.key && styles.tabBtnActive]}
            onPress={() => setTab(item.key as typeof tab)}
          >
            <Text style={[styles.tabBtnText, tab === item.key && styles.tabBtnTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading && rooms.length === 0 && groups.length === 0 && discoverableGroups.length === 0 ? (
        <ActivityIndicator color="#ff6a2f" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#ff6a2f" />}
        >
          {tab === 'all' && renderAll()}
          {tab === 'marketplace' && renderMarketplace()}
          {tab === 'dm' && renderDMs()}
          {tab === 'groups' && renderGroups()}
        </ScrollView>
      )}

      <NewDMModal
        visible={showNewDM}
        onClose={() => setShowNewDM(false)}
        currentUserId={user?.id ?? ''}
        onSelect={handleNewDM}
      />

      <NewCommunityModal
        visible={showNewCommunity}
        onClose={() => setShowNewCommunity(false)}
        currentUserId={user?.id ?? ''}
        onCreate={handleCreateCommunity}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    gap: 12,
  },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#fff' },
  headerSubtitle: { color: '#7b7b7b', fontSize: 13, lineHeight: 18, marginTop: 4, maxWidth: 260 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#171717',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#232323',
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151515',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#222',
  },
  searchField: { flex: 1, color: '#fff', fontSize: 15 },


  tabsWrap: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#131313',
    borderWidth: 1,
    borderColor: '#242424',
  },
  tabBtnActive: { backgroundColor: '#26150c', borderColor: '#7a3d22' },
  tabBtnText: { color: '#a3a3a3', fontSize: 13, fontWeight: '600' },
  tabBtnTextActive: { color: '#ff9b68' },

  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionHeader: { marginTop: 14, marginBottom: 10 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sectionSubtitle: { color: '#707070', fontSize: 12, marginTop: 2 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1d1d1d',
    marginBottom: 10,
  },
  inviteCard: {
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2c2140',
    padding: 14,
    marginBottom: 10,
  },
  inviteTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inviteTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#241633',
    borderWidth: 1,
    borderColor: '#4e3a73',
  },
  inviteBadgeText: { color: '#c4b5fd', fontSize: 10, fontWeight: '800' },
  inviteMeta: { color: '#7e7e7e', fontSize: 12, marginTop: 6 },
  inviteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  inviteDeclineBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    backgroundColor: '#151515',
  },
  inviteDeclineText: { color: '#b3b3b3', fontSize: 13, fontWeight: '700' },
  inviteAcceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
  },
  inviteAcceptText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  rowMeta: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  rowTitle: { flex: 1, color: '#ececec', fontSize: 15, fontWeight: '600' },
  rowTitleUnread: { color: '#fff', fontWeight: '700' },
  rowSubtitle: { flex: 1, color: '#7e7e7e', fontSize: 13 },
  rowSubtitleUnread: { color: '#b7b7b7' },
  rowTime: { color: '#646464', fontSize: 12 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#1d2938',
  },
  badgeText: { color: '#9cc8ff', fontSize: 10, fontWeight: '700' },
  unreadPill: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ff6a2f',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadPillText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  avatarFallback: { backgroundColor: '#1d1d1d', justifyContent: 'center', alignItems: 'center' },

  bundleCard: {
    backgroundColor: '#111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1d1d1d',
    marginBottom: 12,
    overflow: 'hidden',
  },
  bundleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  bundleHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  bundleHeaderRight: { alignItems: 'flex-end', gap: 6 },
  bundleTime: { color: '#686868', fontSize: 12 },
  bundleAvatarWrap: { position: 'relative' },
  marketBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ff6a2f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bundleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bundleTitle: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700' },
  bundleSubtitle: { color: '#8b8b8b', fontSize: 13, marginTop: 4 },
  bundleChildren: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#232323',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  bundleChildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1d1d1d',
  },
  bundleThreadIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1d120d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bundleChildTitle: { color: '#ececec', fontSize: 14, fontWeight: '600' },
  bundleChildSubtitle: { color: '#777', fontSize: 12, marginTop: 2 },
  bundleChildTime: { color: '#626262', fontSize: 11 },

  emptyState: {
    paddingTop: 70,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyTitle: { color: '#f1f1f1', fontSize: 18, fontWeight: '700', marginTop: 14 },
  emptySubtitle: { color: '#6f6f6f', fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  emptyCtaBtn: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ff6a2f',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
  },
  emptyCtaText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#101010',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%',
  },
  communitySheet: {
    maxHeight: '86%',
    overflow: 'hidden',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#2d2d2d',
    marginTop: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#212121',
  },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },

  input: {
    backgroundColor: '#171717',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#242424',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    fontSize: 15,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  communityScroll: { flex: 1 },
  communityScrollContent: { paddingBottom: 18 },
  communityFooter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 18 : 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#212121',
    backgroundColor: '#101010',
  },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  choicePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#272727',
  },
  choicePillActive: { backgroundColor: '#29160e', borderColor: '#8a4729' },
  choicePillText: { color: '#a0a0a0', fontSize: 12, fontWeight: '600' },
  choicePillTextActive: { color: '#ff9b68' },
  permissionLabel: { color: '#cfcfcf', fontSize: 13, fontWeight: '600', paddingHorizontal: 16, marginTop: 10, marginBottom: 6 },

  selectedWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ff6a2f',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  selectedChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f1f1f',
  },
  userRowSelected: { backgroundColor: '#17120f' },
  userName: { flex: 1, color: '#f1f1f1', fontSize: 15, fontWeight: '500' },
  emptySearch: { color: '#666', textAlign: 'center', padding: 20 },

  primaryBtn: {
    marginHorizontal: 16,
    marginTop: 18,
    backgroundColor: '#ff6a2f',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnNoMargin: {
    marginHorizontal: 0,
    marginTop: 0,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
