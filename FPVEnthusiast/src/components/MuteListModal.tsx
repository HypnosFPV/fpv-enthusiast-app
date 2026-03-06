// src/components/MuteListModal.tsx
import React from 'react';
import {
  Modal, View, Text, FlatList, TouchableOpacity,
  Image, StyleSheet, Alert, ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MutedUser } from '../hooks/useMute';

interface Props {
  visible: boolean;
  onClose: () => void;
  mutedUsers: MutedUser[];
  loading: boolean;
  onUnmute: (userId: string) => Promise<void>;
}

export default function MuteListModal({
  visible,
  onClose,
  mutedUsers,
  loading,
  onUnmute,
}: Props) {
  const handleUnmute = (user: MutedUser) => {
    Alert.alert(
      'Unmute User',
      `Unmute @${user.username ?? 'this user'}? Their posts will appear in your feed again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unmute', onPress: () => onUnmute(user.id) },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Muted Users</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#00d4ff" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={mutedUsers}
            keyExtractor={(item: MutedUser) => item.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="volume-mute-outline" size={48} color="#444" />
                <Text style={styles.emptyText}>No muted users</Text>
              </View>
            }
            renderItem={({ item }: { item: MutedUser }) => (
              <View style={styles.row}>
                {item.avatar_url ? (
                  <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Ionicons name="person" size={20} color="#555" />
                  </View>
                )}
                <Text style={styles.username}>@{item.username ?? 'unknown'}</Text>
                <TouchableOpacity
                  style={styles.unmuteBtn}
                  onPress={() => handleUnmute(item)}
                >
                  <Text style={styles.unmuteBtnText}>Unmute</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: '#1a1a2e',
  },
  title:   { color: '#fff', fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 4 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: '#1a1a2e',
  },
  avatar:            { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },
  username:          { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },

  unmuteBtn: {
    backgroundColor: '#1a1a2e', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: '#2a2a4a',
  },
  unmuteBtnText: { color: '#00d4ff', fontWeight: '600', fontSize: 13 },

  empty:     { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#555', marginTop: 12, fontSize: 15 },
});
