// app/settings.tsx
// Full-featured Settings screen – replaces the embedded modal in profile.tsx
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Platform, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth }             from '../src/context/AuthContext';
import { useProfile }          from '../src/hooks/useProfile';
import { useYouTubeAuth }      from '../src/hooks/useYouTubeAuth';
import { useMultiGP }          from '../src/hooks/useMultiGP';
import { useMute }             from '../src/hooks/useMute';
import MuteListModal           from '../src/components/MuteListModal';
import { useNotificationsContext } from '../src/context/NotificationsContext';
import { useStripeConnect }       from '../src/hooks/useStripeConnect';
import { useFeaturedContentModeration } from '../src/hooks/useFeaturedContentModeration';
import * as Notifications from 'expo-notifications';

// ─── Section / Row components ─────────────────────────────────────────────────

interface SectionProps { title: string; icon: string; iconColor?: string; children: React.ReactNode }
function Section({ title, icon, iconColor = '#00d4ff', children }: SectionProps) {
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Ionicons name={icon as any} size={14} color={iconColor} />
        <Text style={[s.sectionTitle, { color: iconColor }]}>{title}</Text>
      </View>
      <View style={s.card}>{children}</View>
    </View>
  );
}

interface RowProps {
  label: string;
  sublabel?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}
function Row({ label, sublabel, left, right, onPress, last }: RowProps) {
  const Inner = (
    <View style={[s.row, !last && s.rowBorder]}>
      {left && <View style={s.rowLeft}>{left}</View>}
      <View style={s.rowCenter}>
        <Text style={s.rowLabel}>{label}</Text>
        {sublabel ? <Text style={s.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {right && <View style={s.rowRight}>{right}</View>}
    </View>
  );
  if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{Inner}</TouchableOpacity>;
  return Inner;
}

// ─── Toggle row helper ─────────────────────────────────────────────────────────
interface ToggleRowProps {
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  color?: string;
  icon?: string;
  last?: boolean;
}
function ToggleRow({ label, sublabel, value, onValueChange, color = '#ff6b35', icon, last }: ToggleRowProps) {
  return (
    <Row
      label={label}
      sublabel={sublabel}
      left={icon ? <Ionicons name={icon as any} size={18} color={value ? color : '#555'} /> : undefined}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ true: color, false: '#2a2a4a' }}
          thumbColor={value ? '#fff' : '#666'}
          ios_backgroundColor="#2a2a4a"
        />
      }
      last={last}
    />
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const router   = useRouter();
  const { user, signOut } = useAuth();
  const { profile, updateProfile } = useProfile(user?.id);
  const { mutedUsers, loading: muteLoading, unmuteUser } = useMute(user?.id);
  const { linked: ytLinked, loading: ytAuthLoading, promptAsync: promptYouTubeAuth, unlinkYouTube } = useYouTubeAuth(user?.id);
  const { connection: mgpConnection, loading: mgpLoading } = useMultiGP(user?.id);
  const { notificationPrefs, updatePreferences } = useNotificationsContext();
  const {
    sellerProfile: stripeProfile, loading: stripeLoading,
    onboarding: stripeOnboarding, checking: stripeChecking,
    startOnboarding: stripeStartOnboarding, checkStatus: stripeCheckStatus,
  } = useStripeConnect(user?.id);
  const {
    queue: featuredQueue,
    loading: featuredQueueLoading,
    loadQueue: loadFeaturedQueue,
  } = useFeaturedContentModeration();

  const [signingOut, setSigningOut] = useState(false);
  const [showMuteList, setShowMuteList] = useState(false);
  const [showMultiGPModal, setShowMultiGPModal] = useState(false);
  const [pushStatus, setPushStatus] = useState<'loading' | 'granted' | 'denied' | 'undetermined'>('loading');
  const [pushBusy, setPushBusy] = useState(false);

  // ── helpers ──────────────────────────────────────────────────────────────────
  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          await signOut();
          setSigningOut(false);
        },
      },
    ]);
  }, [signOut]);

  const isAdmin = (profile as any)?.is_admin ?? false;

  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then(({ status }) => setPushStatus((status as any) ?? 'denied'))
      .catch(() => setPushStatus('denied'));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadFeaturedQueue();
  }, [isAdmin, loadFeaturedQueue]);

  const handlePushSettings = useCallback(async () => {
    try {
      setPushBusy(true);
      if (pushStatus === 'undetermined') {
        const { status } = await Notifications.requestPermissionsAsync();
        setPushStatus((status as any) ?? 'denied');
      } else {
        await Linking.openSettings();
      }
    } catch (err: any) {
      Alert.alert('Notifications', err?.message ?? 'Could not open notification settings.');
    } finally {
      setPushBusy(false);
    }
  }, [pushStatus]);

  const pushStatusLabel =
    pushStatus === 'granted'
      ? 'Enabled on this device'
      : pushStatus === 'undetermined'
        ? 'Not enabled yet — tap to allow'
        : pushStatus === 'loading'
          ? 'Checking device permission…'
          : 'Disabled on this device — tap to open settings';

  const featuredQueueCount = featuredQueue.filter(item =>
    ['pending_moderation', 'needs_review', 'pending_payment', 'approved'].includes(item.status),
  ).length;
  const featuredNeedsReviewCount = featuredQueue.filter(item =>
    ['pending_moderation', 'needs_review'].includes(item.status),
  ).length;

  const featuredQueueLabel = featuredQueueLoading
    ? 'Loading featured moderation queue…'
    : featuredNeedsReviewCount > 0
      ? `${featuredNeedsReviewCount} waiting for review`
      : featuredQueueCount > 0
        ? `${featuredQueueCount} featured requests in queue`
        : 'Automatic screening is active';

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>

        {/* ── ACCOUNT ── */}
        <Section title="ACCOUNT" icon="person-circle-outline">
          <Row label="Email"    sublabel={user?.email ?? '—'} last={false} />
          <Row label="Username" sublabel={profile?.username ?? '—'} last />
        </Section>

        {/* ── NOTIFICATIONS ── */}
        <Section title="NOTIFICATIONS" icon="notifications-outline" iconColor="#ff6b35">
          <Row
            label="Push Permissions"
            sublabel={pushStatusLabel}
            left={
              <Ionicons
                name={pushStatus === 'granted' ? 'notifications' : 'notifications-off-outline'}
                size={18}
                color={pushStatus === 'granted' ? '#22c55e' : '#ff6b35'}
              />
            }
            right={
              pushBusy ? (
                <ActivityIndicator size="small" color="#888" />
              ) : (
                <TouchableOpacity style={[s.chipBtn, pushStatus === 'granted' ? s.chipBtnGreen : s.chipBtnOrange]} onPress={handlePushSettings}>
                  <Text style={s.chipBtnText}>{pushStatus === 'undetermined' ? 'Allow' : 'Open'}</Text>
                </TouchableOpacity>
              )
            }
          />
          <View style={s.notificationHelpBox}>
            <Ionicons name="information-circle-outline" size={16} color="#8892b0" />
            <Text style={s.notificationHelpText}>
              Device push permissions control pop-up alerts. The toggles below control what lands in your notification center and what remains eligible for push across the app.
            </Text>
          </View>

          <View style={s.notifGroup}>
            <Text style={s.notifGroupLabel}>🔔 Notification Center</Text>
          </View>
          <ToggleRow
            label="Social Activity"
            sublabel="Likes, comments, replies, follows, and mentions"
            icon="people-outline"
            value={notificationPrefs?.social_activity ?? true}
            onValueChange={(val) => updatePreferences({ social_activity: val })}
          />
          <ToggleRow
            label="Marketplace Updates"
            sublabel="Messages, offers, sales, disputes, and delivery updates"
            icon="storefront-outline"
            value={notificationPrefs?.marketplace_activity ?? true}
            onValueChange={(val) => updatePreferences({ marketplace_activity: val })}
          />
          <ToggleRow
            label="Groups & Invites"
            sublabel="Community invites and future group activity"
            icon="people-circle-outline"
            value={notificationPrefs?.group_activity ?? true}
            onValueChange={(val) => updatePreferences({ group_activity: val })}
          />
          <ToggleRow
            label="Rewards & Bonuses"
            sublabel="Daily check-in and future rewards"
            icon="gift-outline"
            value={notificationPrefs?.reward_activity ?? true}
            onValueChange={(val) => updatePreferences({ reward_activity: val })}
          />

          <View style={s.notifGroup}>
            <Text style={s.notifGroupLabel}>🏆  Challenge Events</Text>
          </View>
          <ToggleRow
            label="Voting Opens"
            sublabel="Saturday — voting period begins"
            icon="megaphone-outline"
            value={notificationPrefs?.challenge_voting ?? true}
            onValueChange={(val) => updatePreferences({ challenge_voting: val })}
          />
          <ToggleRow
            label="2-Hour Warning"
            sublabel="Sunday — reminder before voting closes"
            icon="timer-outline"
            value={notificationPrefs?.challenge_closing ?? true}
            onValueChange={(val) => updatePreferences({ challenge_closing: val })}
          />
          <ToggleRow
            label="Results Announced"
            sublabel="Monday — winners revealed"
            icon="trophy-outline"
            value={notificationPrefs?.challenge_results ?? true}
            onValueChange={(val) => updatePreferences({ challenge_results: val })}
            last
          />
        </Section>

        {/* ── PREFERENCES ── */}
        <Section title="PREFERENCES" icon="options-outline" iconColor="#00d4ff">
          <ToggleRow
            label="Autoplay Videos"
            sublabel="Videos play automatically in the feed"
            icon="play-circle-outline"
            color="#00d4ff"
            value={profile?.autoplay_videos ?? true}
            onValueChange={(val) => { void updateProfile({ autoplay_videos: val }); }}
            last
          />
        </Section>

        {/* ── PRIVACY ── */}
        <Section title="PRIVACY" icon="shield-outline" iconColor="#a78bfa">
          <Row
            label="Muted Users"
            sublabel={mutedUsers.length > 0 ? `${mutedUsers.length} muted` : 'No muted users'}
            left={<Ionicons name="volume-mute-outline" size={18} color="#a78bfa" />}
            right={<Ionicons name="chevron-forward" size={16} color="#444" />}
            onPress={() => setShowMuteList(true)}
            last
          />
        </Section>

        {/* ── MARKETPLACE ── */}
        <Section title="MARKETPLACE" icon="bag-handle-outline" iconColor="#ff4500">
          <Row
            label="My Orders"
            sublabel="View purchases & sales"
            left={<Ionicons name="bag-outline" size={18} color="#ff4500" />}
            right={<Ionicons name="chevron-forward" size={16} color="#444" />}
            onPress={() => router.push('/orders')}
          />
          <Row
            label="Seller Payouts"
            sublabel={
              stripeLoading ? 'Loading…'
                : stripeProfile?.stripe_onboarded
                  ? `● Active — ${stripeProfile.total_sales} sale${stripeProfile.total_sales !== 1 ? 's' : ''}`
                  : stripeProfile?.stripe_account_id
                    ? '⚠ Incomplete — tap to finish'
                    : '○ Not set up — required to receive payments'
            }
            left={
              <Ionicons
                name="card-outline"
                size={18}
                color={stripeProfile?.stripe_onboarded ? '#22c55e' : '#f59e0b'}
              />
            }
            right={
              stripeOnboarding || stripeChecking || stripeLoading
                ? <ActivityIndicator size="small" color="#888" />
                : (
                  <TouchableOpacity
                    style={[s.chipBtn, stripeProfile?.stripe_onboarded ? s.chipBtnOrange : s.chipBtnGreen]}
                    onPress={stripeProfile?.stripe_onboarded ? stripeCheckStatus : stripeStartOnboarding}
                    disabled={stripeOnboarding || stripeChecking || stripeLoading}
                  >
                    <Text style={s.chipBtnText}>
                      {stripeProfile?.stripe_onboarded ? 'View' : stripeProfile?.stripe_account_id ? 'Continue' : 'Set Up'}
                    </Text>
                  </TouchableOpacity>
                )
            }
            last
          />
        </Section>

        {/* ── CONNECTED ACCOUNTS ── */}
        <Section title="CONNECTED ACCOUNTS" icon="link-outline" iconColor="#4ade80">
          {/* Social Links */}
          <Row
            label="Social Links"
            sublabel="Twitter, Instagram, TikTok…"
            left={<Ionicons name="share-social-outline" size={18} color="#4ade80" />}
            right={<Ionicons name="chevron-forward" size={16} color="#444" />}
            onPress={() => router.back()}
          />

          {/* YouTube */}
          <Row
            label="YouTube"
            sublabel={ytLinked ? '● Connected — Like & Subscribe enabled' : '○ Not connected'}
            left={<Ionicons name="logo-youtube" size={18} color="#FF0000" />}
            right={
              ytAuthLoading
                ? <ActivityIndicator size="small" color="#888" />
                : (
                  <TouchableOpacity
                    style={[s.chipBtn, ytLinked ? s.chipBtnRed : s.chipBtnGreen]}
                    onPress={ytLinked ? unlinkYouTube : () => promptYouTubeAuth()}
                    disabled={ytAuthLoading}
                  >
                    <Text style={s.chipBtnText}>{ytLinked ? 'Unlink' : 'Connect'}</Text>
                  </TouchableOpacity>
                )
            }
          />

          {/* MultiGP */}
          <Row
            label="MultiGP Chapter"
            sublabel={
              mgpConnection
                ? (mgpConnection.is_active ? `● ${mgpConnection.chapter_name ?? 'Connected'}` : `○ ${mgpConnection.chapter_name ?? 'Paused'}`)
                : '○ Not connected'
            }
            left={<Ionicons name="radio-outline" size={18} color="#ff4500" />}
            right={
              mgpLoading
                ? <ActivityIndicator size="small" color="#888" />
                : (
                  <TouchableOpacity
                    style={[s.chipBtn, mgpConnection ? s.chipBtnOrange : s.chipBtnGreen]}
                    onPress={() => setShowMultiGPModal(true)}
                  >
                    <Text style={s.chipBtnText}>{mgpConnection ? 'Manage' : 'Connect'}</Text>
                  </TouchableOpacity>
                )
            }
            last
          />
        </Section>

        {/* ── ADMIN ── */}
        {isAdmin && (
          <Section title="ADMIN TOOLS" icon="shield-checkmark-outline" iconColor="#FF9800">
            <Row
              label="Admin Moderation"
              sublabel="Reported spots, events, and marketplace issues"
              left={<Ionicons name="shield-half-outline" size={18} color="#FF9800" />}
              right={
                <View style={s.adminRowRight}>
                  <Ionicons name="chevron-forward" size={16} color="#444" />
                </View>
              }
              onPress={() => router.push('/(tabs)/admin?tab=spots')}
            />
            <Row
              label="Featured Content Queue"
              sublabel={featuredQueueLabel}
              left={<Ionicons name="sparkles-outline" size={18} color="#8ab4ff" />}
              right={
                <View style={s.adminRowRight}>
                  {featuredQueueLoading ? (
                    <ActivityIndicator size="small" color="#8ab4ff" />
                  ) : featuredQueueCount > 0 ? (
                    <View style={s.adminBadge}>
                      <Text style={s.adminBadgeText}>{featuredQueueCount}</Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color="#444" />
                </View>
              }
              onPress={() => router.push('/(tabs)/admin?tab=featured')}
            />
            <Row
              label="Featured Analytics"
              sublabel="Boost activity, active placements, and spend trends"
              left={<Ionicons name="flash" size={18} color="#ffcc00" />}
              right={
                <View style={s.adminRowRight}>
                  <Ionicons name="chevron-forward" size={16} color="#444" />
                </View>
              }
              onPress={() => router.push('/admin')}
              last
            />
          </Section>
        )}

        {/* ── ABOUT ── */}
        <Section title="ABOUT" icon="information-circle-outline" iconColor="#888">
          <Row
            label="Version"
            sublabel="1.0.0"
            last={false}
          />
          <Row
            label="Privacy Policy"
            left={<Ionicons name="document-text-outline" size={18} color="#555" />}
            right={<Ionicons name="open-outline" size={14} color="#444" />}
            onPress={() => Linking.openURL('https://fpventhusiast.com/privacy')}
          />
          <Row
            label="Terms of Service"
            left={<Ionicons name="reader-outline" size={18} color="#555" />}
            right={<Ionicons name="open-outline" size={14} color="#444" />}
            onPress={() => Linking.openURL('https://fpventhusiast.com/terms')}
            last
          />
        </Section>

        {/* ── SIGN OUT ── */}
        <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut} disabled={signingOut}>
          {signingOut
            ? <ActivityIndicator size="small" color="#e74c3c" />
            : <>
                <Ionicons name="log-out-outline" size={18} color="#e74c3c" />
                <Text style={s.signOutText}>Sign Out</Text>
              </>
          }
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Mute List Modal ── */}
      {user?.id && (
        <MuteListModal
          visible={showMuteList}
          onClose={() => setShowMuteList(false)}
          mutedUsers={mutedUsers}
          loading={muteLoading}
          onUnmute={unmuteUser}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#080814' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a30',
    backgroundColor: '#0a0a1e',
  },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 0.3 },

  body: { padding: 16, paddingTop: 20 },

  // Section
  section:      { marginBottom: 24 },
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  card:         { backgroundColor: '#111128', borderRadius: 14, borderWidth: 1, borderColor: '#1e1e3a', overflow: 'hidden' },

  // Row
  row:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, minHeight: 52 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#1a1a30' },
  rowLeft:   { marginRight: 12 },
  rowCenter: { flex: 1 },
  rowRight:  { marginLeft: 10 },
  rowLabel:  { color: '#ddd', fontSize: 14, fontWeight: '500' },
  rowSublabel:{ color: '#666', fontSize: 12, marginTop: 2 },
  adminRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adminBadge: { minWidth: 22, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: '#18233a', borderWidth: 1, borderColor: '#35507d', alignItems: 'center' },
  adminBadgeText: { color: '#8ab4ff', fontSize: 11, fontWeight: '700' },

  // Notification group label
  notifGroup:      { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  notifGroupLabel: { color: '#ff6b35', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  notificationHelpBox: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 2,
    marginBottom: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#0d1328',
    borderWidth: 1,
    borderColor: '#1f2a44',
  },
  notificationHelpText: { color: '#8892b0', fontSize: 12, lineHeight: 18, flex: 1 },

  // Chip buttons (for connect/unlink)
  chipBtn:      { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, minWidth: 70, alignItems: 'center' },
  chipBtnGreen: { backgroundColor: '#1a3a2a', borderWidth: 1, borderColor: '#4ade80' },
  chipBtnRed:   { backgroundColor: '#3a1a1a', borderWidth: 1, borderColor: '#e74c3c' },
  chipBtnOrange:{ backgroundColor: '#3a2a1a', borderWidth: 1, borderColor: '#ff4500' },
  chipBtnText:  { color: '#ccc', fontSize: 12, fontWeight: '600' },

  // Sign out
  signOutBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a0a0a', borderWidth: 1, borderColor: '#3a1a1a', borderRadius: 12, paddingVertical: 14, marginBottom: 16 },
  signOutText: { color: '#e74c3c', fontSize: 15, fontWeight: '600' },
});
