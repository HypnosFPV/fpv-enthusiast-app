// app/admin/index.tsx
// Admin dashboard — Featured Listings analytics
// Access: Settings → Admin (only shown if user has admin role)

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/services/supabase';

const SW = Dimensions.get('window').width;

type DailyStat = {
  day: string;
  props_boosts: number;
  paid_boosts: number;
  total_props_spent: number;
  total_usd: number;
};

type TopListing = {
  listing_id: string;
  title: string;
  total_boosts: number;
  total_props: number;
  total_usd: number;
};

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Summary totals
  const [totalPropsSpent, setTotalPropsSpent]   = useState(0);
  const [totalPaidUsd,    setTotalPaidUsd]       = useState(0);
  const [totalBoosts,     setTotalBoosts]        = useState(0);
  const [activeNow,       setActiveNow]          = useState(0);
  const [dailyStats,      setDailyStats]         = useState<DailyStat[]>([]);
  const [topListings,     setTopListings]        = useState<TopListing[]>([]);

  const load = useCallback(async () => {
    try {
      // 1. Summary
      const { data: summary } = await supabase
        .from('featured_purchases')
        .select('purchase_type, props_spent, amount_usd');

      if (summary) {
        setTotalBoosts(summary.length);
        setTotalPropsSpent(summary.reduce((s, r) => s + (r.props_spent ?? 0), 0));
        setTotalPaidUsd(summary.reduce((s, r) => s + (r.amount_usd ?? 0), 0));
      }

      // 2. Active now
      const { count } = await supabase
        .from('marketplace_listings')
        .select('id', { count: 'exact', head: true })
        .eq('is_featured', true)
        .gt('featured_until', new Date().toISOString());
      setActiveNow(count ?? 0);

      // 3. Daily stats (last 14 days)
      const { data: purchases } = await supabase
        .from('featured_purchases')
        .select('purchase_type, props_spent, amount_usd, created_at')
        .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
        .order('created_at', { ascending: true });

      if (purchases) {
        const dayMap: Record<string, DailyStat> = {};
        purchases.forEach(p => {
          const day = p.created_at.slice(0, 10);
          if (!dayMap[day]) dayMap[day] = { day, props_boosts: 0, paid_boosts: 0, total_props_spent: 0, total_usd: 0 };
          if (p.purchase_type === 'props') {
            dayMap[day].props_boosts++;
            dayMap[day].total_props_spent += p.props_spent ?? 0;
          } else {
            dayMap[day].paid_boosts++;
            dayMap[day].total_usd += p.amount_usd ?? 0;
          }
        });
        setDailyStats(Object.values(dayMap).slice(-10));
      }

      // 4. Top listings
      const { data: byListing } = await supabase
        .from('featured_purchases')
        .select('listing_id, props_spent, amount_usd, marketplace_listings(title)');

      if (byListing) {
        const map: Record<string, TopListing> = {};
        byListing.forEach((p: any) => {
          if (!map[p.listing_id]) map[p.listing_id] = {
            listing_id: p.listing_id,
            title: p.marketplace_listings?.title ?? 'Unknown',
            total_boosts: 0, total_props: 0, total_usd: 0,
          };
          map[p.listing_id].total_boosts++;
          map[p.listing_id].total_props += p.props_spent ?? 0;
          map[p.listing_id].total_usd   += p.amount_usd ?? 0;
        });
        setTopListings(Object.values(map).sort((a, b) => b.total_boosts - a.total_boosts).slice(0, 10));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#ffcc00" size="large" />
      </View>
    );
  }

  // Bar chart: max props per day
  const maxProps = Math.max(...dailyStats.map(d => d.total_props_spent), 1);

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffcc00" />}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>⚡ Featured Analytics</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Summary cards */}
      <View style={s.row}>
        <StatCard icon="flash" label="Total Boosts" value={totalBoosts.toString()} color="#ffcc00" />
        <StatCard icon="radio-button-on" label="Active Now" value={activeNow.toString()} color="#00e676" />
      </View>
      <View style={s.row}>
        <StatCard icon="logo-bitcoin" label="Props Spent" value={totalPropsSpent.toLocaleString()} color="#ff8c00" />
        <StatCard icon="card" label="Paid Revenue" value={`$${totalPaidUsd.toFixed(2)}`} color="#00d4ff" />
      </View>

      {/* Daily bar chart */}
      <Text style={s.sectionTitle}>Daily Props Spent (last 10 days)</Text>
      <View style={s.chart}>
        {dailyStats.map(d => {
          const barH = Math.max(4, Math.round((d.total_props_spent / maxProps) * 100));
          const dayLabel = d.day.slice(5); // MM-DD
          return (
            <View key={d.day} style={s.barCol}>
              <Text style={s.barVal}>{d.total_props_spent > 0 ? (d.total_props_spent / 1000).toFixed(1) + 'k' : ''}</Text>
              <View style={[s.bar, { height: barH }]} />
              <Text style={s.barLabel}>{dayLabel}</Text>
            </View>
          );
        })}
        {dailyStats.length === 0 && <Text style={{ color: '#666', fontSize: 13 }}>No data yet</Text>}
      </View>

      {/* Daily table */}
      <Text style={s.sectionTitle}>Daily Breakdown</Text>
      <View style={s.table}>
        <View style={[s.tableRow, s.tableHeader]}>
          <Text style={[s.tableCell, s.tableHd, { flex: 1.4 }]}>Date</Text>
          <Text style={[s.tableCell, s.tableHd]}>🌀 Boosts</Text>
          <Text style={[s.tableCell, s.tableHd]}>💳 Boosts</Text>
          <Text style={[s.tableCell, s.tableHd]}>Props</Text>
          <Text style={[s.tableCell, s.tableHd]}>USD</Text>
        </View>
        {dailyStats.slice().reverse().map(d => (
          <View key={d.day} style={s.tableRow}>
            <Text style={[s.tableCell, { flex: 1.4, color: '#ccc' }]}>{d.day.slice(5)}</Text>
            <Text style={[s.tableCell, { color: '#ffcc00' }]}>{d.props_boosts}</Text>
            <Text style={[s.tableCell, { color: '#00d4ff' }]}>{d.paid_boosts}</Text>
            <Text style={[s.tableCell, { color: '#ff8c00' }]}>{d.total_props_spent.toLocaleString()}</Text>
            <Text style={[s.tableCell, { color: '#00e676' }]}>${d.total_usd.toFixed(2)}</Text>
          </View>
        ))}
        {dailyStats.length === 0 && (
          <Text style={{ color: '#666', padding: 12, fontSize: 13 }}>No activity in last 14 days</Text>
        )}
      </View>

      {/* Top listings */}
      <Text style={s.sectionTitle}>Top Boosted Listings</Text>
      {topListings.map((l, i) => (
        <View key={l.listing_id} style={s.topRow}>
          <Text style={s.topRank}>#{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.topTitle} numberOfLines={1}>{l.title}</Text>
            <Text style={s.topMeta}>
              {l.total_boosts} boost{l.total_boosts !== 1 ? 's' : ''} · {l.total_props.toLocaleString()} props{l.total_usd > 0 ? ` · $${l.total_usd.toFixed(2)}` : ''}
            </Text>
          </View>
          <Text style={s.topBoostCount}>{l.total_boosts}×</Text>
        </View>
      ))}
      {topListings.length === 0 && <Text style={{ color: '#666', fontSize: 13 }}>No boosts yet</Text>}
    </ScrollView>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={[s.statCard, { borderColor: color + '44' }]}>
      <Ionicons name={icon as any} size={22} color={color} />
      <Text style={[s.statVal, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: '#0a0a0a' },
  center:       { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerTitle:  { color: '#fff', fontSize: 18, fontWeight: '700' },
  row:          { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard:     { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1 },
  statVal:      { fontSize: 22, fontWeight: '800' },
  statLabel:    { color: '#888', fontSize: 11, fontWeight: '600' },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  chart:        { flexDirection: 'row', alignItems: 'flex-end', height: 130, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, gap: 6 },
  barCol:       { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  bar:          { width: '100%', backgroundColor: '#ffcc00', borderRadius: 3, minHeight: 4 },
  barLabel:     { color: '#666', fontSize: 8 },
  barVal:       { color: '#ffcc0099', fontSize: 8 },
  table:        { backgroundColor: '#1a1a1a', borderRadius: 12, overflow: 'hidden' },
  tableRow:     { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#222' },
  tableHeader:  { backgroundColor: '#222' },
  tableHd:      { color: '#888', fontWeight: '700', fontSize: 11 },
  tableCell:    { flex: 1, fontSize: 12, textAlign: 'center' },
  topRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 8, gap: 10 },
  topRank:      { color: '#ffcc00', fontWeight: '800', fontSize: 16, width: 28 },
  topTitle:     { color: '#fff', fontSize: 13, fontWeight: '600' },
  topMeta:      { color: '#888', fontSize: 11, marginTop: 2 },
  topBoostCount:{ color: '#ffcc00', fontWeight: '800', fontSize: 18 },
});
