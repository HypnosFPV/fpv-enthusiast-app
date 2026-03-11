// app/(tabs)/challenges.tsx
// Full FPV Challenge & Leaderboard screen

import React, {
  useState, useCallback, useEffect, useRef, useMemo,
} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, TextInput, ScrollView, ActivityIndicator, Alert,
  RefreshControl, Image, Dimensions, StatusBar, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/services/supabase';
import {
  useChallenges,
  Challenge, ChallengeEntry, LeaderboardEntry,
  LeaderboardScope, Season,
  timeLeft, propsForPlace,
} from '../../src/hooks/useChallenges';

const { width: W } = Dimensions.get('window');

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  bg:       '#070710',
  card:     '#0d0d1f',
  border:   '#1e2a3a',
  orange:   '#ff4500',
  cyan:     '#00d4ff',
  gold:     '#ffd700',
  silver:   '#c0c0c0',
  bronze:   '#cd7f32',
  muted:    '#4a5568',
  text:     '#e2e8f0',
  subtext:  '#718096',
};

const PLACE_COLOURS = ['', C.gold, C.silver, C.bronze];
const PLACE_LABELS  = ['', '🥇 1st', '🥈 2nd', '🥉 3rd'];

// ─── Screen Tabs ─────────────────────────────────────────────────────────────
type ScreenTab = 'challenges' | 'leaderboard';
type LeadTab   = LeaderboardScope;

// ─────────────────────────────────────────────────────────────────────────────
export default function ChallengesScreen() {
  const router   = useRouter();
  const { user } = useAuth();

  const {
    seasons, activeSeason, setActiveSeason,
    challenges, loading,
    loadChallenges, createChallenge, submitEntry,
    loadEntries, vote, loadLeaderboard,
  } = useChallenges(user?.id);

  // ── Top-level tab ─────────────────────────────────────────────────────────
  const [screenTab, setScreenTab] = useState<ScreenTab>('challenges');

  // ── Modals ────────────────────────────────────────────────────────────────
  const [createVisible,  setCreateVisible]  = useState(false);
  const [detailChallenge, setDetailChallenge] = useState<Challenge | null>(null);
  const [submitVisible,  setSubmitVisible]  = useState(false);
  const [submitTarget,   setSubmitTarget]   = useState<Challenge | null>(null);

  // ── Create form ───────────────────────────────────────────────────────────
  const [newTitle, setNewTitle]   = useState('');
  const [newDesc,  setNewDesc]    = useState('');
  const [newRules, setNewRules]   = useState('');
  const [saving,   setSaving]     = useState(false);

  // ── Submit entry form ─────────────────────────────────────────────────────
  const [entryUri,    setEntryUri]    = useState<string | null>(null);
  const [entryThumb,  setEntryThumb]  = useState<string | null>(null);
  const [entryFrames, setEntryFrames] = useState<string[]>([]);
  const [entryCaption, setEntryCaption] = useState('');
  const [entryDuration, setEntryDuration] = useState<number>(0);
  const [thumbLoading,  setThumbLoading]  = useState(false);
  const [submitting,    setSubmitting]    = useState(false);

  // ── Detail / voting ───────────────────────────────────────────────────────
  const [entries,       setEntries]       = useState<ChallengeEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [refreshing,    setRefreshing]    = useState(false);

  // ── Leaderboard ───────────────────────────────────────────────────────────
  const [leadTab,    setLeadTab]    = useState<LeadTab>('global');
  const [leadRows,   setLeadRows]   = useState<LeaderboardEntry[]>([]);
  const [leadLoad,   setLeadLoad]   = useState(false);
  const [leadSeason, setLeadSeason] = useState<Season | null>(activeSeason);

  // ── Season picker ─────────────────────────────────────────────────────────
  const [seasonPickerVisible, setSeasonPickerVisible] = useState(false);

  // ── Header animation ──────────────────────────────────────────────────────
  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(headerAnim, { toValue: 1, duration: 4000, useNativeDriver: false })
    ).start();
  }, []);
  const headerColor = headerAnim.interpolate({
    inputRange: [0, 0.33, 0.66, 1],
    outputRange: [C.orange, '#ff8c00', C.orange, '#ff6600'],
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Load entries when detail modal opens
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!detailChallenge) return;
    const done = detailChallenge.status === 'completed' ||
                 new Date(detailChallenge.voting_ends) < new Date();
    setEntriesLoading(true);
    loadEntries(detailChallenge.id, done)
      .then(setEntries)
      .finally(() => setEntriesLoading(false));
  }, [detailChallenge]);

  // Load leaderboard when tab / season changes
  useEffect(() => {
    if (screenTab !== 'leaderboard') return;
    setLeadLoad(true);
    const sid = leadTab === 'season' ? (leadSeason?.id ?? activeSeason?.id) : undefined;
    loadLeaderboard(leadTab, sid)
      .then(setLeadRows)
      .finally(() => setLeadLoad(false));
  }, [screenTab, leadTab, leadSeason]);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newTitle.trim()) { Alert.alert('Title required'); return; }
    setSaving(true);
    const ch = await createChallenge({ title: newTitle.trim(), description: newDesc, rules: newRules });
    setSaving(false);
    if (ch) {
      setCreateVisible(false);
      setNewTitle(''); setNewDesc(''); setNewRules('');
    } else {
      Alert.alert('Error', 'Could not create challenge.');
    }
  };

  const handlePickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission required'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    // Validate duration
    const dur = (asset.duration ?? 0) / 1000;
    if (dur > 120) {
      Alert.alert('Too long', 'Max 2 minutes per entry. Your video is ' + Math.ceil(dur) + 's.');
      return;
    }
    setEntryUri(asset.uri);
    setEntryDuration(dur);
    // Generate thumbnail frames
    setThumbLoading(true);
    setEntryFrames([]); setEntryThumb(null);
    try {
      const durationMs = (asset.duration ?? 5000);
      const frames: string[] = [];
      for (let i = 0; i < 8; i++) {
        const time = Math.floor(durationMs * (i / 7));
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(asset.uri, { time });
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
    setSubmitting(true);
    try {
      // Upload video
      const ext = entryUri.split('.').pop()?.split('?')[0]?.toLowerCase() ?? 'mp4';
      const mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      const resp = await fetch(entryUri);
      const buf  = await resp.arrayBuffer();
      const path = `challenges/${submitTarget.id}/${user!.id}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('posts').upload(path, buf, { contentType: mime, upsert: false });
      if (upErr) { Alert.alert('Upload failed', upErr.message); return; }
      const { data: urlData } = supabase.storage.from('posts').getPublicUrl(path);
      const videoUrl = urlData.publicUrl;

      // Upload thumbnail
      let thumbUrl: string | undefined;
      if (entryThumb) {
        try {
          const tr = await fetch(entryThumb);
          const tb = await tr.arrayBuffer();
          const tp = `challenges/${submitTarget.id}/${user!.id}_thumb_${Date.now()}.jpg`;
          const { error: tErr } = await supabase.storage
            .from('posts').upload(tp, tb, { contentType: 'image/jpeg', upsert: false });
          if (!tErr) {
            const { data: td } = supabase.storage.from('posts').getPublicUrl(tp);
            thumbUrl = td.publicUrl;
          }
        } catch { /* skip */ }
      }

      const entry = await submitEntry({
        challengeId: submitTarget.id,
        videoUrl,
        thumbnailUrl: thumbUrl,
        durationS: entryDuration,
        caption: entryCaption,
      });

      if (entry) {
        setSubmitVisible(false);
        setEntryUri(null); setEntryThumb(null); setEntryFrames([]);
        setEntryCaption(''); setEntryDuration(0);
        Alert.alert('✅ Entry submitted!', 'Your video has been submitted anonymously. Good luck!');
      } else {
        Alert.alert('Error', 'Submission failed. You may have already entered.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = async (entry: ChallengeEntry) => {
    if (!user) { Alert.alert('Sign in to vote'); return; }
    if (entry.user_id === user.id) { Alert.alert('Cannot vote for your own entry'); return; }
    const newEntries = entries.map(e => {
      if (e.id === entry.id) {
        const wasVoted = e.has_voted ?? false;
        return { ...e, has_voted: !wasVoted, vote_count: e.vote_count + (wasVoted ? -1 : 1) };
      }
      return e;
    });
    setEntries(newEntries);
    await vote(entry.id, entry.has_voted ?? false);
  };

  const onRefreshChallenges = async () => {
    setRefreshing(true);
    await loadChallenges(activeSeason?.id);
    setRefreshing(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-renders
  // ─────────────────────────────────────────────────────────────────────────

  const renderStatusBadge = (ch: Challenge) => {
    const now = new Date();
    const subEnd  = new Date(ch.submission_ends);
    const voteEnd = new Date(ch.voting_ends);
    const isDone  = ch.status === 'completed' || voteEnd < now;
    const isVoting = !isDone && subEnd < now;

    if (isDone) return <View style={[styles.badge, styles.badgeDone]}><Text style={styles.badgeText}>Completed</Text></View>;
    if (isVoting) return (
      <View style={[styles.badge, styles.badgeVoting]}>
        <Ionicons name="thumbs-up-outline" size={10} color={C.cyan} />
        <Text style={[styles.badgeText, { color: C.cyan }]}>Voting · {timeLeft(ch.voting_ends)}</Text>
      </View>
    );
    return (
      <View style={[styles.badge, styles.badgeActive]}>
        <Ionicons name="videocam-outline" size={10} color={C.orange} />
        <Text style={[styles.badgeText, { color: C.orange }]}>Open · {timeLeft(ch.submission_ends)}</Text>
      </View>
    );
  };

  const renderChallengeCard = ({ item: ch }: { item: Challenge }) => {
    const now     = new Date();
    const isDone  = ch.status === 'completed' || new Date(ch.voting_ends) < now;
    const isVoting = !isDone && new Date(ch.submission_ends) < now;
    const canSubmit = !isDone && !isVoting && !ch.my_entry && !!user;

    return (
      <TouchableOpacity
        style={styles.challengeCard}
        onPress={() => setDetailChallenge(ch)}
        activeOpacity={0.85}
      >
        <View style={styles.cardTop}>
          {renderStatusBadge(ch)}
          <Text style={styles.entryCount}>{ch.entry_count ?? 0} entries</Text>
        </View>
        <Text style={styles.challengeTitle}>{ch.title}</Text>
        {ch.description ? (
          <Text style={styles.challengeDesc} numberOfLines={2}>{ch.description}</Text>
        ) : null}
        <View style={styles.cardFooter}>
          <View style={styles.cardFooterLeft}>
            <Ionicons name="calendar-outline" size={12} color={C.muted} />
            <Text style={styles.cardMetaText}>
              {isDone ? 'Results in' : isVoting ? 'Results' : 'Voting'} {timeLeft(ch.voting_ends)}
            </Text>
          </View>
          {canSubmit && (
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={() => { setSubmitTarget(ch); setSubmitVisible(true); }}
            >
              <Ionicons name="cloud-upload-outline" size={13} color="#fff" />
              <Text style={styles.submitBtnText}>Submit</Text>
            </TouchableOpacity>
          )}
          {ch.my_entry && (
            <View style={styles.enteredBadge}>
              <Ionicons name="checkmark-circle" size={13} color={C.cyan} />
              <Text style={styles.enteredText}>Entered</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderLeaderRow = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isTop3 = item.rank <= 3;
    const rankColor = PLACE_COLOURS[item.rank] || C.text;
    return (
      <View style={[styles.leaderRow, isTop3 && styles.leaderRowTop]}>
        <View style={[styles.rankBadge, { borderColor: rankColor + '66', backgroundColor: rankColor + '15' }]}>
          <Text style={[styles.rankText, { color: rankColor }]}>#{item.rank}</Text>
        </View>
        <Image
          source={{ uri: item.avatar_url ?? undefined }}
          style={styles.leaderAvatar}
          defaultSource={require('../../assets/icon.png') as any}
        />
        <View style={styles.leaderInfo}>
          <Text style={styles.leaderName}>{item.username ?? 'Pilot'}</Text>
          {(item.location_label || item.city) && (
            <Text style={styles.leaderLocation}>
              <Ionicons name="location-outline" size={10} color={C.muted} />
              {' '}{item.location_label ?? item.city}
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

  const renderEntry = ({ item: e }: { item: ChallengeEntry }) => {
    const isCompleted = detailChallenge?.status === 'completed' ||
      (detailChallenge && new Date(detailChallenge.voting_ends) < new Date());
    const canVote = !isCompleted &&
      detailChallenge?.status !== 'active' &&
      user?.id !== e.user_id;

    return (
      <View style={styles.entryCard}>
        {e.thumbnail_url ? (
          <Image source={{ uri: e.thumbnail_url }} style={styles.entryThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.entryThumb, styles.entryThumbPlaceholder]}>
            <Ionicons name="videocam-outline" size={28} color={C.muted} />
          </View>
        )}
        <View style={styles.entryInfo}>
          {/* Anonymous until voting done */}
          {isCompleted && e.user?.username ? (
            <Text style={styles.entryAuthor}>@{e.user.username}</Text>
          ) : (
            <Text style={styles.entryAnon}>🎭 Anonymous</Text>
          )}
          {e.caption ? <Text style={styles.entryCaption} numberOfLines={2}>{e.caption}</Text> : null}
          {e.is_winner && e.place ? (
            <View style={[styles.winnerBadge, { backgroundColor: (PLACE_COLOURS[e.place] ?? C.gold) + '22' }]}>
              <Text style={[styles.winnerText, { color: PLACE_COLOURS[e.place] ?? C.gold }]}>
                {PLACE_LABELS[e.place]} · +{propsForPlace(e.place)} Props
              </Text>
            </View>
          ) : null}
          <View style={styles.voteRow}>
            {canVote ? (
              <TouchableOpacity
                style={[styles.voteBtn, e.has_voted && styles.voteBtnActive]}
                onPress={() => handleVote(e)}
              >
                <Ionicons
                  name={e.has_voted ? 'thumbs-up' : 'thumbs-up-outline'}
                  size={14}
                  color={e.has_voted ? C.cyan : C.muted}
                />
                <Text style={[styles.voteBtnText, e.has_voted && { color: C.cyan }]}>
                  {e.vote_count}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.voteCount}>
                <Ionicons name="thumbs-up" size={13} color={C.muted} />
                <Text style={styles.voteCountText}>{e.vote_count}</Text>
              </View>
            )}
            {e.duration_s ? (
              <Text style={styles.entryDur}>{Math.round(e.duration_s)}s</Text>
            ) : null}
          </View>
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
        {screenTab === 'challenges' && (
          <TouchableOpacity style={styles.createBtn} onPress={() => setCreateVisible(true)}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.createBtnText}>New</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Top Tab Bar ── */}
      <View style={styles.tabRow}>
        {(['challenges', 'leaderboard'] as ScreenTab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, screenTab === t && styles.tabBtnActive]}
            onPress={() => setScreenTab(t)}
          >
            <Ionicons
              name={t === 'challenges' ? 'trophy-outline' : 'podium-outline'}
              size={15}
              color={screenTab === t ? C.orange : C.muted}
            />
            <Text style={[styles.tabBtnText, screenTab === t && styles.tabBtnTextActive]}>
              {t === 'challenges' ? 'Challenges' : 'Leaderboard'}
            </Text>
            {screenTab === t && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Challenges List ── */}
      {screenTab === 'challenges' && (
        loading && challenges.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={C.orange} />
          </View>
        ) : (
          <FlatList
            data={challenges}
            keyExtractor={c => c.id}
            renderItem={renderChallengeCard}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefreshChallenges} tintColor={C.orange} />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="trophy-outline" size={56} color="#222" />
                <Text style={styles.emptyTitle}>No challenges yet</Text>
                <Text style={styles.emptySub}>Be the first to start one!</Text>
              </View>
            }
          />
        )
      )}

      {/* ── Leaderboard ── */}
      {screenTab === 'leaderboard' && (
        <View style={{ flex: 1 }}>
          {/* Sub-tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.leadTabScroll}
            contentContainerStyle={styles.leadTabRow}
          >
            {([
              { key: 'global',  label: '🌍 Global',  icon: 'earth-outline'   },
              { key: 'local',   label: '📍 Local',   icon: 'location-outline' },
              { key: 'season',  label: '🗓 Season',  icon: 'layers-outline'   },
            ] as { key: LeadTab; label: string; icon: string }[]).map(t => (
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

          {/* Season selector for season tab */}
          {leadTab === 'season' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
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
            <View style={styles.centered}>
              <ActivityIndicator color={C.orange} />
            </View>
          ) : (
            <FlatList
              data={leadRows}
              keyExtractor={r => r.user_id ?? r.id ?? String(r.rank)}
              renderItem={renderLeaderRow}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                <View style={styles.leaderHeader}>
                  <Text style={styles.leaderHeaderText}>
                    {leadTab === 'global'  ? '🌍 All-Time Global'
                   : leadTab === 'local'   ? '📍 Local Pilots'
                   : `🗓 ${leadSeason?.name ?? 'Season'} Rankings`}
                  </Text>
                  <Text style={styles.leaderHeaderSub}>
                    Ranked by props earned — spending props doesn't affect rank
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

      {/* ════════════════════════════════════════════════════════
          ── Create Challenge Modal ──
      ════════════════════════════════════════════════════════ */}
      <Modal visible={createVisible} animationType="slide" transparent
        onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>New Challenge</Text>
              <TouchableOpacity onPress={() => setCreateVisible(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Title *</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. Best Bando Line"
                placeholderTextColor={C.muted}
                value={newTitle}
                onChangeText={setNewTitle}
                maxLength={80}
              />
              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldTextarea]}
                placeholder="What's the challenge about?"
                placeholderTextColor={C.muted}
                value={newDesc}
                onChangeText={setNewDesc}
                multiline
                maxLength={500}
              />
              <Text style={styles.fieldLabel}>Rules</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldTextarea]}
                placeholder="Any specific rules for entries?"
                placeholderTextColor={C.muted}
                value={newRules}
                onChangeText={setNewRules}
                multiline
                maxLength={500}
              />
              {/* Info box */}
              <View style={styles.infoBox}>
                <Ionicons name="information-circle-outline" size={16} color={C.cyan} />
                <Text style={styles.infoText}>
                  Submissions open for 5 days · Voting for 2 days · Max 2 min videos · Anonymous entries
                </Text>
              </View>
              {/* Props prizes */}
              <View style={styles.prizesRow}>
                {[1,2,3].map(p => (
                  <View key={p} style={[styles.prizeChip, { borderColor: (PLACE_COLOURS[p] ?? C.gold) + '66' }]}>
                    <Text style={[styles.prizePlace, { color: PLACE_COLOURS[p] }]}>{PLACE_LABELS[p]}</Text>
                    <Text style={[styles.prizeProps, { color: PLACE_COLOURS[p] }]}>+{propsForPlace(p)} Props</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
                onPress={handleCreate}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Start Challenge</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════
          ── Submit Entry Modal ──
      ════════════════════════════════════════════════════════ */}
      <Modal visible={submitVisible} animationType="slide" transparent
        onRequestClose={() => setSubmitVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Submit Entry</Text>
              <TouchableOpacity onPress={() => setSubmitVisible(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.challengeNameLabel}>{submitTarget?.title}</Text>
              {/* Video picker */}
              <TouchableOpacity style={styles.videoPicker} onPress={handlePickVideo}>
                {entryThumb ? (
                  <Image source={{ uri: entryThumb }} style={styles.videoPreview} resizeMode="cover" />
                ) : (
                  <View style={styles.videoPlaceholder}>
                    <Ionicons name="cloud-upload-outline" size={40} color={C.muted} />
                    <Text style={styles.videoPlaceholderText}>Tap to select video (max 2 min)</Text>
                  </View>
                )}
              </TouchableOpacity>
              {/* Thumbnail picker */}
              {entryFrames.length > 0 && (
                <View style={styles.thumbPickerWrap}>
                  <Text style={styles.fieldLabel}>Choose thumbnail</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8 }}>
                    {entryFrames.map((uri, i) => (
                      <TouchableOpacity key={i} onPress={() => setEntryThumb(uri)}
                        style={[styles.thumbFrame, entryThumb === uri && styles.thumbFrameSelected]}>
                        <Image source={{ uri }} style={styles.thumbFrameImg} />
                        {entryThumb === uri && (
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
                placeholder="Describe your entry…"
                placeholderTextColor={C.muted}
                value={entryCaption}
                onChangeText={setEntryCaption}
                maxLength={200}
              />
              <View style={styles.infoBox}>
                <Ionicons name="eye-off-outline" size={14} color={C.cyan} />
                <Text style={styles.infoText}>
                  Your identity stays anonymous until voting ends.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, (submitting || !entryUri) && styles.primaryBtnDisabled]}
                onPress={handleSubmitEntry}
                disabled={submitting || !entryUri}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Submit Anonymously</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════
          ── Challenge Detail Modal ──
      ════════════════════════════════════════════════════════ */}
      <Modal
        visible={!!detailChallenge}
        animationType="slide"
        transparent
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

            {detailChallenge && renderStatusBadge(detailChallenge)}

            {/* Timeline pills */}
            {detailChallenge && (
              <View style={styles.timelinePills}>
                <View style={styles.timelinePill}>
                  <Ionicons name="videocam-outline" size={11} color={C.orange} />
                  <Text style={styles.timelinePillText}>
                    Submit by {new Date(detailChallenge.submission_ends).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.timelinePill}>
                  <Ionicons name="thumbs-up-outline" size={11} color={C.cyan} />
                  <Text style={styles.timelinePillText}>
                    Vote by {new Date(detailChallenge.voting_ends).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            )}

            {detailChallenge?.description ? (
              <Text style={styles.detailDesc}>{detailChallenge.description}</Text>
            ) : null}
            {detailChallenge?.rules ? (
              <View style={styles.rulesBox}>
                <Text style={styles.rulesLabel}>Rules</Text>
                <Text style={styles.rulesText}>{detailChallenge.rules}</Text>
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>
              Entries ({entries.length})
              {detailChallenge && detailChallenge.status === 'active' &&
                new Date(detailChallenge.submission_ends) > new Date() &&
                '  · Anonymous until voting ends'}
            </Text>

            {entriesLoading ? (
              <View style={styles.centered}><ActivityIndicator color={C.orange} /></View>
            ) : (
              <FlatList
                data={entries}
                keyExtractor={e => e.id}
                renderItem={renderEntry}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 40 }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Ionicons name="videocam-outline" size={48} color="#222" />
                    <Text style={styles.emptyTitle}>No entries yet</Text>
                    {detailChallenge?.status === 'active' && (
                      <Text style={styles.emptySub}>Be the first to submit!</Text>
                    )}
                  </View>
                }
              />
            )}

            {/* Submit from detail */}
            {detailChallenge && !detailChallenge.my_entry &&
              detailChallenge.status === 'active' &&
              new Date(detailChallenge.submission_ends) > new Date() && (
              <TouchableOpacity
                style={[styles.primaryBtn, { marginHorizontal: 0, marginTop: 8 }]}
                onPress={() => {
                  setDetailChallenge(null);
                  setSubmitTarget(detailChallenge);
                  setSubmitVisible(true);
                }}
              >
                <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Submit My Entry</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Season Picker Modal ── */}
      <Modal visible={seasonPickerVisible} animationType="fade" transparent
        onRequestClose={() => setSeasonPickerVisible(false)}>
        <TouchableOpacity style={styles.seasonPickerOverlay} onPress={() => setSeasonPickerVisible(false)}>
          <View style={styles.seasonPickerSheet}>
            <Text style={styles.seasonPickerTitle}>Select Season</Text>
            {seasons.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.seasonPickerRow, activeSeason?.id === s.id && styles.seasonPickerRowActive]}
                onPress={() => { setActiveSeason(s); setSeasonPickerVisible(false); loadChallenges(s.id); }}
              >
                <Text style={[styles.seasonPickerRowText, activeSeason?.id === s.id && { color: C.orange }]}>
                  {s.name} {s.is_active ? '· Active' : ''}
                </Text>
                {activeSeason?.id === s.id && <Ionicons name="checkmark" size={16} color={C.orange} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },

  // Header
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
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.orange, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  createBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Tab bar
  tabRow: {
    flexDirection: 'row', backgroundColor: C.bg,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, gap: 6, position: 'relative' },
  tabBtnActive: {},
  tabBtnText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  tabBtnTextActive: { color: C.text, fontWeight: '800' },
  tabUnderline: { position: 'absolute', bottom: 0, left: 20, right: 20, height: 2,
    borderRadius: 2, backgroundColor: C.orange },

  // List
  listContent: { padding: 12, gap: 12 } as any,
  empty:       { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle:  { color: C.text, fontSize: 18, fontWeight: '700' },
  emptySub:    { color: C.muted, fontSize: 13 },

  // Challenge card
  challengeCard: {
    backgroundColor: C.card, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, padding: 14, gap: 8,
  },
  cardTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  challengeTitle:  { color: C.text, fontSize: 17, fontWeight: '800' },
  challengeDesc:   { color: C.subtext, fontSize: 13, lineHeight: 18 },
  cardFooter:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  cardFooterLeft:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardMetaText:    { color: C.muted, fontSize: 11 },
  entryCount:      { color: C.muted, fontSize: 11 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.orange, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  submitBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  enteredBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  enteredText:  { color: C.cyan, fontSize: 12, fontWeight: '600' },

  // Status badges
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  badgeText:   { fontSize: 10, fontWeight: '700' },
  badgeActive: { borderColor: C.orange + '44', backgroundColor: C.orange + '15' },
  badgeVoting: { borderColor: C.cyan   + '44', backgroundColor: C.cyan   + '15' },
  badgeDone:   { borderColor: '#333',           backgroundColor: '#1a1a1a'       },

  // Leaderboard
  leadTabScroll:   { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: C.border },
  leadTabRow:      { paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' } as any,
  leadTab:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  leadTabActive:   { borderColor: C.orange, backgroundColor: C.orange + '20' },
  leadTabText:     { color: C.muted, fontSize: 13, fontWeight: '600' },
  leadTabTextActive: { color: C.orange, fontWeight: '800' },
  leaderHeader:    { padding: 16, paddingBottom: 4 },
  leaderHeaderText:{ color: C.text, fontSize: 16, fontWeight: '800' },
  leaderHeaderSub: { color: C.muted, fontSize: 11, marginTop: 3 },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  leaderRowTop: { backgroundColor: '#0f1520' },
  rankBadge: { width: 38, height: 38, borderRadius: 10, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center' },
  rankText:    { fontSize: 13, fontWeight: '800' },
  leaderAvatar:{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card },
  leaderInfo:  { flex: 1 },
  leaderName:  { color: C.text, fontSize: 14, fontWeight: '700' },
  leaderLocation: { color: C.muted, fontSize: 11, marginTop: 2 },
  propsDisplay:{ alignItems: 'flex-end' },
  propsValue:  { fontSize: 18, fontWeight: '900' },
  propsLabel:  { color: C.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  seasonRow:   { flexGrow: 0, paddingVertical: 8 },
  seasonChip:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  seasonChipActive: { borderColor: C.orange, backgroundColor: C.orange + '20' },
  seasonChipText:     { color: C.muted, fontSize: 12, fontWeight: '600' },
  seasonChipTextActive: { color: C.orange, fontWeight: '800' },

  // Entry card
  entryCard: {
    flexDirection: 'row', gap: 12,
    padding: 12, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  entryThumb:           { width: 80, height: 56, borderRadius: 10, backgroundColor: C.card },
  entryThumbPlaceholder:{ justifyContent: 'center', alignItems: 'center' },
  entryInfo:  { flex: 1, gap: 4 },
  entryAuthor:{ color: C.cyan, fontSize: 13, fontWeight: '700' },
  entryAnon:  { color: C.muted, fontSize: 12, fontStyle: 'italic' },
  entryCaption:{ color: C.subtext, fontSize: 12 },
  winnerBadge:{ alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  winnerText: { fontSize: 11, fontWeight: '800' },
  voteRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  voteBtn:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 12, backgroundColor: '#1a2030',
    borderWidth: 1, borderColor: C.border },
  voteBtnActive: { borderColor: C.cyan + '66', backgroundColor: C.cyan + '15' },
  voteBtnText:   { color: C.muted, fontSize: 12, fontWeight: '600' },
  voteCount:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteCountText: { color: C.muted, fontSize: 12 },
  entryDur:      { color: C.muted, fontSize: 11 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%', padding: 20, paddingBottom: 40,
  },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16 },
  modalTitle:  { color: C.text, fontSize: 18, fontWeight: '800', flex: 1, marginRight: 12 },

  // Form
  challengeNameLabel: { color: C.cyan, fontSize: 14, fontWeight: '700', marginBottom: 12 },
  fieldLabel:   { color: C.muted, fontSize: 12, fontWeight: '600',
    letterSpacing: 0.5, marginBottom: 6, marginTop: 12 },
  fieldInput:   { backgroundColor: '#0a0f1a', borderRadius: 12, borderWidth: 1,
    borderColor: C.border, padding: 12, color: C.text, fontSize: 14 },
  fieldTextarea:{ minHeight: 80, textAlignVertical: 'top' },
  infoBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: C.cyan + '15', borderRadius: 10, padding: 10, marginTop: 16,
    borderWidth: 1, borderColor: C.cyan + '33' },
  infoText:    { color: C.subtext, fontSize: 12, flex: 1, lineHeight: 17 },
  prizesRow:   { flexDirection: 'row', gap: 8, marginTop: 14 },
  prizeChip:   { flex: 1, alignItems: 'center', borderRadius: 12, padding: 10,
    backgroundColor: '#0a0f1a', borderWidth: 1 },
  prizePlace:  { fontSize: 13, fontWeight: '800' },
  prizeProps:  { fontSize: 11, fontWeight: '700', marginTop: 3 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.orange, borderRadius: 14, paddingVertical: 14, marginTop: 16,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Video picker
  videoPicker:        { backgroundColor: '#0a0f1a', borderRadius: 14, overflow: 'hidden',
    height: 170, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  videoPreview:       { width: '100%', height: '100%' },
  videoPlaceholder:   { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  videoPlaceholderText: { color: C.muted, fontSize: 13 },
  thumbPickerWrap:    { marginBottom: 12 },
  thumbFrame:         { width: 72, height: 50, borderRadius: 8, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent' },
  thumbFrameSelected: { borderColor: C.orange },
  thumbFrameImg:      { width: '100%', height: '100%', resizeMode: 'cover' },
  thumbCheck:         { position: 'absolute', bottom: 2, right: 2,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 9 },
  thumbLoadRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 } as any,
  thumbLoadText:      { color: C.muted, fontSize: 12 },

  // Detail
  timelinePills: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 } as any,
  timelinePill:  { flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#0a0f1a', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: C.border },
  timelinePillText: { color: C.subtext, fontSize: 11 },
  detailDesc:    { color: C.subtext, fontSize: 13, lineHeight: 19, marginVertical: 8 },
  rulesBox:      { backgroundColor: '#0a0f1a', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  rulesLabel:    { color: C.orange, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.5, marginBottom: 4 },
  rulesText:     { color: C.subtext, fontSize: 12, lineHeight: 17 },
  sectionTitle:  { color: C.muted, fontSize: 12, fontWeight: '700',
    letterSpacing: 0.6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },

  // Season picker
  seasonPickerOverlay:  { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)' },
  seasonPickerSheet:    { backgroundColor: C.card, borderTopLeftRadius: 20,
    borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  seasonPickerTitle:    { color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 14 },
  seasonPickerRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  seasonPickerRowActive:{},
  seasonPickerRowText:  { color: C.subtext, fontSize: 14 },
});
