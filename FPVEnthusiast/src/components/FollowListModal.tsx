// src/components/FollowListModal.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal, View, Text, FlatList, TouchableOpacity,
  Image, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFollow, FollowUser } from '../hooks/useFollow';

interface Props {
  visible:        boolean;
  type:           'followers' | 'following';
  profileUserId:  string;
  currentUserId:  string;
  onClose:        () => void;
  onCountChange?: () => void;
}

export default function FollowListModal({
  visible, type, profileUserId, currentUserId, onClose, onCountChange,
}: Props) {
  const router = useRouter();
  const { fetchFollowers, fetchFollowing, removeFollower, unfollowUser } =
    useFollow(profileUserId, currentUserId);

  const [list,    setList]    = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = type === 'followers'
      ? await fetchFollowers()
      : await fetchFollowing();
    setList(data);
    setLoading(false);
  }, [type, fetchFollowers, fetchFollowing]);

  useEffect(() => {
    if (visible) load();
    else setList([]);
  }, [visible, load]);

  const handleAction = useCallback((item: FollowUser) => {
    const label   = type === 'followers' ? 'Remove follower' : 'Unfollow';
    const message = type === 'followers'
      ? `Remove @${item.username} from your followers?`
      : `Unfollow @${item.username}?`;

    Alert.alert(label, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        style: 'destructive',
        onPress: async () => {
          if (type === 'followers') {
            await removeFollower(item.id);
          } else {
            await unfollowUser(item.id);
          }
          setList(prev => prev.filter(u => u.id !== item.id));
          onCountChange?.();
        },
      },
    ]);
  }, [type, removeFollower, unfollowUser, onCountChange]);

  // ── FIX: use Expo Router's typed href object instead of a string template ──
  const goToProfile = useCallback((username: string) => {
    onClose();
    router.push({
      pathname: '/profile/[username]',
      params: { username },
    });
  }, [router, onClose]);

  const renderItem = ({ item }: { item: FollowUser }) => (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.userInfo}
        onPress={() => goToProfile(item.username)}
        activeOpacity={0.7}
      >
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={18} color="#555" />
          </View>
        )}
        <Text style={styles.username}>@{item.username}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.actionBtn}
        onPress={() => handleAction(item)}
        activeOpacity={0.8}
      >
        <Text style={styles.actionBtnText}>
          {type === 'followers' ? 'Remove' : 'Unfollow'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>
            {type === 'followers' ? 'Followers' : 'Following'}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#7c3aed" size="large" />
          </View>
        ) : list.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="people-outline" size={48} color="#333" />
            <Text style={styles.emptyText}>
              {type === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={list}
            keyExtractor={u => u.id}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 40 }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#0f0f23' },
  header:           {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 52, paddingBottom: 12, paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e3a',
  },
  backBtn:          { padding: 4, width: 36 },
  title:            { color: '#fff', fontSize: 17, fontWeight: '700' },
  center:           { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText:        { color: '#555', marginTop: 12, fontSize: 14 },

  row:              { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  userInfo:         { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar:           { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarPlaceholder:{ backgroundColor: '#1e1e3a', alignItems: 'center', justifyContent: 'center' },
  username:         { color: '#fff', fontSize: 15, fontWeight: '600' },

  actionBtn:        {
    backgroundColor: '#1e1e3a', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: '#2e2e5a',
  },
  actionBtnText:    { color: '#e55', fontSize: 13, fontWeight: '600' },

  separator:        { height: StyleSheet.hairlineWidth, backgroundColor: '#1e1e3a', marginHorizontal: 16 },
});
