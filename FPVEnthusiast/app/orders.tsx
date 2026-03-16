// app/orders.tsx
// My Orders — Purchases & Sales dashboard
// Shows all non-pending orders grouped by tab, with status, amounts, other party

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, Image,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { useOrders, OrderSummary, OrderStatus } from '../src/hooks/useOrders';

const { width: W } = Dimensions.get('window');

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS: Record<OrderStatus, { label: string; color: string; icon: string }> = {
  pending:   { label: 'Pending',   color: '#f59e0b', icon: 'time-outline' },
  paid:      { label: 'Paid',      color: '#3b82f6', icon: 'card-outline' },
  shipped:   { label: 'Shipped',   color: '#8b5cf6', icon: 'cube-outline' },
  delivered: { label: 'Delivered', color: '#10b981', icon: 'checkmark-circle-outline' },
  completed: { label: 'Completed', color: '#22c55e', icon: 'checkmark-done-outline' },
  cancelled: { label: 'Cancelled', color: '#6b7280', icon: 'close-circle-outline' },
  disputed:  { label: 'Disputed',  color: '#ef4444', icon: 'warning-outline' },
  resolved:  { label: 'Resolved',  color: '#14b8a6', icon: 'shield-checkmark-outline' },
};

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)   return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

// ─── Order card ───────────────────────────────────────────────────────────────
function OrderCard({ order, onPress }: { order: OrderSummary; onPress: () => void }) {
  const cfg = STATUS[order.status] ?? STATUS.pending;
  const amountLabel = order.role === 'buyer'
    ? fmt(order.amount_cents)
    : fmt(order.seller_payout_cents);
  const amountSuffix = order.role === 'buyer' ? 'paid' : 'payout';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.78}>
      {/* Listing image */}
      {order.listing_image ? (
        <Image source={{ uri: order.listing_image }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Ionicons name="image-outline" size={24} color="#444" />
        </View>
      )}

      {/* Middle content */}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{order.listing_title}</Text>

        <View style={styles.partyRow}>
          {order.other_avatar ? (
            <Image source={{ uri: order.other_avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={12} color="#666" />
            </View>
          )}
          <Text style={styles.partyLabel}>
            {order.role === 'buyer' ? 'Seller: ' : 'Buyer: '}
            <Text style={styles.partyName}>{order.other_username}</Text>
          </Text>
        </View>

        <View style={styles.cardFooter}>
          {/* Status badge */}
          <View style={[styles.statusBadge, { backgroundColor: cfg.color + '22', borderColor: cfg.color }]}>
            <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
            <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>

          <Text style={styles.timeAgo}>{timeAgo(order.created_at)}</Text>
        </View>
      </View>

      {/* Right: amount */}
      <View style={styles.cardRight}>
        <Text style={styles.amount}>{amountLabel}</Text>
        <Text style={styles.amountSub}>{amountSuffix}</Text>
        <Ionicons name="chevron-forward" size={16} color="#555" style={{ marginTop: 8 }} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ tab }: { tab: 'purchases' | 'sales' }) {
  const router = useRouter();
  return (
    <View style={styles.empty}>
      <Ionicons name={tab === 'purchases' ? 'bag-outline' : 'pricetag-outline'} size={52} color="#333" />
      <Text style={styles.emptyTitle}>
        {tab === 'purchases' ? 'No purchases yet' : 'No sales yet'}
      </Text>
      <Text style={styles.emptyBody}>
        {tab === 'purchases'
          ? 'When you buy something from the marketplace it shows up here.'
          : 'When a buyer completes checkout on one of your listings it shows up here.'}
      </Text>
      {tab === 'purchases' && (
        <TouchableOpacity
          style={styles.browseBtn}
          onPress={() => router.push('/(tabs)/marketplace')}
        >
          <Text style={styles.browseBtnText}>Browse Marketplace</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function OrdersScreen() {
  const router = useRouter();
  const { user } = useAuth() as { user: { id: string } | null };
  const {
    purchases, sales, loading, refreshing,
    activeTab, setActiveTab, refresh,
  } = useOrders(user?.id);

  const orders = activeTab === 'purchases' ? purchases : sales;

  const navigateToListing = useCallback((order: OrderSummary) => {
    router.push(`/listing/${order.listing_id}`);
  }, [router]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#00d4ff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tab switcher */}
      <View style={styles.tabs}>
        {(['purchases', 'sales'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Ionicons
              name={tab === 'purchases' ? 'bag-outline' : 'pricetag-outline'}
              size={15}
              color={activeTab === tab ? '#00d4ff' : '#888'}
            />
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'purchases' ? 'Purchases' : 'Sales'}
              {tab === 'purchases' && purchases.length > 0 && (
                <Text style={styles.tabCount}> {purchases.length}</Text>
              )}
              {tab === 'sales' && sales.length > 0 && (
                <Text style={styles.tabCount}> {sales.length}</Text>
              )}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {loading && orders.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#00d4ff" />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o.id}
          renderItem={({ item }) => (
            <OrderCard order={item} onPress={() => navigateToListing(item)} />
          )}
          ListEmptyComponent={<EmptyState tab={activeTab} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor="#00d4ff"
              colors={['#00d4ff']}
            />
          }
          contentContainerStyle={orders.length === 0 ? styles.listEmpty : styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#0a0a0a' },
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                       paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  backBtn:          { width: 40, alignItems: 'flex-start' },
  headerTitle:      { fontSize: 18, fontWeight: '700', color: '#fff' },

  tabs:             { flexDirection: 'row', backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  tab:              { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                       gap: 6, paddingVertical: 12 },
  tabActive:        { borderBottomWidth: 2, borderBottomColor: '#00d4ff' },
  tabText:          { fontSize: 14, color: '#888', fontWeight: '600' },
  tabTextActive:    { color: '#00d4ff' },
  tabCount:         { color: '#555', fontWeight: '400' },

  center:           { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:             { paddingVertical: 8 },
  listEmpty:        { flex: 1 },
  separator:        { height: 1, backgroundColor: '#1a1a2e', marginLeft: 80 },

  card:             { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  thumb:            { width: 64, height: 64, borderRadius: 10, backgroundColor: '#1a1a1a' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody:         { flex: 1, gap: 4 },
  cardTitle:        { fontSize: 14, fontWeight: '600', color: '#fff', lineHeight: 18 },
  partyRow:         { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar:           { width: 18, height: 18, borderRadius: 9, backgroundColor: '#1a1a1a' },
  avatarPlaceholder:{ alignItems: 'center', justifyContent: 'center' },
  partyLabel:       { fontSize: 12, color: '#666' },
  partyName:        { color: '#aaa', fontWeight: '600' },
  cardFooter:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  statusBadge:      { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1,
                       borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  statusText:       { fontSize: 11, fontWeight: '700' },
  timeAgo:          { fontSize: 11, color: '#555' },

  cardRight:        { alignItems: 'flex-end', gap: 2 },
  amount:           { fontSize: 15, fontWeight: '700', color: '#00d4ff' },
  amountSub:        { fontSize: 11, color: '#666' },

  empty:            { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyTitle:       { fontSize: 18, fontWeight: '700', color: '#fff' },
  emptyBody:        { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  browseBtn:        { marginTop: 8, backgroundColor: '#0057d9', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  browseBtnText:    { color: '#fff', fontWeight: '700', fontSize: 14 },
});
