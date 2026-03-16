// app/(tabs)/admin.tsx
// Map Moderation Dashboard — admin-only screen for reviewing reported spots & events.
// Accessible via router.push('/(tabs)/admin') from the Profile screen (admin users only).

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, RefreshControl, ScrollView,
  StatusBar, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMapModeration, SpotReport, EventReport } from '../../src/hooks/useMapModeration';
import { supabase } from '../../src/services/supabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  wrong_type:      '🏷  Wrong type',
  wrong_hazard:    '⚠️  Wrong hazard',
  does_not_exist:  '❌  Doesn\'t exist',
  dangerous:       '☠️  Dangerous airspace',
  duplicate:       '📍 Duplicate pin',
  offensive_name:  '🤬  Offensive name',
  spam:            '📢  Spam',
  fake_event:      '🎭  Fake event',
  wrong_date:      '📅  Wrong date',
  other:           '💬  Other',
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function openMaps(lat: number, lng: number, name: string) {
  const encoded = encodeURIComponent(name);
  Linking.openURL(`https://maps.google.com/?q=${lat},${lng}(${encoded})`);
}

// ─── Reason badge ─────────────────────────────────────────────────────────────

function ReasonBadge({ reason }: { reason: string }) {
  return (
    <View style={styles.reasonBadge}>
      <Text style={styles.reasonBadgeTxt}>{REASON_LABELS[reason] ?? reason}</Text>
    </View>
  );
}

// ─── Spot report card ─────────────────────────────────────────────────────────

interface SpotCardProps {
  item:     SpotReport;
  actionId: string | null;
  onDismiss:  (r: SpotReport) => void;
  onDelete:   (r: SpotReport) => void;
  onVerify:   (r: SpotReport) => void;
}

function SpotReportCard({ item, actionId, onDismiss, onDelete, onVerify }: SpotCardProps) {
  const busy = actionId === item.report_id;
  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          {item.is_flagged   && <View style={styles.flagDot} />}
          {item.is_verified  && <Ionicons name="shield-checkmark" size={14} color="#00C853" style={{ marginRight: 4 }} />}
          <Text style={styles.cardTitle} numberOfLines={1}>{item.spot_name}</Text>
        </View>
        <View style={styles.typePill}>
          <Text style={styles.typePillTxt}>{item.spot_type}</Text>
        </View>
      </View>

      {/* Meta */}
      <Text style={styles.cardMeta}>
        📍 {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
        {'  ·  '}
        <Text style={{ color: '#FF9800' }}>🚩 {item.report_count} report{item.report_count !== 1 ? 's' : ''}</Text>
      </Text>
      {item.created_by_username && (
        <Text style={styles.cardMeta}>Added by @{item.created_by_username}</Text>
      )}
      <Text style={styles.cardMeta}>Reported {formatDate(item.reported_at)}{item.reporter_username ? ` by @${item.reporter_username}` : ''}</Text>

      <ReasonBadge reason={item.reason} />
      {item.details ? <Text style={styles.cardDetail}>"{item.details}"</Text> : null}

      {/* Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionBtnMap}
          onPress={() => openMaps(item.latitude, item.longitude, item.spot_name)}
        >
          <Ionicons name="map-outline" size={14} color="#2979FF" />
          <Text style={styles.actionBtnMapTxt}>Map</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtnGreen}
          onPress={() => onVerify(item)}
          disabled={!!busy}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : (
            <><Ionicons name="shield-checkmark-outline" size={14} color="#fff" /><Text style={styles.actionBtnTxt}>Verify</Text></>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtnNeutral}
          onPress={() => onDismiss(item)}
          disabled={!!busy}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : (
            <><Ionicons name="close-circle-outline" size={14} color="#fff" /><Text style={styles.actionBtnTxt}>Dismiss</Text></>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtnRed}
          onPress={() => onDelete(item)}
          disabled={!!busy}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : (
            <><Ionicons name="trash-outline" size={14} color="#fff" /><Text style={styles.actionBtnTxt}>Delete</Text></>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Event report card ────────────────────────────────────────────────────────

interface EventCardProps {
  item:     EventReport;
  actionId: string | null;
  onDismiss: (r: EventReport) => void;
  onDelete:  (r: EventReport) => void;
}

function EventReportCard({ item, actionId, onDismiss, onDelete }: EventCardProps) {
  const busy = actionId === item.report_id;
  const location = [item.city, item.state].filter(Boolean).join(', ') || 'Location TBD';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.event_name}</Text>
        <View style={[styles.typePill, { backgroundColor: '#1a237e' }]}>
          <Text style={styles.typePillTxt}>{item.event_type}</Text>
        </View>
      </View>

      <Text style={styles.cardMeta}>🗓 {formatDate(item.start_time)}  ·  📍 {location}</Text>
      {item.organizer_username && (
        <Text style={styles.cardMeta}>Organized by @{item.organizer_username}</Text>
      )}
      <Text style={styles.cardMeta}>Reported {formatDate(item.reported_at)}{item.reporter_username ? ` by @${item.reporter_username}` : ''}</Text>

      <ReasonBadge reason={item.reason} />
      {item.details ? <Text style={styles.cardDetail}>"{item.details}"</Text> : null}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionBtnNeutral}
          onPress={() => onDismiss(item)}
          disabled={!!busy}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : (
            <><Ionicons name="close-circle-outline" size={14} color="#fff" /><Text style={styles.actionBtnTxt}>Dismiss</Text></>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtnRed}
          onPress={() => onDelete(item)}
          disabled={!!busy}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : (
            <><Ionicons name="trash-outline" size={14} color="#fff" /><Text style={styles.actionBtnTxt}>Delete</Text></>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const {
    isAdmin, spotReports, eventReports, loading, actionId,
    checkAdmin, loadSpotReports, loadEventReports,
    dismissSpotReport, deleteSpot, verifySpot,
    dismissEventReport, deleteEvent,
  } = useMapModeration();

  const [tab, setTab] = useState<'spots' | 'events' | 'disputes'>('spots');
  const [disputes,       setDisputes]       = useState<any[]>([]);
  const [listingReports, setListingReports] = useState<any[]>([]);
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [resolvingId,    setResolvingId]    = useState<string | null>(null);

  // ── Boot: verify admin, then load both lists ──────────────────────────────
  useEffect(() => {
    (async () => {
      const ok = await checkAdmin();
      if (!ok) return; // gate rendered below
      await Promise.all([loadSpotReports(), loadEventReports(), loadDisputes()]);
    })();
  }, []);

  const loadDisputes = useCallback(async () => {
    setDisputeLoading(true);
    try {
      const [{ data: d }, { data: r }] = await Promise.all([
        supabase.from('marketplace_disputes').select('*').order('created_at', { ascending: false }),
        supabase.from('listing_reports').select(`
          id, reason, status, created_at,
          listing_id, marketplace_listings(title),
          reporter:users!listing_reports_reporter_id_fkey(username)
        `).eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
      ]);
      setDisputes(d ?? []);
      setListingReports(r ?? []);
    } finally {
      setDisputeLoading(false);
    }
  }, []);

  const handleResolveDispute = (orderId: string, action: string, label: string) => {
    Alert.alert(
      'Resolve Dispute',
      `Action: "${label}" — this will notify both parties.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'destructive', onPress: async () => {
          setResolvingId(orderId);
          const { error } = await supabase.rpc('resolve_dispute', {
            p_order_id: orderId, p_action: action,
          });
          setResolvingId(null);
          if (error) Alert.alert('Error', error.message);
          else { Alert.alert('Done', 'Dispute resolved.'); loadDisputes(); }
        }},
      ],
    );
  };

  const handleDismissReport = (reportId: string) => {
    Alert.alert('Dismiss Report', 'Mark this listing report as reviewed/dismissed?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Dismiss', onPress: async () => {
        await supabase.from('listing_reports').update({ status: 'dismissed' }).eq('id', reportId);
        loadDisputes();
      }},
    ]);
  };

  const refresh = useCallback(async () => {
    await Promise.all([loadSpotReports(), loadEventReports(), loadDisputes()]);
  }, [loadSpotReports, loadEventReports, loadDisputes]);

  // ─── Spot actions with confirm dialogs ────────────────────────────────────
  const handleVerifySpot = (r: SpotReport) => {
    Alert.alert(
      'Verify Spot',
      `Mark "${r.spot_name}" as verified and dismiss this report?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Verify', onPress: async () => {
          const ok = await verifySpot(r.spot_id, r.report_id);
          if (!ok) Alert.alert('Error', 'Could not verify spot. Try again.');
        }},
      ],
    );
  };

  const handleDismissSpot = (r: SpotReport) => {
    Alert.alert(
      'Dismiss Report',
      `Keep "${r.spot_name}" on the map and close this report?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Dismiss', onPress: async () => {
          const ok = await dismissSpotReport(r.report_id);
          if (!ok) Alert.alert('Error', 'Could not dismiss. Try again.');
        }},
      ],
    );
  };

  const handleDeleteSpot = (r: SpotReport) => {
    Alert.alert(
      '🗑 Delete Spot',
      `Permanently remove "${r.spot_name}" from the map? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          const ok = await deleteSpot(r.spot_id, r.report_id);
          if (!ok) Alert.alert('Error', 'Could not delete spot. Try again.');
        }},
      ],
    );
  };

  // ─── Event actions ────────────────────────────────────────────────────────
  const handleDismissEvent = (r: EventReport) => {
    Alert.alert(
      'Dismiss Report',
      `Keep "${r.event_name}" and close this report?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Dismiss', onPress: async () => {
          const ok = await dismissEventReport(r.report_id);
          if (!ok) Alert.alert('Error', 'Could not dismiss. Try again.');
        }},
      ],
    );
  };

  const handleDeleteEvent = (r: EventReport) => {
    Alert.alert(
      '🗑 Delete Event',
      `Permanently remove "${r.event_name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          const ok = await deleteEvent(r.event_id, r.report_id);
          if (!ok) Alert.alert('Error', 'Could not delete event. Try again.');
        }},
      ],
    );
  };

  // ─── Gate: not yet checked ────────────────────────────────────────────────
  if (isAdmin === null) {
    return (
      <View style={styles.gateWrap}>
        <ActivityIndicator size="large" color="#ff4500" />
        <Text style={styles.gateText}>Checking access…</Text>
      </View>
    );
  }

  // ─── Gate: not admin ──────────────────────────────────────────────────────
  if (isAdmin === false) {
    return (
      <View style={styles.gateWrap}>
        <Ionicons name="lock-closed" size={52} color="#444" />
        <Text style={styles.gateTitle}>Access Denied</Text>
        <Text style={styles.gateText}>This screen is for moderators only.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnTxt}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────
  const spotCount     = spotReports.length;
  const eventCount    = eventReports.length;
  const disputeCount  = disputes.filter(d => d.status === 'disputed').length + listingReports.length;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🛡 Map Moderation</Text>
        <TouchableOpacity onPress={refresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="refresh-outline" size={22} color="#888" />
        </TouchableOpacity>
      </View>

      {/* ── Summary row ── */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{spotCount}</Text>
          <Text style={styles.summaryLabel}>Spot Reports</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{eventCount}</Text>
          <Text style={styles.summaryLabel}>Event Reports</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryNum, { color: spotCount + eventCount > 0 ? '#FF9800' : '#00C853' }]}>
            {spotCount + eventCount}
          </Text>
          <Text style={styles.summaryLabel}>Total Open</Text>
        </View>
      </View>

      {/* ── Tab bar ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'spots' && styles.tabBtnActive]}
          onPress={() => setTab('spots')}
        >
          <Text style={[styles.tabBtnTxt, tab === 'spots' && styles.tabBtnTxtActive]}>
            📍 Spots
            {spotCount > 0 && <Text style={styles.tabBadge}>  {spotCount}</Text>}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'events' && styles.tabBtnActive]}
          onPress={() => setTab('events')}
        >
          <Text style={[styles.tabBtnTxt, tab === 'events' && styles.tabBtnTxtActive]}>
            🗓 Events
            {eventCount > 0 && <Text style={styles.tabBadge}>  {eventCount}</Text>}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color="#ff4500" />
          <Text style={styles.loadingTxt}>Loading reports…</Text>
        </View>
      ) : tab === 'spots' ? (
        <FlatList
          data={spotReports}
          keyExtractor={r => r.report_id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#ff4500" />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-circle-outline" size={48} color="#00C853" />
              <Text style={styles.emptyTitle}>No spot reports</Text>
              <Text style={styles.emptyTxt}>All reported spots have been reviewed.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <SpotReportCard
              item={item}
              actionId={actionId}
              onVerify={handleVerifySpot}
              onDismiss={handleDismissSpot}
              onDelete={handleDeleteSpot}
            />
          )}
        />
      ) : (
        <FlatList
          data={eventReports}
          keyExtractor={r => r.report_id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#ff4500" />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-circle-outline" size={48} color="#00C853" />
              <Text style={styles.emptyTitle}>No event reports</Text>
              <Text style={styles.emptyTxt}>All reported events have been reviewed.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <EventReportCard
              item={item}
              actionId={actionId}
              onDismiss={handleDismissEvent}
              onDelete={handleDeleteEvent}
            />
          )}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:             { flex: 1, backgroundColor: '#0a0a0a' },

  // Gate screens
  gateWrap:         { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 32 },
  gateTitle:        { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16 },
  gateText:         { color: '#888', fontSize: 15, marginTop: 8, textAlign: 'center' },
  backBtn:          { marginTop: 24, backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  backBtnTxt:       { color: '#ff4500', fontWeight: '700', fontSize: 15 },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:      { color: '#fff', fontSize: 18, fontWeight: '700' },

  // Summary row
  summaryRow:       { flexDirection: 'row', backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  summaryCard:      { flex: 1, alignItems: 'center', paddingVertical: 14 },
  summaryNum:       { color: '#FF9800', fontSize: 24, fontWeight: '800' },
  summaryLabel:     { color: '#666', fontSize: 11, marginTop: 2 },
  summaryDivider:   { width: 1, backgroundColor: '#1a1a1a', marginVertical: 10 },

  // Tab bar
  tabBar:           { flexDirection: 'row', backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  tabBtn:           { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabBtnActive:     { borderBottomWidth: 2, borderBottomColor: '#ff4500' },
  tabBtnTxt:        { color: '#666', fontSize: 14, fontWeight: '600' },
  tabBtnTxtActive:  { color: '#ff4500' },
  tabBadge:         { color: '#FF9800', fontWeight: '700' },
  sectionTitle:     { color: '#fff', fontSize: 15, fontWeight: '700' },
  actionBtn:        { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  actionBtnTxt:     { color: '#fff', fontSize: 13, fontWeight: '600' },

  // List
  listContent:      { padding: 12, paddingBottom: 40 },
  centerWrap:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt:       { color: '#666', marginTop: 12 },

  // Empty state
  emptyWrap:        { alignItems: 'center', paddingTop: 80 },
  emptyTitle:       { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptyTxt:         { color: '#666', fontSize: 14, marginTop: 6 },

  // Card
  card:             { backgroundColor: '#111', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#1e1e1e' },
  cardHeader:       { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cardTitleRow:     { flex: 1, flexDirection: 'row', alignItems: 'center' },
  flagDot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF9800', marginRight: 6 },
  cardTitle:        { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  typePill:         { backgroundColor: '#1a1a2e', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typePillTxt:      { color: '#aaa', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  cardMeta:         { color: '#666', fontSize: 12, marginTop: 3 },
  cardDetail:       { color: '#999', fontSize: 12, fontStyle: 'italic', marginTop: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#333' },

  // Reason badge
  reasonBadge:      { alignSelf: 'flex-start', backgroundColor: '#1a1a1a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginTop: 8, borderWidth: 1, borderColor: '#2a2a2a' },
  reasonBadgeTxt:   { color: '#ccc', fontSize: 12 },

  // Action buttons
  actionRow:        { flexDirection: 'row', marginTop: 12, gap: 8, flexWrap: 'wrap' },
  actionBtnMap:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: '#2979FF' },
  actionBtnMapTxt:  { color: '#2979FF', fontSize: 12, fontWeight: '600' },
  actionBtnGreen:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: '#1b5e20' },
  actionBtnNeutral: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: '#333' },
  actionBtnRed:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: '#b71c1c' },
  actionBtnTxt:     { color: '#fff', fontSize: 12, fontWeight: '600' },
});
