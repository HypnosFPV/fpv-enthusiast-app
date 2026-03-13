// app/(tabs)/challenges.tsx
// FPV Weekly Challenges — anonymous submissions, must-vote, suggestions

import React, {
  useState, useCallback, useEffect, useRef, useMemo,
} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, TextInput, ScrollView, ActivityIndicator, Alert,
  RefreshControl, Image, Dimensions, StatusBar, Animated,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/services/supabase';
import { PropsToast, usePropsToast } from '../../src/components/PropsToast';
import PropIcon from '../../src/components/icons/PropIcon';
import {
  useChallenges,
  Challenge, ChallengeEntry, ChallengeSuggestion,
  LeaderboardEntry, LeaderboardScope, Season,
  getChallengePhase, timeLeft, propsForPlace,
} from '../../src/hooks/useChallenges';
import {
  useAdminModeration,
  FlaggedEntry,
} from '../../src/hooks/useAdminModeration';

const { width: W } = Dimensions.get('window');

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  bg:      '#070710',
  card:    '#0d0d1f',
  border:  '#1e2a3a',
  orange:  '#ff4500',
  cyan:    '#00d4ff',
  gold:    '#ffd700',
  silver:  '#c0c0c0',
  bronze:  '#cd7f32',
  muted:   '#4a5568',
  text:    '#e2e8f0',
  subtext: '#718096',
  green:   '#48bb78',
  purple:  '#9f7aea',
};

const PLACE_COLOURS = ['', C.gold, C.silver, C.bronze];
const PLACE_LABELS  = ['', '🥇 1st', '🥈 2nd', '🥉 3rd'];

type ScreenTab = 'challenges' | 'leaderboard';
type LeadTab   = LeaderboardScope;
type ChallengeSubTab = 'this_week' | 'archive' | 'suggest';

// ─── Entry Video Player ──────────────────────────────────────────────────────
// ─── AdminVideoActions ────────────────────────────────────────────────────────
// Bottom bar for AdminVideoPlayer — approve / reject directly on the video screen.
// Calls the admin RPCs via Supabase directly so no hook re-render is needed.
function AdminVideoActions({
  entry,
  onClose,
}: {
  entry: import('../src/hooks/useAdminModeration').FlaggedEntry;
  onClose: () => void;
}) {
  const [acting,        setActing]        = React.useState(false);
  const [rejectVisible, setRejectVisible] = React.useState(false);
  const [reason,        setReason]        = React.useState('');

  const doApprove = async () => {
    setActing(true);
    await supabase.rpc('admin_approve_entry', { p_entry_id: entry.id }).catch(() => {});
    setActing(false);
    onClose();
  };

  const doReject = async () => {
    setActing(true);
    await supabase.rpc('admin_reject_entry', { p_entry_id: entry.id, p_reason: reason || 'admin_rejection' }).catch(() => {});
    setActing(false);
    setRejectVisible(false);
    onClose();
  };

  return (
    <>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 36,
        backgroundColor: 'rgba(0,0,0,0.88)' }}>

        {/* Back */}
        <TouchableOpacity
          style={{ paddingHorizontal: 14, paddingVertical: 13,
            borderRadius: 10, backgroundColor: '#333',
            flexDirection: 'row', alignItems: 'center', gap: 5 }}
          onPress={onClose} disabled={acting}
        >
          <Ionicons name="arrow-back" size={15} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Back</Text>
        </TouchableOpacity>

        {/* Approve */}
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            gap: 6, paddingVertical: 13, borderRadius: 10,
            backgroundColor: acting ? '#1a6b3a' : '#27ae60', opacity: acting ? 0.7 : 1 }}
          onPress={doApprove} disabled={acting}
        >
          {acting
            ? <ActivityIndicator size={14} color="#fff" />
            : <Ionicons name="checkmark-circle" size={16} color="#fff" />}
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Approve</Text>
        </TouchableOpacity>

        {/* Reject */}
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            gap: 6, paddingVertical: 13, borderRadius: 10,
            backgroundColor: acting ? '#7a1a1a' : '#c0392b', opacity: acting ? 0.7 : 1 }}
          onPress={() => setRejectVisible(true)} disabled={acting}
        >
          <Ionicons name="close-circle" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Reject</Text>
        </TouchableOpacity>
      </View>

      {/* Reject reason sub-modal — uses animationType="fade" so it layers over the video */}
      <Modal
        visible={rejectVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setRejectVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
          justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ width: '100%', backgroundColor: '#1a1a2e', borderRadius: 14,
            padding: 20, gap: 12 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              Reject Entry #{entry.entry_number}
            </Text>
            <Text style={{ color: '#888', fontSize: 12 }}>
              The pilot won't see this reason — it's for your records only.
            </Text>
            <TextInput
              style={{ backgroundColor: '#0d0d1a', color: '#fff', borderRadius: 8,
                paddingHorizontal: 12, paddingVertical: 10, fontSize: 13,
                borderWidth: 1, borderColor: '#333' }}
              placeholder="Reason (e.g. pilot callsign visible)"
              placeholderTextColor="#555"
              value={reason}
              onChangeText={setReason}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, alignItems: 'center', paddingVertical: 11,
                  borderRadius: 8, backgroundColor: '#333' }}
                onPress={() => setRejectVisible(false)}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, alignItems: 'center', paddingVertical: 11,
                  borderRadius: 8, backgroundColor: '#c0392b' }}
                onPress={doReject}
                disabled={acting}
              >
                {acting
                  ? <ActivityIndicator size={14} color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Confirm Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── AdminVideoPlayer ──────────────────────────────────────────────────────────
// Dedicated video player for admin review — rendered outside any parent Modal
// to avoid nested Modal conflicts on iOS.
// Shows video full-screen with entry metadata (challenge, entry #, detected flags)
// and Approve / Reject quick-actions so admin never needs to reopen the panel
// just to take action.
function AdminVideoPlayer({
  entry,
  onClose,
}: {
  entry: import('../src/hooks/useAdminModeration').FlaggedEntry;
  onClose: () => void;
}) {
  const [buffering, setBuffering] = React.useState(true);
  const [hasError,  setHasError]  = React.useState(false);

  // Only attempt to play if there's a video URL
  const videoUri = entry.video_url ?? '';
  const player   = useVideoPlayer(videoUri, p => {
    if (videoUri) { p.loop = false; p.play(); }
  });

  React.useEffect(() => {
    if (!videoUri) return;
    const sub = player.addListener('statusChange', ({ status }: { status: string }) => {
      setBuffering(status === 'loading' || status === 'idle');
      if (status === 'error') setHasError(true);
    });
    return () => sub.remove();
  }, [player, videoUri]);

  const flags = (entry.moderation_flags ?? []).filter(
    (f: any) => f.type === 'pilot_name' || f.type === 'pilot_name_auto_blurred'
  );

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>

        {/* Close button */}
        <TouchableOpacity
          style={{ position: 'absolute', top: 52, right: 20, zIndex: 20,
            padding: 8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 20 }}
          onPress={onClose}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        {/* Entry meta strip at top */}
        <View style={{ position: 'absolute', top: 50, left: 16, zIndex: 20,
          backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10,
          paddingHorizontal: 12, paddingVertical: 6, maxWidth: W - 80 }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
            {entry.challenge_title}
          </Text>
          <Text style={{ color: '#aaa', fontSize: 11 }}>
            Entry #{entry.entry_number}{entry.duration_seconds ? `  ·  ${entry.duration_seconds}s` : ''}
          </Text>
          {flags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {flags.map((f: any, i: number) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3,
                  backgroundColor: '#ff660033', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Ionicons name="eye-off-outline" size={10} color="#ff6600" />
                  <Text style={{ color: '#ff6600', fontSize: 10, fontWeight: '600' }}>
                    "{f.text}"{f.confidence ? ` ${Math.round(f.confidence * 100)}%` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Video or error state */}
        {!videoUri || hasError ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
            <Ionicons name="videocam-off-outline" size={52} color="#555" />
            <Text style={{ color: '#888', fontSize: 14 }}>
              {!videoUri ? 'No video URL available for this entry.' : 'Could not load video.'}
            </Text>
            {entry.s3_upload_key ? (
              <Text style={{ color: '#555', fontSize: 11, textAlign: 'center', paddingHorizontal: 32 }}>
                Key: {entry.s3_upload_key}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <VideoView
              player={player}
              style={{ width: W, height: W * (9 / 16) > 500 ? 500 : W * (9 / 16) }}
              allowsFullscreen
              allowsPictureInPicture
              contentFit="contain"
            />
            {buffering && (
              <View style={{ position: 'absolute' }}>
                <ActivityIndicator size="large" color="#ff4500" />
              </View>
            )}
          </View>
        )}

        {/* Bottom action bar — Approve / Reject without reopening the panel */}
        <AdminVideoActions entry={entry} onClose={onClose} />

      </View>
    </Modal>
  );
}

function EntryVideoPlayer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const [buffering, setBuffering] = React.useState(true);
  const player = useVideoPlayer(uri, p => { p.loop = false; p.play(); });

  React.useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }: { status: string }) => {
      setBuffering(status === 'loading' || status === 'idle');
    });
    return () => sub.remove();
  }, [player]);

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <TouchableOpacity
          style={{ position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8,
            backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20 }}
          onPress={onClose}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <VideoView
          player={player}
          style={{ width: W, height: W * (16 / 9) > 600 ? 600 : W * (16 / 9) }}
          allowsFullscreen
          allowsPictureInPicture
          contentFit="contain"
        />
        {buffering && (
          <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#ff4500" />
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ChallengesScreen() {
  const { user } = useAuth();

  // ── Props award hook ─────────────────────────────────────────────────────────
  const propsToast = usePropsToast();

  const {
    seasons, activeSeason, setActiveSeason,
    challenges, loading,
    loadChallenges, submitEntry, deleteEntry, loadEntries,
    vote, loadLeaderboard,
    loadSuggestions, submitSuggestion, voteSuggestion,
    checkThumbnail,
  } = useChallenges(user?.id);

  // ── Screen / sub tabs ─────────────────────────────────────────────────────
  const [screenTab,  setScreenTab]  = useState<ScreenTab>('challenges');
  const [chalSubTab, setChalSubTab] = useState<ChallengeSubTab>('this_week');

  // ── Modals ────────────────────────────────────────────────────────────────
  const [detailChallenge, setDetailChallenge] = useState<Challenge | null>(null);
  const [submitVisible,   setSubmitVisible]   = useState(false);
  const [submitTarget,    setSubmitTarget]    = useState<Challenge | null>(null);
  const [suggestVisible,  setSuggestVisible]  = useState(false);
  const [suggestTarget,   setSuggestTarget]   = useState<Challenge | null>(null);

  // ── Submit entry form ─────────────────────────────────────────────────────
  const [entryUri,      setEntryUri]      = useState<string | null>(null);
  const [entryThumb,    setEntryThumb]    = useState<string | null>(null);
  const [entryFrames,   setEntryFrames]   = useState<string[]>([]);
  const [entryCaption,  setEntryCaption]  = useState('');
  const [entryDuration, setEntryDuration] = useState<number>(0);
  const [thumbLoading,  setThumbLoading]  = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [checking,      setChecking]      = useState(false);   // AI content check in progress
  const [checkResult,   setCheckResult]   = useState<{ approved: boolean; issues: string[] } | null>(null);

  // ── Suggestion form ───────────────────────────────────────────────────────
  const [sugTitle,      setSugTitle]      = useState('');
  const [sugDesc,       setSugDesc]       = useState('');
  const [savingSug,     setSavingSug]     = useState(false);

  // ── Entries / voting ──────────────────────────────────────────────────────
  const [entries,        setEntries]        = useState<ChallengeEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [refreshing,     setRefreshing]     = useState(false);

  const [entriesModalVisible, setEntriesModalVisible] = useState(false);
  const [playingEntry,        setPlayingEntry]        = useState<ChallengeEntry | null>(null);

  // ── Suggestions list ──────────────────────────────────────────────────────
  const [suggestions,    setSuggestions]    = useState<ChallengeSuggestion[]>([]);
  const [sugsLoading,    setSugsLoading]    = useState(false);

  // ── Leaderboard ───────────────────────────────────────────────────────────
  const [leadTab,    setLeadTab]    = useState<LeadTab>('global');
  const [leadRows,   setLeadRows]   = useState<LeaderboardEntry[]>([]);
  const [leadLoad,   setLeadLoad]   = useState(false);
  const [leadSeason, setLeadSeason] = useState<Season | null>(null);

  // ── Season picker ─────────────────────────────────────────────────────────
  const [seasonPickerVisible, setSeasonPickerVisible] = useState(false);

  // ── Admin moderation panel ────────────────────────────────────────────────
  const {
    entries:           flaggedEntries,
    loading:           adminLoading,
    isAdmin,
    actionId:          adminActionId,
    checkAdmin,
    loadFlaggedEntries,
    approveEntry,
    rejectEntry,
    overrideToReview,
    loadAllEntries,
    allEntries:        allAdminEntries,
    allLoading:        allAdminLoading,
  } = useAdminModeration();
  const [adminPanelVisible,  setAdminPanelVisible]  = useState(false);
  const [adminTab,           setAdminTab]           = useState<'queue'|'all'>('queue');
  const [overrideReason,     setOverrideReason]     = useState('');
  const [overrideTargetId,   setOverrideTargetId]   = useState<string|null>(null);
  const [adminPreviewEntry,  setAdminPreviewEntry]  = useState<FlaggedEntry | null>(null);
  const [rejectReason,       setRejectReason]       = useState('');
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectTarget,       setRejectTarget]       = useState<FlaggedEntry | null>(null);

  // ── Header animation ──────────────────────────────────────────────────────
  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(headerAnim, { toValue: 1, duration: 4000, useNativeDriver: false })
    ).start();
  }, []);
  const headerColor = headerAnim.interpolate({
    inputRange:  [0, 0.5, 1],
    outputRange: [C.orange, '#ff8c00', C.orange],
  });

  // ── Derived data ──────────────────────────────────────────────────────────
  const weeklyChallenge = useMemo(() =>
    challenges.find(c => c.is_weekly) ?? challenges[0] ?? null,
    [challenges]
  );

  const archivedChallenges = useMemo(() =>
    challenges.filter(c => getChallengePhase(c) === 'completed'),
    [challenges]
  );

  const currentPhase = weeklyChallenge ? getChallengePhase(weeklyChallenge) : null;

  // ── Load entries (this week inline OR archive detail modal) ───────────────
  useEffect(() => {
    const ch = detailChallenge ?? (chalSubTab === 'this_week' ? weeklyChallenge : null);
    if (!ch) { setEntries([]); return; }
    const phase = getChallengePhase(ch);
    setEntriesLoading(true);
    loadEntries(ch.id, phase)
      .then(setEntries)
      .finally(() => setEntriesLoading(false));
  }, [detailChallenge, chalSubTab, weeklyChallenge?.id]);

  // ── Load suggestions for this week's challenge (suggest sub-tab) ──────────
  useEffect(() => {
    if (chalSubTab !== 'suggest' || !weeklyChallenge) return;
    setSugsLoading(true);
    loadSuggestions(weeklyChallenge.id)
      .then(setSuggestions)
      .finally(() => setSugsLoading(false));
  }, [chalSubTab, weeklyChallenge?.id]);

  // ── Load leaderboard ──────────────────────────────────────────────────────
  useEffect(() => {
    if (screenTab !== 'leaderboard') return;
    setLeadLoad(true);
    const sid = leadTab === 'season' ? (leadSeason?.id ?? activeSeason?.id) : undefined;
    loadLeaderboard(leadTab, sid)
      .then(setLeadRows)
      .finally(() => setLeadLoad(false));
  }, [screenTab, leadTab, leadSeason]);

  // ── Sync leadSeason default ───────────────────────────────────────────────
  useEffect(() => {
    if (!leadSeason && activeSeason) setLeadSeason(activeSeason);
  }, [activeSeason]);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  // ── Admin: check role on mount + open panel handler ─────────────────────
  useEffect(() => { checkAdmin(); }, []);

  const handleOpenAdminPanel = async () => {
    // Load both queues when panel opens
    loadAllEntries();
    await loadFlaggedEntries();
    setAdminPanelVisible(true);
  };

  const handleAdminApprove = async (entry: FlaggedEntry) => {
    const ok = await approveEntry(entry.id);
    if (ok) {
      Alert.alert('✅ Approved', `Entry #${entry.entry_number} is now live.`);
    } else {
      Alert.alert('Error', 'Could not approve entry. Try again.');
    }
  };

  const handleAdminRejectOpen = (entry: FlaggedEntry) => {
    setRejectTarget(entry);
    setRejectReason('');
    setRejectModalVisible(true);
  };

  const handleAdminRejectConfirm = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim() || 'Pilot name visible in OSD — not removed';
    const ok = await rejectEntry(rejectTarget.id, reason);
    setRejectModalVisible(false);
    if (ok) {
      Alert.alert('🚫 Rejected', `Entry #${rejectTarget.entry_number} has been rejected.`);
    } else {
      Alert.alert('Error', 'Could not reject entry. Try again.');
    }
  };

  const handlePickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission required'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const dur = (asset.duration ?? 0) / 1000;
    if (dur > 120) {
      Alert.alert('Too long', `Max 2 minutes. Your video is ${Math.ceil(dur)}s.`);
      return;
    }
    setEntryUri(asset.uri);
    setEntryDuration(dur);
    setCheckResult(null); // reset check when video changes
    setThumbLoading(true);
    setEntryFrames([]); setEntryThumb(null);
    try {
      const dMs = asset.duration ?? 5000;
      const frames: string[] = [];
      for (let i = 0; i < 8; i++) {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(
            asset.uri, { time: Math.floor(dMs * (i / 7)) }
          );
          frames.push(uri);
        } catch { /* skip */ }
      }
      setEntryFrames(frames);
      setEntryThumb(frames[0] ?? null);
    } finally {
      setThumbLoading(false);
    }
  };

  const handleSubmitEntry = async () => {
    if (!submitTarget || !entryUri) { Alert.alert('Pick a video first'); return; }

    // Step 1: AI content check on thumbnail
    if (entryThumb) {
      setChecking(true);
      setCheckResult(null);
      const result = await checkThumbnail(entryThumb);
      setChecking(false);
      setCheckResult(result);
      if (!result.approved) {
        // Don't submit — show rejection reason
        return;
      }
    }

    // Step 2: Upload
    setSubmitting(true);
    try {
      const ext  = entryUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'mp4';
      const mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      const resp = await fetch(entryUri);
      const buf  = await resp.arrayBuffer();
      const s3Path = `challenges/${submitTarget.id}/${user!.id}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('posts').upload(s3Path, buf, { contentType: mime, upsert: false });
      if (upErr) {
        let errMsg = upErr.message ?? '';
        let userMsg = '';
        if (errMsg.includes('row-level security') || errMsg.includes('policy')) {
          userMsg = 'Video upload was blocked.\n\n• Your session may have expired — sign out and back in\n• Storage permissions may need to be configured by admin';
        } else if (errMsg.includes('Duplicate') || errMsg.includes('already exists')) {
          userMsg = 'You already have a submission for this challenge.';
        } else if (errMsg.includes('size') || errMsg.includes('too large')) {
          userMsg = 'Video file is too large. Please trim to under 2 minutes.';
        } else if (errMsg.includes('mime') || errMsg.includes('type')) {
          userMsg = 'Unsupported format. Please use MP4 or MOV.';
        } else {
          userMsg = 'Upload failed. Check your connection and try again.\n\nDetails: ' + errMsg;
        }
        Alert.alert('Upload Failed', userMsg);
        return;
      }

      // ── Upload thumbnail ──────────────────────────────────────────────────────
      let thumbS3Key: string | undefined;
      if (entryThumb) {
        try {
          const tr = await fetch(entryThumb);
          const tb = await tr.arrayBuffer();
          const tp = `challenges/${submitTarget.id}/${user!.id}_thumb_${Date.now()}.jpg`;
          const { error: tErr } = await supabase.storage
            .from('posts').upload(tp, tb, { contentType: 'image/jpeg', upsert: false });
          if (!tErr) thumbS3Key = tp;
        } catch { /* skip */ }
      }

      // ── Upload ALL frame thumbnails for multi-frame OSD scanning ──────────
      // entryFrames holds up to 8 local URIs generated by expo-video-thumbnails.
      // We upload them in parallel (capped at 6) and pass the resulting S3 keys
      // to submitEntry so scan-osd-text can Vision-scan every frame, not just
      // the cover thumbnail, catching callsigns that appear mid-clip.
      const frameS3Keys: string[] = [];
      if (entryFrames.length > 0) {
        const ts = Date.now();
        const framesToUpload = entryFrames.slice(0, 6); // Vision API cost cap
        await Promise.allSettled(
          framesToUpload.map(async (frameUri, idx) => {
            try {
              const fr  = await fetch(frameUri);
              const fb  = await fr.arrayBuffer();
              const fp  = `challenges/${submitTarget.id}/${user!.id}_frame${idx}_${ts}.jpg`;
              const { error: fErr } = await supabase.storage
                .from('posts').upload(fp, fb, { contentType: 'image/jpeg', upsert: false });
              if (!fErr) frameS3Keys.push(fp);
            } catch { /* skip individual frame */ }
          })
        );
      }

      // Get file size from buffer
      const fileSizeBytes = buf.byteLength;

      const entry = await submitEntry({
        challengeId:    submitTarget.id,
        s3UploadKey:    s3Path,
        thumbnailS3Key: thumbS3Key,
        frameS3Keys,                // ← multi-frame OSD scan keys
        durationSeconds: entryDuration ? Math.round(entryDuration) : undefined,
        originalFilename: entryUri.split('/').pop()?.split('?')[0],
        fileSizeBytes,
      });

      if (entry) {
        setSubmitVisible(false);
        setCheckResult(null);
        setEntryUri(null); setEntryThumb(null);
        setEntryFrames([]); setEntryCaption(''); setEntryDuration(0);
        // ── Props award: first challenge entry (dedup-safe) ───────────────────
        if (user?.id) {
          supabase.from('props_log').insert({
            user_id: user.id, amount: 25,
            reason: 'first_challenge_entry', reference_id: user.id,
          }).then(({ error }) => {
            if (!error) propsToast.show('+25 Props! First challenge entry 🏁');
          });
        }
        Alert.alert(
          '✅ Entry submitted!',
          'Your video is anonymous until voting ends. Remember to vote on Sat–Sun to be eligible to win.',
          [{ text: 'Got it' }]
        );
      } else {
        Alert.alert('Submission Failed',
          'Could not save your entry. This may be because:\n\n' +
          '• You already submitted an entry for this challenge\n' +
          '• The submission window has closed\n' +
          '• Your session expired — try signing out and back in'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReplaceEntry = () => {
    const myEntry = weeklyChallenge?.my_entry;
    if (!myEntry) return;
    Alert.alert(
      'Replace Your Entry?',
      'This will permanently delete your current submission. You can then upload a new one. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete & Replace',
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteEntry(
              myEntry.id,
              myEntry.s3_upload_key,
              myEntry.thumbnail_s3_key,
            );
            if (ok) {
              Alert.alert('Entry Deleted', 'You can now submit a new entry.');
            } else {
              Alert.alert('Error', 'Could not delete your entry. Try again.');
            }
          },
        },
      ]
    );
  };

  const handleVote = async (entry: ChallengeEntry) => {
    if (!user) { Alert.alert('Sign in to vote'); return; }

    // Must have submitted to vote
    const ch = detailChallenge;
    if (!ch?.my_entry) {
      Alert.alert(
        'Entry Required',
        'You must submit an entry to be eligible to vote.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Cannot self-vote
    if (entry.pilot_id === user.id) {
      Alert.alert('Not allowed', 'You cannot vote for your own entry.');
      return;
    }

    const result = await vote(entry.id, entry.pilot_id, entry.has_voted ?? false);
    if (!result.success) {
      if (result.reason === 'self_vote') Alert.alert('Not allowed', 'Cannot vote for yourself.');
      return;
    }

    setEntries(prev => prev.map(e => {
      if (e.id !== entry.id) return e;
      const was = e.has_voted ?? false;
      return { ...e, has_voted: !was, vote_count: e.vote_count + (was ? -1 : 1) };
    }));

    // Mark challenge as voted
    loadChallenges(activeSeason?.id);
  };

  const handleSubmitSuggestion = async () => {
    if (!suggestTarget || !sugTitle.trim()) { Alert.alert('Title required'); return; }
    setSavingSug(true);
    const sug = await submitSuggestion({
      challengeId: suggestTarget.id,
      title: sugTitle.trim(),
      description: sugDesc || undefined,
    });
    setSavingSug(false);
    if (sug) {
      setSuggestVisible(false);
      setSugTitle(''); setSugDesc('');
      setSuggestions(prev => [{ ...sug, has_voted: false, vote_count: 0 }, ...prev]);
      Alert.alert('✅ Suggestion submitted!', 'Others can now vote on your idea!');
    } else {
      Alert.alert('Error', 'Could not submit suggestion. You may have already submitted one.');
    }
  };

  const handleVoteSuggestion = async (sug: ChallengeSuggestion) => {
    if (!user) { Alert.alert('Sign in to vote'); return; }
    const ok = await voteSuggestion(sug.id, sug.has_voted ?? false);
    if (ok) {
      setSuggestions(prev => prev.map(s => {
        if (s.id !== sug.id) return s;
        const was = s.has_voted ?? false;
        return { ...s, has_voted: !was, vote_count: s.vote_count + (was ? -1 : 1) };
      }));
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChallenges(activeSeason?.id);
    setRefreshing(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-renders
  // ─────────────────────────────────────────────────────────────────────────

  const renderPhaseBadge = (ch: Challenge) => {
    const phase = getChallengePhase(ch);
    if (phase === 'completed') return (
      <View style={[styles.badge, styles.badgeDone]}>
        <Text style={styles.badgeText}>Results In</Text>
      </View>
    );
    if (phase === 'voting') return (
      <View style={[styles.badge, styles.badgeVoting]}>
        <Ionicons name="thumbs-up-outline" size={10} color={C.cyan} />
        <Text style={[styles.badgeText, { color: C.cyan }]}>
          Voting · {timeLeft(ch.voting_closes_at)}
        </Text>
      </View>
    );
    return (
      <View style={[styles.badge, styles.badgeActive]}>
        <Ionicons name="videocam-outline" size={10} color={C.orange} />
        <Text style={[styles.badgeText, { color: C.orange }]}>
          Submit · {timeLeft(ch.submission_closes_at)}
        </Text>
      </View>
    );
  };

  // ── This Week's Challenge ─────────────────────────────────────────────────
  const renderThisWeek = () => {
    if (!weeklyChallenge) return (
      <View style={styles.empty}>
        <PropIcon size={56} color="#222" />
        <Text style={styles.emptyTitle}>No active challenge</Text>
        <Text style={styles.emptySub}>Check back Monday for this week's challenge!</Text>
      </View>
    );

    const phase = getChallengePhase(weeklyChallenge);
    const canSubmit = phase === 'submission' && !weeklyChallenge.my_entry && !!user;
    const canVote   = phase === 'voting';
    const hasVoted  = weeklyChallenge.has_voted ?? false;
    const hasEntry  = !!weeklyChallenge.my_entry;

    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.orange} />}
        contentContainerStyle={{ padding: 16, gap: 14 }}
      >
        {/* Hero card */}
        <LinearGradient
          colors={['#1a0a00', '#0d0d1f']}
          style={styles.heroCard}
        >
          <View style={styles.heroTop}>
            {renderPhaseBadge(weeklyChallenge)}
            <View style={styles.weekTag}>
              <Ionicons name="calendar-outline" size={11} color={C.muted} />
              <Text style={styles.weekTagText}>
                Week #{weeklyChallenge.week_number ?? '—'}
              </Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>{weeklyChallenge.title}</Text>
          {weeklyChallenge.description ? (
            <Text style={styles.heroDesc}>{weeklyChallenge.description}</Text>
          ) : null}
          {weeklyChallenge.rules ? (
            <View style={styles.rulesBox}>
              <Text style={styles.rulesLabel}>RULES</Text>
              <Text style={styles.rulesText}>{weeklyChallenge.rules}</Text>
              <Text style={[styles.rulesText, { marginTop: 6, color: '#4a5568' }]}>
                🏁 Ties in votes are broken by earliest submission time.
              </Text>
              <Text style={[styles.rulesText, { marginTop: 4, color: C.cyan + 'cc' }]}>
                🎭 All entries are anonymous during voting. Pilot names visible in OSD
                are automatically blurred to keep judging fair — remove them from
                Betaflight OSD before recording for the cleanest result.
              </Text>
            </View>
          ) : null}

          {/* Timeline */}
          <View style={styles.timelineRow}>
            <View style={[styles.timelineStep, phase === 'submission' && styles.timelineStepActive]}>
              <Ionicons name="videocam-outline" size={14}
                color={phase === 'submission' ? C.orange : C.muted} />
              <View>
                <Text style={[styles.timelineLabel, phase === 'submission' && { color: C.orange }]}>
                  MON–FRI
                </Text>
                <Text style={styles.timelineSub}>Submit</Text>
              </View>
            </View>
            <View style={styles.timelineConnector} />
            <View style={[styles.timelineStep, phase === 'voting' && styles.timelineStepActive]}>
              <Ionicons name="thumbs-up-outline" size={14}
                color={phase === 'voting' ? C.cyan : C.muted} />
              <View>
                <Text style={[styles.timelineLabel, phase === 'voting' && { color: C.cyan }]}>
                  SAT–SUN
                </Text>
                <Text style={styles.timelineSub}>Vote</Text>
              </View>
            </View>
            <View style={styles.timelineConnector} />
            <View style={[styles.timelineStep, phase === 'completed' && styles.timelineStepActive]}>
              <PropIcon size={14}
                color={phase === 'completed' ? C.gold : C.muted} />
              <View>
                <Text style={[styles.timelineLabel, phase === 'completed' && { color: C.gold }]}>
                  MONDAY
                </Text>
                <Text style={styles.timelineSub}>Results</Text>
              </View>
            </View>
          </View>

          {/* Entry count */}
          <Text style={styles.entryCountText}>
            {weeklyChallenge.entry_count ?? 0} submissions
          </Text>

          {/* CTA */}
          {canSubmit && (
            <TouchableOpacity
              style={styles.heroCTA}
              onPress={() => { setSubmitTarget(weeklyChallenge); setSubmitVisible(true); }}
            >
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
              <Text style={styles.heroCTAText}>Submit My Entry</Text>
            </TouchableOpacity>
          )}

          {/* Voting rules info */}
          {canVote && (
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={15} color={C.cyan} />
              <Text style={styles.infoText}>
                {hasEntry
                  ? hasVoted
                    ? '✅ You\'ve voted! Winners revealed Monday.'
                    : '⚠️ You must cast a vote to be eligible to win. Entries stay anonymous until voting closes.'
                  : '🎭 Entries are anonymous. Only participants who submitted can vote.'}
              </Text>
            </View>
          )}

          {hasEntry && phase === 'submission' && (
            <View style={{ gap: 8 }}>
              <View style={[styles.infoBox, { borderColor: C.green + '44', backgroundColor: C.green + '10' }]}>
                <Ionicons name="checkmark-circle-outline" size={15} color={C.green} />
                <Text style={[styles.infoText, { color: C.green }]}>
                  Entry submitted anonymously! Come back Sat–Sun to vote.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.heroCTA, { backgroundColor: '#1a0505', borderWidth: 1, borderColor: '#ff4500' + '66' }]}
                onPress={handleReplaceEntry}
              >
                <Ionicons name="refresh-outline" size={15} color={C.orange} />
                <Text style={[styles.heroCTAText, { color: C.orange }]}>Replace My Entry</Text>
              </TouchableOpacity>
            </View>
          )}
        </LinearGradient>

        {/* Prize card */}
        <View style={styles.prizeCard}>
          <Text style={styles.sectionLabel}>PRIZES</Text>
          <View style={styles.prizesRow}>
            {[
              { place: 1, label: '🥇 1st', colour: C.gold,   props: weeklyChallenge?.prize_first_props  ?? 500 },
              { place: 2, label: '🥈 2nd', colour: C.silver, props: weeklyChallenge?.prize_second_props ?? 300 },
              { place: 3, label: '🥉 3rd', colour: C.bronze, props: weeklyChallenge?.prize_third_props  ?? 150 },
            ].map(p => (
              <View key={p.place} style={[styles.prizeChip,
                { borderColor: p.colour + '44', backgroundColor: p.colour + '12' }]}>
                <Text style={[styles.prizeEmoji]}>{p.label}</Text>
                <Text style={[styles.prizeProps, { color: p.colour }]}>+{p.props} Props</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Entries / voting section */}
        <View>
          <TouchableOpacity style={styles.entriesHeaderBtn} onPress={() => setEntriesModalVisible(true)} activeOpacity={0.75}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="videocam-outline" size={15} color="#ff4500" />
              <Text style={[styles.sectionLabel, { color: '#ff4500' }]}>ENTRIES ({weeklyChallenge?.entry_count ?? entries.length})</Text>
              {phase === 'submission' && (
                <Text style={styles.anonNote}>🎭 Anonymous</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: '#ff4500', fontSize: 12, fontWeight: '600' }}>View all</Text>
              <Ionicons name="chevron-forward" size={14} color="#ff4500" />
            </View>
          </TouchableOpacity>
          {entriesLoading ? (
            <ActivityIndicator color={C.orange} style={{ marginTop: 20 }} />
          ) : entries.length === 0 ? (
            <View style={[styles.empty, { paddingTop: 20 }]}>
              <Text style={styles.emptySub}>No entries yet — be first!</Text>
            </View>
          ) : (
            entries.map(e => renderEntry(e, phase))
          )}
        </View>
      </ScrollView>
    );
  };

  // ── Archive ───────────────────────────────────────────────────────────────
  const renderArchive = () => (
    <FlatList
      data={archivedChallenges}
      keyExtractor={c => c.id}
      renderItem={({ item: ch }) => (
        <TouchableOpacity
          style={styles.archiveCard}
          onPress={() => setDetailChallenge(ch)}
          activeOpacity={0.85}
        >
          <View style={styles.archiveLeft}>
            <Text style={styles.archiveWeek}>Week #{ch.week_number ?? '—'}</Text>
            <Text style={styles.archiveTitle}>{ch.title}</Text>
            <Text style={styles.archiveMeta}>
              {ch.entry_count ?? 0} entries ·{' '}
              {new Date(ch.voting_closes_at).toLocaleDateString()}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.muted} />
        </TouchableOpacity>
      )}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.orange} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="archive-outline" size={48} color="#222" />
          <Text style={styles.emptyTitle}>No past challenges yet</Text>
        </View>
      }
    />
  );

  // ── Suggestions ───────────────────────────────────────────────────────────
  const renderSuggestions = () => (
    <View style={{ flex: 1 }}>
      {/* Info banner */}
      <View style={styles.suggestBanner}>
        <Ionicons name="bulb-outline" size={16} color={C.purple} />
        <Text style={styles.suggestBannerText}>
          Suggest the next challenge theme! The most-voted suggestion is revealed at the start of voting (Saturday) as next week's challenge.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.addSugBtn}
        onPress={() => {
          // Target the active/voting challenge, or any challenge available
          const target = challenges.find(c => getChallengePhase(c) !== 'completed') ?? challenges[0] ?? null;
          if (!target) { Alert.alert('No active challenge', 'Suggestions open when a challenge is running.'); return; }
          if (!user)   { Alert.alert('Sign in', 'You need to be signed in to suggest a theme.'); return; }
          setSuggestTarget(target);
          setSuggestVisible(true);
        }}
      >
        <Ionicons name="add-circle-outline" size={16} color={C.purple} />
        <Text style={styles.addSugBtnText}>+ Suggest an idea</Text>
      </TouchableOpacity>

      {sugsLoading ? (
        <ActivityIndicator color={C.orange} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={suggestions}
          keyExtractor={s => s.id}
          renderItem={({ item: s }) => (
            <View style={styles.sugCard}>
              <View style={styles.sugLeft}>
                <Text style={styles.sugTitle}>{s.title}</Text>
                {s.description ? (
                  <Text style={styles.sugDesc} numberOfLines={2}>{s.description}</Text>
                ) : null}
{/* username hidden to preserve suggestion anonymity */}
              </View>
              <TouchableOpacity
                style={[styles.sugVoteBtn, s.has_voted && styles.sugVoteBtnActive]}
                onPress={() => handleVoteSuggestion(s)}
              >
                <Ionicons
                  name={s.has_voted ? 'arrow-up-circle' : 'arrow-up-circle-outline'}
                  size={18}
                  color={s.has_voted ? C.purple : C.muted}
                />
                <Text style={[styles.sugVoteCount, s.has_voted && { color: C.purple }]}>
                  {s.vote_count}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          ListEmptyComponent={
            <View style={[styles.empty, { paddingTop: 30 }]}>
              <Ionicons name="bulb-outline" size={48} color="#222" />
              <Text style={styles.emptyTitle}>No suggestions yet</Text>
              <Text style={styles.emptySub}>Be the first to suggest a theme!</Text>
            </View>
          }
        />
      )}
    </View>
  );

  // ── Entry card ────────────────────────────────────────────────────────────
  const renderEntry = (e: ChallengeEntry, phase: 'submission' | 'voting' | 'completed') => {
    const isRevealed = phase === 'completed';
    const canVote    = phase === 'voting' &&
                       !!weeklyChallenge?.my_entry &&
                       e.pilot_id !== user?.id;
    const isSelf     = e.pilot_id === user?.id;

    return (
      <TouchableOpacity key={e.id} style={styles.entryCard} activeOpacity={0.85}
        onPress={() => e.video_url ? setPlayingEntry(e) : null}>
        {e.thumbnail_url ? (
          <View>
            <Image source={{ uri: e.thumbnail_url }} style={styles.entryThumb} resizeMode="cover" />
            {e.video_url && (
              <View style={styles.entryPlayOverlay}>
                <Ionicons name="play-circle" size={28} color="rgba(255,255,255,0.85)" />
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.entryThumb, styles.entryThumbPlaceholder]}>
            <Ionicons name="videocam-outline" size={24} color={C.muted} />
          </View>
        )}
        <View style={styles.entryInfo}>
          {isRevealed && e.user?.username ? (
            <Text style={styles.entryAuthor}>@{e.user.username}</Text>
          ) : isSelf ? (
            <Text style={[styles.entryAnon, { color: C.green }]}>🎭 Your entry</Text>
          ) : (
            <Text style={styles.entryAnon}>🎭 Anonymous Pilot</Text>
          )}
          {e.caption ? (
            <Text style={styles.entryCaption} numberOfLines={2}>{e.caption}</Text>
          ) : null}
          {e.final_rank != null && e.final_rank <= 3 && e.final_rank ? (
            <View style={[styles.winnerBadge,
              { backgroundColor: (PLACE_COLOURS[e.final_rank] ?? C.gold) + '22' }]}>
              <Text style={[styles.winnerText, { color: PLACE_COLOURS[e.final_rank] ?? C.gold }]}>
                {PLACE_LABELS[e.final_rank]} · +{propsForPlace(e.final_rank)} Props
              </Text>
            </View>
          ) : null}

          {/* OSD Moderation status badge — only shown to the entry owner */}
          {isSelf && e.moderation_status === 'pending' && (
            <View style={styles.moderationBadgePending}>
              <ActivityIndicator size={9} color={C.subtext} />
              <Text style={styles.moderationBadgeText}>Scanning OSD…</Text>
            </View>
          )}
          {isSelf && e.moderation_status === 'processing' && (
            <View style={styles.moderationBadgePending}>
              <ActivityIndicator size={9} color={C.cyan} />
              <Text style={[styles.moderationBadgeText, { color: C.cyan }]}>Processing video…</Text>
            </View>
          )}
          {isSelf && e.moderation_status === 'needs_review' && (
            <View style={styles.moderationBadgeReview}>
              <Ionicons name="eye-off-outline" size={10} color={C.cyan} />
              <Text style={[styles.moderationBadgeText, { color: C.cyan }]}>OSD blurring applied</Text>
            </View>
          )}

          {/* Duration row */}
          {e.duration_seconds ? (
            <Text style={styles.entryDur}>{Math.round(e.duration_seconds)}s</Text>
          ) : null}

          {/* Vote button — full width when voting is open */}
          {canVote ? (
            <TouchableOpacity
              style={[styles.voteBtnLarge, e.has_voted && styles.voteBtnLargeActive]}
              onPress={() => handleVote(e)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={e.has_voted ? 'thumbs-up' : 'thumbs-up-outline'}
                size={16}
                color={e.has_voted ? '#fff' : '#00d4ff'}
              />
              <Text style={[styles.voteBtnLargeText, e.has_voted && { color: '#fff' }]}>
                {e.has_voted ? '✓ Voted' : '👍 Vote'} · {e.vote_count}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.voteCount}>
              <Ionicons name="thumbs-up" size={12} color="#4a5568" />
              <Text style={styles.voteCountText}>{e.vote_count}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Leaderboard rows ──────────────────────────────────────────────────────
  const renderLeaderRow = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isTop3    = item.rank <= 3;
    const rankColor = PLACE_COLOURS[item.rank] || C.text;
    return (
      <View style={[styles.leaderRow, isTop3 && styles.leaderRowTop]}>
        <View style={[styles.rankBadge,
          { borderColor: rankColor + '66', backgroundColor: rankColor + '15' }]}>
          <Text style={[styles.rankText, { color: rankColor }]}>#{item.rank}</Text>
        </View>
        {item.avatar_url ? (
          <Image
            source={{ uri: item.avatar_url }}
            style={styles.leaderAvatar}
          />
        ) : (
          <View style={[styles.leaderAvatar, styles.leaderAvatarFallback]}>
            <Text style={styles.leaderAvatarInitial}>
              {(item.username ?? 'P')[0].toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.leaderInfo}>
          <Text style={styles.leaderName}>{item.username ?? 'Pilot'}</Text>
          {(item.location_label || item.city) && (
            <Text style={styles.leaderLocation}>
              📍 {item.location_label ?? item.city}
            </Text>
          )}
        </View>
        <View style={styles.propsDisplay}>
          <Text style={[styles.propsValue, { color: isTop3 ? rankColor : C.gold }]}>
            {item.earned_props}
          </Text>
          <Text style={styles.propsLabel}>PROPS</Text>
        </View>
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Animated.Text style={[styles.headerTitle, { color: headerColor }]}>
            FPV Challenges
          </Animated.Text>
          <TouchableOpacity
            style={styles.seasonPill}
            onPress={() => setSeasonPickerVisible(true)}
          >
            <Ionicons name="layers-outline" size={11} color={C.cyan} />
            <Text style={styles.seasonPillText}>{activeSeason?.name ?? 'Season 1'}</Text>
            <Ionicons name="chevron-down" size={11} color={C.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Top Screen Tab Bar ── */}
      <View style={styles.tabRow}>
        {(['challenges', 'leaderboard'] as ScreenTab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, screenTab === t && styles.tabBtnActive]}
            onPress={() => setScreenTab(t)}
          >
            {t === 'challenges'
              ? <PropIcon size={15} color={screenTab === t ? C.orange : C.muted} />
              : <Ionicons name="podium-outline" size={15} color={screenTab === t ? C.orange : C.muted} />
            }
            <Text style={[styles.tabBtnText, screenTab === t && styles.tabBtnTextActive]}>
              {t === 'challenges' ? 'Challenges' : 'Leaderboard'}
            </Text>
            {screenTab === t && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Challenges Content ── */}
      {screenTab === 'challenges' && (
        <View style={{ flex: 1 }}>
          {/* Sub-tab bar */}
          <View style={styles.subTabRow}>
            {([
              { key: 'this_week', label: '📅 This Week' },
              { key: 'archive',   label: '📁 Archive'   },
              { key: 'suggest',   label: '💡 Suggest'   },
            ] as { key: ChallengeSubTab; label: string }[]).map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.subTab, chalSubTab === t.key && styles.subTabActive]}
                onPress={() => setChalSubTab(t.key)}
              >
                <Text style={[styles.subTabText, chalSubTab === t.key && styles.subTabTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading && challenges.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={C.orange} />
            </View>
          ) : (
            <>
              {chalSubTab === 'this_week' && renderThisWeek()}
              {chalSubTab === 'archive'   && renderArchive()}
              {chalSubTab === 'suggest'   && renderSuggestions()}
            </>
          )}
        </View>
      )}

      {/* ── Leaderboard Content ── */}
      {screenTab === 'leaderboard' && (
        <View style={{ flex: 1 }}>
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            style={styles.leadTabScroll}
            contentContainerStyle={styles.leadTabRow}
          >
            {([
              { key: 'global', label: '🌍 Global'  },
              { key: 'local',  label: '📍 Local'   },
              { key: 'season', label: '🗓 Season'   },
            ] as { key: LeadTab; label: string }[]).map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.leadTab, leadTab === t.key && styles.leadTabActive]}
                onPress={() => setLeadTab(t.key)}
              >
                <Text style={[styles.leadTabText, leadTab === t.key && styles.leadTabTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {leadTab === 'season' && (
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              style={styles.seasonRow}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 8, flexDirection: 'row' }}
            >
              {seasons.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.seasonChip, leadSeason?.id === s.id && styles.seasonChipActive]}
                  onPress={() => setLeadSeason(s)}
                >
                  <Text style={[styles.seasonChipText, leadSeason?.id === s.id && styles.seasonChipTextActive]}>
                    {s.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {leadLoad ? (
            <View style={styles.centered}><ActivityIndicator color={C.orange} /></View>
          ) : (
            <FlatList
              data={leadRows}
              keyExtractor={r => r.user_id ?? r.id ?? String(r.rank)}
              renderItem={renderLeaderRow}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                <View style={styles.leaderHeader}>
                  <Text style={styles.leaderHeaderText}>
                    {leadTab === 'global' ? '🌍 All-Time Global'
                   : leadTab === 'local'  ? '📍 Local Pilots'
                   : `🗓 ${leadSeason?.name ?? 'Season'} Rankings`}
                  </Text>
                  <Text style={styles.leaderHeaderSub}>
                    Ranked by props earned — spending never affects rank
                  </Text>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="podium-outline" size={56} color="#222" />
                  <Text style={styles.emptyTitle}>No rankings yet</Text>
                  <Text style={styles.emptySub}>Win challenges to earn props!</Text>
                </View>
              }
            />
          )}
        </View>
      )}

      {/* ════ Entries List Modal ════ */}
      <Modal
        visible={entriesModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setEntriesModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#070710', paddingTop: 52 }}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalTitle}>
              Entries ({detailChallenge?.entry_count ?? weeklyChallenge?.entry_count ?? entries.length})
              {currentPhase === 'submission' ? '  🎭 Anonymous' : ''}
            </Text>
            <TouchableOpacity onPress={() => setEntriesModalVisible(false)}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          {entriesLoading ? (
            <ActivityIndicator color="#ff4500" style={{ marginTop: 40 }} />
          ) : entries.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="videocam-outline" size={56} color="#222" />
              <Text style={styles.emptyTitle}>No entries yet</Text>
              <Text style={styles.emptySub}>Be the first to submit!</Text>
            </View>
          ) : (
            <FlatList
              data={entries}
              keyExtractor={e => e.id}
              renderItem={({ item: e }) => renderEntry(e, currentPhase ?? 'submission')}
              contentContainerStyle={{ padding: 12, gap: 10 }}
            />
          )}
          {/* Video player rendered inside this modal so it stacks on top */}
          {playingEntry?.video_url && (
            <EntryVideoPlayer
              uri={playingEntry.video_url}
              onClose={() => setPlayingEntry(null)}
            />
          )}
        </View>
      </Modal>

      {/* ════ Submit Entry Modal ════ */}
      <Modal visible={submitVisible} animationType="slide" transparent
        onRequestClose={() => setSubmitVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Submit Entry</Text>
              <TouchableOpacity onPress={() => setSubmitVisible(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Anonymous notice */}
              <View style={styles.infoBox}>
                <Ionicons name="eye-off-outline" size={14} color={C.cyan} />
                <Text style={styles.infoText}>
                  Your identity stays 100% anonymous until voting ends Sunday night.
                  You must cast a vote during Sat–Sun to be eligible to win.
                </Text>
              </View>

              {/* Compliance rules */}
              <View style={[styles.infoBox, styles.infoBoxWarning]}>
                <Ionicons name="shield-checkmark-outline" size={14} color={C.gold} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.infoText, { color: C.gold, fontWeight: '700' }]}>
                    Submission Rules
                  </Text>
                  <Text style={styles.infoText}>
                    {'• Direct video upload only — no links accepted\n• No visible faces or people\n• No logos, branding, or watermarks\n• FPV footage only — skill over identity\n• No OSD pilot names / callsigns (auto-blurred if detected)\n• Violations auto-detected & rejected\n• Ties broken by earliest submission time'}
                  </Text>
                </View>
              </View>

              {/* AI check result banner */}
              {checking && (
                <View style={[styles.infoBox, { borderColor: C.cyan + '44' }]}>
                  <ActivityIndicator size="small" color={C.cyan} />
                  <Text style={[styles.infoText, { color: C.cyan }]}>
                    Scanning for faces & logos…
                  </Text>
                </View>
              )}
              {checkResult && !checkResult.approved && (
                <View style={[styles.infoBox, styles.infoBoxRejected]}>
                  <Ionicons name="close-circle-outline" size={16} color="#fc8181" />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.infoText, { color: '#fc8181', fontWeight: '800' }]}>
                      Video rejected — please choose a different clip
                    </Text>
                    {checkResult.issues.map((issue, i) => (
                      <Text key={i} style={[styles.infoText, { color: '#fc8181' }]}>
                        ⚠️ {issue}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
              {checkResult?.approved && (
                <View style={[styles.infoBox, styles.infoBoxApproved]}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={C.green} />
                  <Text style={[styles.infoText, { color: C.green }]}>
                    Video passed content check ✓
                  </Text>
                </View>
              )}

              {/* OSD pilot name auto-blur notice */}
              {checkResult?.issues?.some(i => i.includes('OSD pilot name')) && (
                <View style={[styles.infoBox, { borderColor: C.cyan + '55', backgroundColor: '#001a22' }]}>
                  <Ionicons name="eye-off-outline" size={15} color={C.cyan} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.infoText, { color: C.cyan, fontWeight: '700' }]}>
                      OSD Pilot Name Detected — Auto-Blur Applied
                    </Text>
                    <Text style={styles.infoText}>
                      Your pilot name was found in the OSD. It will be automatically blurred
                      before your entry goes live. No action needed — your entry is still accepted.
                    </Text>
                  </View>
                </View>
              )}

              {/* Video picker */}
              <TouchableOpacity style={styles.videoPicker} onPress={handlePickVideo}>
                {entryUri ? (
                  <View style={styles.videoPreview}>
                    {entryThumb ? (
                      <Image source={{ uri: entryThumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : null}
                    <View style={styles.videoOverlay}>
                      <Ionicons name="checkmark-circle" size={32} color={C.green} />
                      <Text style={styles.videoOverlayText}>{Math.round(entryDuration)}s · Tap to change</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.videoPlaceholder}>
                    <Ionicons name="cloud-upload-outline" size={36} color={C.muted} />
                    <Text style={styles.videoPlaceholderText}>Tap to pick video (max 2 min)</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Thumbnail selector */}
              {entryFrames.length > 0 && (
                <View style={styles.thumbPickerWrap}>
                  <Text style={styles.fieldLabel}>Choose thumbnail</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, flexDirection: 'row' }}>
                    {entryFrames.map((f, i) => (
                      <TouchableOpacity
                        key={i}
                        style={[styles.thumbFrame, entryThumb === f && styles.thumbFrameSelected]}
                        onPress={() => setEntryThumb(f)}
                      >
                        <Image source={{ uri: f }} style={styles.thumbFrameImg} />
                        {entryThumb === f && (
                          <View style={styles.thumbCheck}>
                            <Ionicons name="checkmark-circle" size={18} color={C.orange} />
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
              {thumbLoading && (
                <View style={styles.thumbLoadRow}>
                  <ActivityIndicator size="small" color={C.orange} />
                  <Text style={styles.thumbLoadText}>Generating frames…</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>Caption (optional)</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="Describe your flight…"
                placeholderTextColor={C.muted}
                value={entryCaption}
                onChangeText={setEntryCaption}
                maxLength={200}
                color={C.text}
              />

              {/* Prizes reminder */}
              <View style={styles.prizesRow}>
                {[{ p: 1, l: '🥇', c: C.gold,   v: submitTarget?.prize_first_props  ?? 500 },
                  { p: 2, l: '🥈', c: C.silver, v: submitTarget?.prize_second_props ?? 300 },
                  { p: 3, l: '🥉', c: C.bronze, v: submitTarget?.prize_third_props  ?? 150 }].map(x => (
                  <View key={x.p} style={[styles.prizeChip,
                    { borderColor: x.c + '44', backgroundColor: x.c + '12' }]}>
                    <Text style={styles.prizeEmoji}>{x.l}</Text>
                    <Text style={[styles.prizeProps, { color: x.c }]}>+{x.v}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (submitting || checking || !entryUri || (checkResult && !checkResult.approved))
                    && styles.primaryBtnDisabled
                ]}
                onPress={handleSubmitEntry}
                disabled={submitting || checking || !entryUri || (checkResult != null && !checkResult.approved)}
              >
                {checking ? (
                  <>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.primaryBtnText}>Checking content…</Text>
                  </>
                ) : submitting ? (
                  <>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.primaryBtnText}>Uploading…</Text>
                  </>
                ) : checkResult && !checkResult.approved ? (
                  <>
                    <Ionicons name="close-circle-outline" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Pick a different video</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="eye-off-outline" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Submit Anonymously</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ════ Suggest Modal ════ */}
      <Modal visible={suggestVisible} animationType="slide" transparent
        onRequestClose={() => setSuggestVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>💡 Suggest a Theme</Text>
              <TouchableOpacity onPress={() => setSuggestVisible(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.infoBox, { borderColor: C.purple + '44', backgroundColor: C.purple + '10' }]}>
                <Ionicons name="bulb-outline" size={14} color={C.purple} />
                <Text style={[styles.infoText, { color: C.subtext }]}>
                  The most-voted suggestion each week becomes the following week's challenge, announced Saturday at voting time.
                </Text>
              </View>
              <Text style={styles.fieldLabel}>Theme Title *</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. Best Night Flight, Slowest Roll…"
                placeholderTextColor={C.muted}
                value={sugTitle}
                onChangeText={setSugTitle}
                maxLength={80}
                color={C.text}
              />
              <Text style={styles.fieldLabel}>Details (optional)</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldTextarea]}
                placeholder="Describe the theme or any rules you'd like…"
                placeholderTextColor={C.muted}
                value={sugDesc}
                onChangeText={setSugDesc}
                multiline
                maxLength={400}
                color={C.text}
              />
              <TouchableOpacity
                style={[styles.primaryBtn,
                  { backgroundColor: C.purple },
                  (!sugTitle.trim() || savingSug) && styles.primaryBtnDisabled]}
                onPress={handleSubmitSuggestion}
                disabled={!sugTitle.trim() || savingSug}
              >
                {savingSug
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Submit Suggestion</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ════ Archive Detail Modal ════ */}
      <Modal
        visible={!!detailChallenge && getChallengePhase(detailChallenge) === 'completed'}
        animationType="slide" transparent
        onRequestClose={() => { setDetailChallenge(null); setEntries([]); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { flex: 1, maxHeight: '94%' }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {detailChallenge?.title}
              </Text>
              <TouchableOpacity onPress={() => { setDetailChallenge(null); setEntries([]); }}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            {detailChallenge && (
              <>
                <Text style={styles.archiveMeta}>
                  Week #{detailChallenge.week_number ?? '—'} ·{' '}
                  Ended {new Date(detailChallenge.voting_closes_at).toLocaleDateString()}
                </Text>
                <Text style={styles.sectionLabel}>RESULTS</Text>
                {entriesLoading ? (
                  <ActivityIndicator color={C.orange} />
                ) : (
                  <FlatList
                    data={entries}
                    keyExtractor={e => e.id}
                    renderItem={({ item: e }) => renderEntry(e, 'completed')}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 40 }}
                    ListEmptyComponent={
                      <View style={styles.empty}>
                        <Text style={styles.emptySub}>No entries recorded.</Text>
                      </View>
                    }
                  />
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ════ Season Picker Modal ════ */}
      <Modal visible={seasonPickerVisible} animationType="fade" transparent
        onRequestClose={() => setSeasonPickerVisible(false)}>
        <TouchableOpacity style={styles.seasonPickerOverlay}
          onPress={() => setSeasonPickerVisible(false)}>
          <View style={styles.seasonPickerSheet}>
            <Text style={styles.seasonPickerTitle}>Select Season</Text>
            {seasons.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.seasonPickerRow, activeSeason?.id === s.id && styles.seasonPickerRowActive]}
                onPress={() => { setActiveSeason(s); setSeasonPickerVisible(false); loadChallenges(s.id); }}
              >
                <Text style={[styles.seasonPickerRowText, activeSeason?.id === s.id && { color: C.orange }]}>
                  {s.name}{s.is_active ? ' · Active' : ''}
                </Text>
                {activeSeason?.id === s.id && <Ionicons name="checkmark" size={16} color={C.orange} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
      {/* ── Props award toast ─────────────────────────────────────── */}
      <PropsToast toast={propsToast} />

      {/* ════════════════════════════════════════════════════════════
          ADMIN: Floating moderation button (only visible to admins)
          ════════════════════════════════════════════════════════════ */}
      {isAdmin && (
        <TouchableOpacity
          style={styles.adminFAB}
          onPress={handleOpenAdminPanel}
          activeOpacity={0.85}
        >
          <Ionicons name="shield-checkmark" size={20} color="#fff" />
          {flaggedEntries.length > 0 && (
            <View style={styles.adminFABBadge}>
              <Text style={styles.adminFABBadgeText}>{flaggedEntries.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* ════════════════════════════════════════════════════════════
          ADMIN PANEL MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        visible={adminPanelVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setAdminPanelVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '92%' }]}>
            {/* Header */}
            <View style={styles.adminPanelHeader}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="shield-checkmark" size={18} color={C.orange} />
                  <Text style={styles.adminPanelTitle}>OSD Moderation</Text>
                </View>
                <Text style={styles.adminPanelSub}>
                  {adminTab === 'queue'
                    ? (flaggedEntries.length === 0
                        ? 'All clear — queue empty'
                        : `${flaggedEntries.length} need${flaggedEntries.length === 1 ? 's' : ''} review`)
                    : `${allAdminEntries.length} total entries`}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setAdminPanelVisible(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Tab switcher */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <TouchableOpacity
                style={[styles.adminTabBtn, adminTab === 'queue' && styles.adminTabBtnActive]}
                onPress={() => { setAdminTab('queue'); loadFlaggedEntries(); }}
              >
                <Ionicons name="flag-outline" size={13} color={adminTab === 'queue' ? '#000' : C.cyan} />
                <Text style={[styles.adminTabBtnText, adminTab === 'queue' && { color: '#000' }]}>
                  Review Queue {flaggedEntries.length > 0 ? `(${flaggedEntries.length})` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adminTabBtn, adminTab === 'all' && styles.adminTabBtnActive]}
                onPress={() => { setAdminTab('all'); loadAllEntries(); }}
              >
                <Ionicons name="list-outline" size={13} color={adminTab === 'all' ? '#000' : C.cyan} />
                <Text style={[styles.adminTabBtnText, adminTab === 'all' && { color: '#000' }]}>
                  Spot-Check All
                </Text>
              </TouchableOpacity>
            </View>

            {/* Loading / empty state */}
            {(adminTab === 'queue' ? adminLoading : allAdminLoading) && (
              <ActivityIndicator size="small" color={C.cyan} style={{ marginVertical: 20 }} />
            )}
            {adminTab === 'queue' && !adminLoading && flaggedEntries.length === 0 && (
              <View style={styles.adminEmpty}>
                <Ionicons name="checkmark-circle" size={48} color={C.green} />
                <Text style={styles.adminEmptyTitle}>Queue is clear!</Text>
                <Text style={styles.adminEmptyText}>All entries have been reviewed.</Text>
              </View>
            )}
            {adminTab === 'all' && !allAdminLoading && allAdminEntries.length === 0 && (
              <View style={styles.adminEmpty}>
                <Ionicons name="layers-outline" size={48} color={C.muted} />
                <Text style={styles.adminEmptyTitle}>No entries yet.</Text>
                <Text style={styles.adminEmptyText}>Submitted entries will appear here.</Text>
              </View>
            )}

            {/* Entry list */}
            <FlatList
              data={adminTab === 'queue' ? flaggedEntries : allAdminEntries}
              keyExtractor={e => e.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingVertical: 8 }}
              renderItem={({ item: entry }) => {
                const isActioning = adminActionId === entry.id;
                const callsignFlags = (entry.moderation_flags ?? [])
                  .filter((f: any) => f.type === 'pilot_name');
                const statusColor =
                  entry.moderation_status === 'needs_review' ? '#ffcc00' :
                  entry.moderation_status === 'pending'      ? C.muted :
                  entry.moderation_status === 'processing'   ? C.cyan  : C.text;

                return (
                  <View style={styles.adminEntryCard}>
                    {/* Thumbnail + play */}
                    <TouchableOpacity
                      onPress={() => {
                        // Close admin panel first to avoid nested-Modal conflict on iOS,
                        // then launch the full-screen video player.
                        // We stash the entry so it can be restored when player closes.
                        setAdminPreviewEntry(entry);
                        setAdminPanelVisible(false);
                      }}
                      activeOpacity={0.8}
                    >
                      {entry.thumbnail_url ? (
                        <View style={styles.adminThumbWrap}>
                          <Image
                            source={{ uri: entry.thumbnail_url }}
                            style={styles.adminThumb}
                            resizeMode="cover"
                          />
                          <View style={styles.adminThumbOverlay}>
                            <Ionicons name="play-circle" size={32} color="rgba(255,255,255,0.9)" />
                          </View>
                        </View>
                      ) : (
                        <View style={[styles.adminThumbWrap, styles.adminThumbPlaceholder]}>
                          <Ionicons name="videocam-outline" size={28} color={C.muted} />
                        </View>
                      )}
                    </TouchableOpacity>

                    {/* Entry info */}
                    <View style={styles.adminEntryInfo}>
                      {/* Challenge + entry number */}
                      <Text style={styles.adminChallengeTitle} numberOfLines={1}>
                        {entry.challenge_title}
                      </Text>
                      <Text style={styles.adminEntryNum}>
                        Entry #{entry.entry_number}
                        {entry.duration_seconds ? `  ·  ${entry.duration_seconds}s` : ''}
                      </Text>

                      {/* Status pill */}
                      <View style={[styles.adminStatusPill, { borderColor: statusColor + '55' }]}>
                        <View style={[styles.adminStatusDot, { backgroundColor: statusColor }]} />
                        <Text style={[styles.adminStatusText, { color: statusColor }]}>
                          {entry.moderation_status.replace('_', ' ')}
                        </Text>
                      </View>

                      {/* Detected callsign flags */}
                      {callsignFlags.length > 0 && (
                        <View style={styles.adminFlagsWrap}>
                          <Text style={styles.adminFlagsLabel}>DETECTED:</Text>
                          {callsignFlags.map((f: any, i: number) => (
                            <View key={i} style={styles.adminFlagChip}>
                              <Ionicons name="eye-off-outline" size={10} color={C.orange} />
                              <Text style={styles.adminFlagText}>"{f.text}"</Text>
                              {f.confidence ? (
                                <Text style={styles.adminFlagConf}>
                                  {Math.round(f.confidence * 100)}%
                                </Text>
                              ) : null}
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Approve / Reject / Override buttons */}
                      <View style={styles.adminActionRow}>
                        {entry.moderation_status === 'approved' ? (
                          // Spot-check tab: approved entry — only Override available
                          <TouchableOpacity
                            style={[styles.adminOverrideBtn, isActioning && { opacity: 0.5 }]}
                            onPress={() => { setOverrideTargetId(entry.id); setOverrideReason(''); }}
                            disabled={isActioning}
                          >
                            <Ionicons name="flag-outline" size={14} color="#fff" />
                            <Text style={styles.adminOverrideBtnText}>Flag for Review</Text>
                          </TouchableOpacity>
                        ) : (
                          <>
                        <TouchableOpacity
                          style={[styles.adminApproveBtn, isActioning && { opacity: 0.5 }]}
                          onPress={() => handleAdminApprove(entry)}
                          disabled={isActioning}
                        >
                          {isActioning
                            ? <ActivityIndicator size={12} color="#fff" />
                            : <Ionicons name="checkmark-circle" size={14} color="#fff" />}
                          <Text style={styles.adminApproveBtnText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.adminRejectBtn, isActioning && { opacity: 0.5 }]}
                          onPress={() => handleAdminRejectOpen(entry)}
                          disabled={isActioning}
                        >
                          <Ionicons name="close-circle" size={14} color="#fff" />
                          <Text style={styles.adminRejectBtnText}>Reject</Text>
                        </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          ADMIN: Video preview modal (full screen)
          ════════════════════════════════════════════════════════════ */}
      {/* Admin video preview — rendered OUTSIDE admin panel modal to avoid nesting */}
      {adminPreviewEntry !== null && (
        <AdminVideoPlayer
          entry={adminPreviewEntry}
          onClose={() => {
            setAdminPreviewEntry(null);
            // Reopen the admin panel so admin can continue reviewing
            setAdminPanelVisible(true);
          }}
        />
      )}


      {/* ════════════════════════════════════════════════════════════
          ADMIN: Override / flag-for-review modal
          ════════════════════════════════════════════════════════════ */}
      <Modal
        visible={overrideTargetId !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setOverrideTargetId(null)}
      >
        <View style={styles.rejectModalOverlay}>
          <View style={styles.rejectModalCard}>
            <Text style={styles.rejectModalTitle}>Flag for Review</Text>
            <Text style={styles.rejectModalSub}>
              This entry was auto-approved. Flagging it will move it back into the
              admin queue so you can watch the video and decide.
            </Text>
            <TextInput
              style={[styles.fieldInput, { marginTop: 12 }]}
              placeholder="Reason (e.g. pilot name visible at 0:12)"
              placeholderTextColor={C.muted}
              value={overrideReason}
              onChangeText={setOverrideReason}
            />
            <View style={styles.rejectModalBtns}>
              <TouchableOpacity
                style={styles.rejectCancelBtn}
                onPress={() => setOverrideTargetId(null)}
              >
                <Text style={styles.rejectCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adminOverrideBtn, { flex: 1 }]}
                onPress={async () => {
                  if (!overrideTargetId) return;
                  const ok = await overrideToReview(overrideTargetId, overrideReason || 'admin_spot_check');
                  if (ok) {
                    setAdminTab('queue');
                    setOverrideTargetId(null);
                  }
                }}
              >
                <Ionicons name="flag" size={14} color="#fff" />
                <Text style={styles.adminOverrideBtnText}>Flag It</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          ADMIN: Reject reason modal
          ════════════════════════════════════════════════════════════ */}
      <Modal
        visible={rejectModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setRejectModalVisible(false)}
      >
        <View style={styles.rejectModalOverlay}>
          <View style={styles.rejectModalCard}>
            <Text style={styles.rejectModalTitle}>Reject Entry #{rejectTarget?.entry_number}</Text>
            <Text style={styles.rejectModalSub}>
              The pilot will not be told why — only that their entry was not accepted.
            </Text>
            <TextInput
              style={[styles.fieldInput, { marginTop: 12 }]}
              placeholder="Reason (admin notes only, not shown to pilot)"
              placeholderTextColor={C.muted}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              numberOfLines={3}
              color={C.text}
            />
            <View style={styles.rejectModalButtons}>
              <TouchableOpacity
                style={styles.rejectModalCancel}
                onPress={() => setRejectModalVisible(false)}
              >
                <Text style={styles.rejectModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rejectModalConfirm}
                onPress={handleAdminRejectConfirm}
                disabled={adminActionId === rejectTarget?.id}
              >
                {adminActionId === rejectTarget?.id
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.rejectModalConfirmText}>Confirm Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10,
    backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 22, fontWeight: '900', letterSpacing: 1.2 },
  seasonPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
    backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: C.border,
  },
  seasonPillText: { color: C.cyan, fontSize: 11, fontWeight: '600' },

  // Screen tabs
  tabRow: { flexDirection: 'row', backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, gap: 6, position: 'relative' },
  tabBtnActive: {},
  tabBtnText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  tabBtnTextActive: { color: C.text, fontWeight: '800' },
  tabUnderline: { position: 'absolute', bottom: 0, left: 20, right: 20, height: 2,
    borderRadius: 2, backgroundColor: C.orange },

  // Sub-tabs
  subTabRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  subTab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  subTabActive: { borderBottomWidth: 2, borderBottomColor: C.orange },
  subTabText: { color: C.muted, fontSize: 12, fontWeight: '600' },
  subTabTextActive: { color: C.text, fontWeight: '800' },

  listContent: { padding: 12, gap: 12 } as any,
  empty:       { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle:  { color: C.text, fontSize: 18, fontWeight: '700' },
  emptySub:    { color: C.muted, fontSize: 13 },

  // Hero card
  heroCard: {
    borderRadius: 20, padding: 18, gap: 12,
    borderWidth: 1, borderColor: C.border,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroTitle: { color: C.text, fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  heroDesc:  { color: C.subtext, fontSize: 14, lineHeight: 20 },
  weekTag:   { flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: C.border },
  weekTagText: { color: C.muted, fontSize: 11, fontWeight: '600' },

  // Timeline
  timelineRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
  timelineStep: { alignItems: 'center', gap: 4, flex: 1, opacity: 0.45 },
  timelineStepActive: { opacity: 1 },
  timelineLabel: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  timelineSub:   { color: C.muted, fontSize: 10 },
  timelineConnector: { width: 20, height: 1, backgroundColor: C.border },

  entryCountText: { color: C.muted, fontSize: 12 },

  heroCTA: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.orange, borderRadius: 14, paddingVertical: 13,
  },
  heroCTAText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Prize card
  prizeCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, gap: 10,
    borderWidth: 1, borderColor: C.border },
  prizesRow: { flexDirection: 'row', gap: 8 } as any,
  prizeChip: { flex: 1, alignItems: 'center', borderRadius: 12, padding: 10,
    borderWidth: 1 },
  prizeEmoji: { fontSize: 15, fontWeight: '800' },
  prizeProps: { fontSize: 12, fontWeight: '700', marginTop: 3 },

  // Section
  sectionRow:  { flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8 },
  sectionLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  anonNote:     { color: C.muted, fontSize: 11, fontStyle: 'italic' },

  // Archive
  archiveCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  archiveLeft:  { flex: 1, gap: 3 },
  archiveWeek:  { color: C.muted, fontSize: 11, fontWeight: '600' },
  archiveTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  archiveMeta:  { color: C.muted, fontSize: 11, marginTop: 2 },

  // Suggestions
  suggestBanner: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: C.purple + '12', padding: 12, margin: 12, borderRadius: 12,
    borderWidth: 1, borderColor: C.purple + '33',
  },
  suggestBannerText: { flex: 1, color: C.subtext, fontSize: 12, lineHeight: 17 },
  addSugBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    marginHorizontal: 12, marginBottom: 4, paddingVertical: 10,
    backgroundColor: C.purple + '15', borderRadius: 12,
    borderWidth: 1, borderColor: C.purple + '44',
  },
  addSugBtnText: { color: C.purple, fontSize: 14, fontWeight: '700' },
  sugCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  sugLeft:      { flex: 1, gap: 3 },
  sugTitle:     { color: C.text, fontSize: 14, fontWeight: '700' },
  sugDesc:      { color: C.subtext, fontSize: 12, lineHeight: 16 },
  sugAuthor:    { color: C.muted, fontSize: 11 },
  sugVoteBtn:   { alignItems: 'center', gap: 2, padding: 6 },
  sugVoteBtnActive: {},
  sugVoteCount: { color: C.muted, fontSize: 12, fontWeight: '700' },

  // Status badges
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  badgeText:   { fontSize: 10, fontWeight: '700' },
  badgeActive: { borderColor: C.orange + '44', backgroundColor: C.orange + '15' },
  badgeVoting: { borderColor: C.cyan   + '44', backgroundColor: C.cyan   + '15' },
  badgeDone:   { borderColor: '#333',           backgroundColor: '#1a1a1a' },

  // Leaderboard
  leadTabScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: C.border },
  leadTabRow:    { paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' } as any,
  leadTab:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  leadTabActive: { borderColor: C.orange, backgroundColor: C.orange + '20' },
  leadTabText:   { color: C.muted, fontSize: 13, fontWeight: '600' },
  leadTabTextActive: { color: C.orange, fontWeight: '800' },
  leaderHeader:  { padding: 16, paddingBottom: 4 },
  leaderHeaderText: { color: C.text, fontSize: 16, fontWeight: '800' },
  leaderHeaderSub:  { color: C.muted, fontSize: 11, marginTop: 3 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  leaderRowTop: { backgroundColor: '#0f1520' },
  rankBadge:    { width: 38, height: 38, borderRadius: 10, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center' },
  rankText:     { fontSize: 13, fontWeight: '800' },
  leaderAvatar:        { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card },
  leaderAvatarFallback:{ justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a2540' },
  leaderAvatarInitial: { color: C.cyan, fontSize: 16, fontWeight: '800' },
  leaderInfo:   { flex: 1 },
  leaderName:   { color: C.text, fontSize: 14, fontWeight: '700' },
  leaderLocation: { color: C.muted, fontSize: 11, marginTop: 2 },
  propsDisplay: { alignItems: 'flex-end' },
  propsValue:   { fontSize: 18, fontWeight: '900' },
  propsLabel:   { color: C.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  seasonRow:    { flexGrow: 0, paddingVertical: 8 },
  seasonChip:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  seasonChipActive: { borderColor: C.orange, backgroundColor: C.orange + '20' },
  seasonChipText:     { color: C.muted, fontSize: 12, fontWeight: '600' },
  seasonChipTextActive: { color: C.orange, fontWeight: '800' },

  // Entry card
  voteBtnLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(0,212,255,0.5)',
    backgroundColor: 'rgba(0,212,255,0.08)',
  },
  voteBtnLargeActive: {
    backgroundColor: '#00d4ff',
    borderColor: '#00d4ff',
  },
  voteBtnLargeText: {
    color: '#00d4ff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  entriesHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,69,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,69,0,0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  entryPlayOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
  },
  entryCard: { flexDirection: 'row', gap: 12, padding: 12,
    borderBottomWidth: 1, borderBottomColor: C.border },
  entryThumb: { width: 80, height: 56, borderRadius: 10, backgroundColor: C.card },
  entryThumbPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  entryInfo:    { flex: 1, gap: 4 },
  entryAuthor:  { color: C.cyan, fontSize: 13, fontWeight: '700' },
  entryAnon:    { color: C.muted, fontSize: 12, fontStyle: 'italic' },
  entryCaption: { color: C.subtext, fontSize: 12 },
  winnerBadge:  { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  winnerText:   { fontSize: 11, fontWeight: '800' },
  // ── OSD Moderation badges ──────────────────────────────────────────────────
  moderationBadgePending: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    alignSelf: 'flex-start' as const,
    backgroundColor: '#1a1a2e', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3, marginTop: 3,
  },
  moderationBadgeReview: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    alignSelf: 'flex-start' as const,
    backgroundColor: '#001a22', borderRadius: 8, borderWidth: 1, borderColor: '#00d4ff44',
    paddingHorizontal: 7, paddingVertical: 3, marginTop: 3,
  },
  moderationBadgeText: { fontSize: 10, color: '#4a5568', fontWeight: '600' as const },
  voteRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  voteBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 12, backgroundColor: '#1a2030',
    borderWidth: 1, borderColor: C.border },
  voteBtnActive:  { borderColor: C.cyan + '66', backgroundColor: C.cyan + '15' },
  voteBtnText:    { color: C.muted, fontSize: 12, fontWeight: '600' },
  voteCount:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteCountText:  { color: C.muted, fontSize: 12 },
  entryDur:       { color: C.muted, fontSize: 11 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '88%', padding: 20, paddingBottom: 40,
  },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: C.text, fontSize: 18, fontWeight: '800', flex: 1, marginRight: 12 },

  // Form
  fieldLabel:   { color: C.muted, fontSize: 12, fontWeight: '600',
    letterSpacing: 0.5, marginBottom: 6, marginTop: 12 },
  fieldInput:   { backgroundColor: '#0a0f1a', borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 12, color: C.text, fontSize: 14 },
  fieldTextarea: { minHeight: 80, textAlignVertical: 'top' },

  infoBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: C.cyan + '15', borderRadius: 10, padding: 10, marginTop: 4,
    borderWidth: 1, borderColor: C.cyan + '33' },
  infoText: { color: C.subtext, fontSize: 12, flex: 1, lineHeight: 17 },
  infoBoxWarning:  { borderColor: C.gold  + '44', backgroundColor: C.gold  + '10' },
  infoBoxRejected: { borderColor: '#fc818144', backgroundColor: '#fc818110', alignItems: 'flex-start' },
  infoBoxApproved: { borderColor: C.green + '44', backgroundColor: C.green + '10' },

  rulesBox:  { backgroundColor: '#0a0f1a', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.border },
  rulesLabel: { color: C.orange, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.5, marginBottom: 4 },
  rulesText:  { color: C.subtext, fontSize: 12, lineHeight: 17 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.orange, borderRadius: 14, paddingVertical: 14, marginTop: 16,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText:     { color: '#fff', fontSize: 15, fontWeight: '800' },

  videoPicker: { backgroundColor: '#0a0f1a', borderRadius: 14, overflow: 'hidden',
    height: 170, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  videoPreview: { width: '100%', height: '100%' },
  videoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', gap: 6 },
  videoOverlayText: { color: '#fff', fontSize: 12 },
  videoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  videoPlaceholderText: { color: C.muted, fontSize: 13 },

  thumbPickerWrap: { marginBottom: 12 },
  thumbFrame:      { width: 72, height: 50, borderRadius: 8, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent' },
  thumbFrameSelected: { borderColor: C.orange },
  thumbFrameImg:   { width: '100%', height: '100%', resizeMode: 'cover' },
  thumbCheck:      { position: 'absolute', bottom: 2, right: 2,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 9 },
  thumbLoadRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 } as any,
  thumbLoadText:   { color: C.muted, fontSize: 12 },

  seasonPickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  seasonPickerSheet:   { backgroundColor: C.card, borderTopLeftRadius: 20,
    borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  seasonPickerTitle:   { color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 14 },
  seasonPickerRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  seasonPickerRowActive: {},
  seasonPickerRowText:   { color: C.subtext, fontSize: 14 },

  // ── Admin Panel ────────────────────────────────────────────────────────────
  adminFAB: {
    position: 'absolute' as const,
    bottom: 90, right: 18,
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: C.orange,
    justifyContent: 'center' as const, alignItems: 'center' as const,
    shadowColor: C.orange, shadowOpacity: 0.55, shadowRadius: 10,
    elevation: 8,
  },
  adminFABBadge: {
    position: 'absolute' as const, top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#ff0033',
    justifyContent: 'center' as const, alignItems: 'center' as const,
    paddingHorizontal: 4,
  },
  adminFABBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' as const },

  // ── Admin tab buttons ──────────────────────────────────────────────────────
  adminTabBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 5,
    paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: '#00e5ff44',
    backgroundColor: 'transparent',
  },
  adminTabBtnActive: {
    backgroundColor: '#00e5ff',
    borderColor: '#00e5ff',
  },
  adminTabBtnText: {
    color: '#00e5ff', fontSize: 12, fontWeight: '600' as const,
  },

  // ── Override (flag-for-review) button ────────────────────────────────────
  adminOverrideBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    gap: 5, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#e67e22', borderRadius: 7,
  },
  adminOverrideBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' as const },

  adminPanelHeader: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 10, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  adminPanelTitle: { color: C.text, fontSize: 17, fontWeight: '800' as const },
  adminPanelSub:   { color: C.subtext, fontSize: 12 },

  adminRefreshBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: C.cyan + '15', borderRadius: 10,
    borderWidth: 1, borderColor: C.cyan + '33', marginBottom: 12,
  },
  adminRefreshText: { color: C.cyan, fontSize: 12, fontWeight: '600' as const },

  adminEmpty: {
    alignItems: 'center' as const, paddingVertical: 40, gap: 10,
  },
  adminEmptyTitle: { color: C.text, fontSize: 16, fontWeight: '700' as const },
  adminEmptyText:  { color: C.subtext, fontSize: 13 },

  adminEntryCard: {
    flexDirection: 'row' as const, gap: 12,
    backgroundColor: '#0d0d1f', borderRadius: 14,
    padding: 10, borderWidth: 1, borderColor: C.border,
  },
  adminThumbWrap: {
    width: 90, height: 70, borderRadius: 10, overflow: 'hidden' as const,
    backgroundColor: '#0a0f1a',
  },
  adminThumbPlaceholder: {
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  adminThumb:      { width: '100%', height: '100%' },
  adminThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center' as const, alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },

  adminEntryInfo:   { flex: 1, gap: 5 },
  adminChallengeTitle: { color: C.text, fontSize: 13, fontWeight: '700' as const },
  adminEntryNum:    { color: C.subtext, fontSize: 11 },

  adminStatusPill: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    alignSelf: 'flex-start' as const,
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  adminStatusDot:  { width: 6, height: 6, borderRadius: 3 },
  adminStatusText: { fontSize: 11, fontWeight: '600' as const, textTransform: 'capitalize' as const },

  adminFlagsWrap: { gap: 4 },
  adminFlagsLabel: {
    color: C.muted, fontSize: 10, fontWeight: '700' as const,
    letterSpacing: 0.5, textTransform: 'uppercase' as const,
  },
  adminFlagChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    backgroundColor: C.orange + '18', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' as const,
  },
  adminFlagText: { color: C.orange, fontSize: 11, fontWeight: '600' as const },
  adminFlagConf: { color: C.muted, fontSize: 10 },

  adminActionRow: {
    flexDirection: 'row' as const, gap: 8, marginTop: 4,
  },
  adminApproveBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 5,
    backgroundColor: '#1a4a2e', borderRadius: 10,
    borderWidth: 1, borderColor: C.green + '55',
    paddingVertical: 8,
  },
  adminApproveBtnText: { color: C.green, fontSize: 12, fontWeight: '700' as const },
  adminRejectBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 5,
    backgroundColor: '#3a0a0a', borderRadius: 10,
    borderWidth: 1, borderColor: '#ff444455',
    paddingVertical: 8,
  },
  adminRejectBtnText: { color: '#ff4444', fontSize: 12, fontWeight: '700' as const },

  // ── Reject reason modal ──────────────────────────────────────────────────
  rejectModalOverlay: {
    flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.75)', padding: 24,
  },
  rejectModalCard: {
    width: '100%', backgroundColor: C.card, borderRadius: 18,
    padding: 20, borderWidth: 1, borderColor: C.border,
  },
  rejectModalTitle: { color: C.text, fontSize: 16, fontWeight: '800' as const, marginBottom: 6 },
  rejectModalSub:   { color: C.subtext, fontSize: 12, lineHeight: 17 },
  rejectModalButtons: {
    flexDirection: 'row' as const, gap: 10, marginTop: 16,
  },
  rejectModalCancel: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: C.border,
    alignItems: 'center' as const,
  },
  rejectModalCancelText: { color: C.subtext, fontSize: 14, fontWeight: '600' as const },
  rejectModalConfirm: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    backgroundColor: '#3a0a0a', borderWidth: 1, borderColor: '#ff444455',
    alignItems: 'center' as const,
  },
  rejectModalConfirmText: { color: '#ff4444', fontSize: 14, fontWeight: '800' as const },
});
