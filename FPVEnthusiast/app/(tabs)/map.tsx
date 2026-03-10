// app/(tabs)/map.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  FlatList, ActivityIndicator, Platform, Alert, ScrollView,
  KeyboardAvoidingView, Dimensions, Switch,
  Animated, Easing, AppState, AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Circle, PROVIDER_GOOGLE, MapPressEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import {
  useMap, FlySpot, RaceEvent, SpotComment,
  NewSpotData, NewEventData,
} from '../../src/hooks/useMap';
import { SPOT_PIN_MAP, EVENT_PIN_MAP } from '../../src/components/FPVMapPins';
import { useMultiGP } from '../../src/hooks/useMultiGP';

// Try to import notifications / AsyncStorage gracefully
let Notifications: any = null;
let AsyncStorage: any = null;
try { Notifications = require('expo-notifications'); } catch {}
try { AsyncStorage = require('@react-native-async-storage/async-storage').default; } catch {}

const { width, height } = Dimensions.get('window');
const PANEL_HEIGHT = height * 0.68;

// ─── Map Style ────────────────────────────────────────────────────────────────
const DARK_MAP_STYLE = [
  { elementType: 'geometry',           stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3a3a' }] },
  { featureType: 'administrative',     elementType: 'geometry',         stylers: [{ color: '#334155' }] },
  { featureType: 'poi',                elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { featureType: 'poi.park',           elementType: 'geometry',         stylers: [{ color: '#162016' }] },
  { featureType: 'road',               elementType: 'geometry',         stylers: [{ color: '#2d3748' }] },
  { featureType: 'road.arterial',      elementType: 'geometry',         stylers: [{ color: '#38404f' }] },
  { featureType: 'road.highway',       elementType: 'geometry',         stylers: [{ color: '#475569' }] },
  { featureType: 'road.highway',       elementType: 'geometry.stroke',  stylers: [{ color: '#1f2937' }] },
  { featureType: 'transit',            elementType: 'geometry',         stylers: [{ color: '#2d3748' }] },
  { featureType: 'water',              elementType: 'geometry',         stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'water',              elementType: 'labels.text.fill', stylers: [{ color: '#4a6fa5' }] },
];

// ─── Pin / Event Configs ──────────────────────────────────────────────────────
const SPOT_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  freestyle:  { color: '#00C853', label: 'Freestyle',  icon: 'bicycle'  },
  bando:      { color: '#FF6D00', label: 'Bando',      icon: 'business' },
  race_track: { color: '#2979FF', label: 'Race Track', icon: 'flag'     },
  open_field: { color: '#FFD600', label: 'Open Field', icon: 'leaf'     },
  indoor:     { color: '#E040FB', label: 'Indoor',     icon: 'home'     },
};

const EVENT_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  race:         { color: '#FF1744', label: 'Race',         icon: 'trophy'   },
  meetup:       { color: '#FF9100', label: 'Meetup',       icon: 'people'   },
  training:     { color: '#00BCD4', label: 'Training',     icon: 'school'   },
  tiny_whoop:   { color: '#E91E63', label: 'Tiny Whoop',   icon: 'radio'    },
  championship: { color: '#FFD700', label: 'Championship', icon: 'medal'    },
  fun_fly:      { color: '#76FF03', label: 'Fun Fly',      icon: 'airplane' },
};

const RADIUS_OPTIONS  = [5, 10, 25, 50, 100];
const ALL_SPOT_TYPES  = ['freestyle','bando','race_track','open_field','indoor'];
const ALL_EVENT_TYPES = ['race','meetup','training','tiny_whoop','championship','fun_fly'];

// Race vs Meetup grouping for the quick filter buttons
const RACE_TYPES   = ['race','championship','fun_fly'];
const MEETUP_TYPES = ['meetup','training','tiny_whoop'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function daysUntil(iso: string): string {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diff < 0)  return 'past';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return `in ${diff}d`;
}

// PinMarker replaced by SVG FPVMapPins.tsx components

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function MapScreen() {
  const { user } = useAuth();
  const {
    spots, events, comments, loading,
    mgpSyncing, mgpSyncCount,
    fetchSpots, fetchEvents, fetchComments,
    syncMultiGPEvents,
    addSpot, voteSpot, addComment,
    addEvent, toggleRsvp,
    deleteSpot, deleteEvent,
    fetchNewNearbyEvents,
  } = useMap(user?.id);

  // MultiGP chapter connection (for Sync button shown to chapter owners)
  const { connection: mgpConnection, syncing: mgpSyncing2, triggerSync: triggerMgpSync } = useMultiGP(user?.id);
  const [showMgpSyncToast, setShowMgpSyncToast] = React.useState(false);
  const [mgpSyncToastMsg, setMgpSyncToastMsg] = React.useState('');

  const handleMapMgpSync = React.useCallback(async () => {
    if (!userLocation) return;
    // Trigger edge function sync
    const result = await triggerMgpSync();
    if (!result.error) {
      // Refresh map events after sync
      fetchEvents(userLocation.latitude, userLocation.longitude, radiusMiles, [...ALL_EVENT_TYPES]);
      setMgpSyncToastMsg(`🏁 ${result.synced} race${result.synced !== 1 ? 's' : ''} synced to map`);
    } else {
      setMgpSyncToastMsg('⚠️ Sync failed — check your API key in Settings');
    }
    setShowMgpSyncToast(true);
    setTimeout(() => setShowMgpSyncToast(false), 4000);
  }, [triggerMgpSync, fetchEvents, userLocation, radiusMiles]);

  const mapRef = useRef<MapView>(null);

  // ── Animated title ───────────────────────────────────────────────────────
  const animValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(animValue, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false })
    ).start();
  }, [animValue]);
  const animatedColor = animValue.interpolate({
    inputRange:  [0,         0.25,      0.5,       0.75,      1        ],
    outputRange: ['#ff4500','#ff8c00','#ffcc00','#ff6600','#ff4500'],
  });

  // ── Events panel slide animation ─────────────────────────────────────────
  const panelSlide = useRef(new Animated.Value(PANEL_HEIGHT)).current;
  const [showEventsPanel, setShowEventsPanel] = useState(false);

  const openPanel = useCallback((filter: 'race' | 'meetup' | 'all') => {
    setEventPanelFilter(filter);
    setShowEventsPanel(true);
    Animated.spring(panelSlide, {
      toValue: 0, useNativeDriver: true, tension: 65, friction: 11,
    }).start();
  }, [panelSlide]);

  const closePanel = useCallback(() => {
    Animated.timing(panelSlide, {
      toValue: PANEL_HEIGHT, duration: 260, easing: Easing.in(Easing.ease), useNativeDriver: true,
    }).start(() => setShowEventsPanel(false));
  }, [panelSlide]);

  // ── Core state ───────────────────────────────────────────────────────────
  const [userLocation,      setUserLocation]      = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationGranted,   setLocationGranted]   = useState<boolean | null>(null);
  const [isSatellite,       setIsSatellite]       = useState(false);
  const [radiusMiles,       setRadiusMiles]       = useState(50);
  const [showSpots,         setShowSpots]         = useState(true);
  const [showEvents,        setShowEvents]        = useState(true);
  const [spotTypeFilters,   setSpotTypeFilters]   = useState<string[]>([...ALL_SPOT_TYPES]);
  const [eventTypeFilters,  setEventTypeFilters]  = useState<string[]>([...ALL_EVENT_TYPES]);
  const [showFilterPanel,   setShowFilterPanel]   = useState(false);

  // Events panel state
  const [eventPanelFilter,  setEventPanelFilter]  = useState<'all' | 'race' | 'meetup'>('all');
  const [panelDistance,     setPanelDistance]     = useState(50);

  // Pin mode
  const [spotPinMode,       setSpotPinMode]       = useState(false);
  const [evtPinMode,        setEvtPinMode]        = useState(false);
  const [spotPin,           setSpotPin]           = useState<{ latitude: number; longitude: number } | null>(null);
  const [evtPin,            setEvtPin]            = useState<{ latitude: number; longitude: number } | null>(null);

  // Detail modals
  const [selectedSpot,      setSelectedSpot]      = useState<FlySpot | null>(null);
  const [selectedEvent,     setSelectedEvent]     = useState<RaceEvent | null>(null);

  // Add forms
  const [showAddSpot,       setShowAddSpot]       = useState(false);
  const [showAddEvent,      setShowAddEvent]      = useState(false);
  const [spotName,          setSpotName]          = useState('');
  const [spotDesc,          setSpotDesc]          = useState('');
  const [spotType,          setSpotType]          = useState<FlySpot['spot_type']>('freestyle');
  const [spotHazard,        setSpotHazard]        = useState<FlySpot['hazard_level']>('low');
  const [evtName,           setEvtName]           = useState('');
  const [evtDesc,           setEvtDesc]           = useState('');
  const [evtType,           setEvtType]           = useState<RaceEvent['event_type']>('meetup');
  const [evtVenue,          setEvtVenue]          = useState('');
  const [evtCity,           setEvtCity]           = useState('');
  const [evtState,          setEvtState]          = useState('');
  const [evtStart,          setEvtStart]          = useState('');
  const [evtEnd,            setEvtEnd]            = useState('');
  const [evtMax,            setEvtMax]            = useState('');
  const [evtUrl,            setEvtUrl]            = useState('');
  const [commentText,       setCommentText]       = useState('');
  const [isAnonymous,       setIsAnonymous]       = useState(false);
  const [submitting,        setSubmitting]        = useState(false);
  const [postingComment,    setPostingComment]    = useState(false);
  const [currentVote,       setCurrentVote]       = useState<1 | -1 | null>(null);
  const [showMgpToast,      setShowMgpToast]      = useState(false);
  const [deletingPin,       setDeletingPin]       = useState(false);

  // ── Location + initial fetch ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocationGranted(false); return; }
      setLocationGranted(true);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      setUserLocation({ latitude, longitude });
      mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.5, longitudeDelta: 0.5 }, 800);
      fetchSpots(latitude, longitude, 50, ALL_SPOT_TYPES);
      fetchEvents(latitude, longitude, 50, ALL_EVENT_TYPES);
      syncMultiGPEvents(latitude, longitude, 100).then(() => {
        fetchEvents(latitude, longitude, 50, ALL_EVENT_TYPES);
      });
    })();
  }, []);

  // ── Push notification setup ──────────────────────────────────────────────
  useEffect(() => {
    if (!Notifications) return;
    (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return;
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
          }),
        });
      } catch {}
    })();
  }, []);

  // ── AppState: check for new nearby events when app comes to foreground ────
  const appStateRef = useRef<AppStateStatus>('active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (appStateRef.current !== 'active' && nextState === 'active') {
        if (!userLocation || !Notifications || !AsyncStorage || !fetchNewNearbyEvents) return;
        try {
          const lastCheck = await AsyncStorage.getItem('fpv_last_notif_check');
          const since = lastCheck ?? new Date(Date.now() - 3_600_000).toISOString();
          const newEvts = await fetchNewNearbyEvents(userLocation.latitude, userLocation.longitude, radiusMiles, since);
          await AsyncStorage.setItem('fpv_last_notif_check', new Date().toISOString());
          if (newEvts && newEvts.length > 0) {
            const cfg = EVENT_CONFIG[newEvts[0].event_type] ?? { label: 'Event' };
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🚁 New FPV Event Near You!',
                body: newEvts.length === 1
                  ? `${newEvts[0].name} – ${cfg.label} within ${radiusMiles}mi`
                  : `${newEvts.length} new events within ${radiusMiles}mi of you`,
                data: { eventId: newEvts[0].id },
              },
              trigger: null,
            });
          }
        } catch {}
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [userLocation, radiusMiles, fetchNewNearbyEvents]);

  // ── MGP toast ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mgpSyncCount > 0) {
      setShowMgpToast(true);
      const t = setTimeout(() => setShowMgpToast(false), 3500);
      return () => clearTimeout(t);
    }
  }, [mgpSyncCount]);

  // ── Refresh ───────────────────────────────────────────────────────────────
  const refreshData = useCallback(() => {
    if (!userLocation) return;
    const { latitude, longitude } = userLocation;
    if (showSpots)  fetchSpots(latitude, longitude, radiusMiles, spotTypeFilters);
    if (showEvents) fetchEvents(latitude, longitude, radiusMiles, eventTypeFilters);
  }, [userLocation, radiusMiles, showSpots, showEvents, spotTypeFilters, eventTypeFilters]);

  // ── Map press ────────────────────────────────────────────────────────────
  const handleMapPress = (e: MapPressEvent) => {
    const coords = e.nativeEvent.coordinate;
    if (spotPinMode) { setSpotPin(coords); setSpotPinMode(false); setShowAddSpot(true); }
    else if (evtPinMode) { setEvtPin(coords); setEvtPinMode(false); setShowAddEvent(true); }
  };

  const toggleSpotType  = (t: string) => setSpotTypeFilters(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const toggleEventType = (t: string) => setEventTypeFilters(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  // ── Submit spot ──────────────────────────────────────────────────────────
  const handleSubmitSpot = async () => {
    if (!spotPin || !spotName.trim()) { Alert.alert('Missing info', 'Spot name and map pin are required.'); return; }
    setSubmitting(true);
    const { data, error } = await addSpot(
      { name: spotName.trim(), description: spotDesc.trim(), spot_type: spotType,
        hazard_level: spotHazard, latitude: spotPin.latitude, longitude: spotPin.longitude },
      user?.email ?? 'Pilot',
    );
    setSubmitting(false);
    if (error) { Alert.alert('Error', 'Could not add spot.'); return; }
    setShowAddSpot(false);
    setSpotName(''); setSpotDesc(''); setSpotType('freestyle'); setSpotHazard('low'); setSpotPin(null);
    Alert.alert('✅ Spot added!', `"${data?.name}" is now on the map.`);
  };

  // ── Submit event ──────────────────────────────────────────────────────────
  const handleSubmitEvent = async () => {
    if (!evtPin || !evtName.trim() || !evtStart.trim()) {
      Alert.alert('Missing info', 'Name, start time, and map pin are required.'); return;
    }
    setSubmitting(true);
    const { data, error } = await addEvent({
      name: evtName.trim(), description: evtDesc.trim(), event_type: evtType,
      latitude: evtPin.latitude, longitude: evtPin.longitude,
      venue_name: evtVenue.trim(), city: evtCity.trim(), state: evtState.trim(),
      start_time: new Date(evtStart).toISOString(),
      end_time: evtEnd.trim() ? new Date(evtEnd).toISOString() : '',
      max_participants: evtMax, registration_url: evtUrl.trim(),
    });
    setSubmitting(false);
    if (error) { Alert.alert('Error', 'Could not publish event.'); return; }
    setShowAddEvent(false);
    setEvtName(''); setEvtDesc(''); setEvtVenue(''); setEvtCity(''); setEvtState('');
    setEvtStart(''); setEvtEnd(''); setEvtMax(''); setEvtUrl(''); setEvtPin(null);
    Alert.alert('✅ Event published!', `"${data?.name}" is live on the map.`);
  };

  // ── Open spot ─────────────────────────────────────────────────────────────
  const openSpot = async (spot: FlySpot) => {
    setSelectedSpot(spot); setCurrentVote(null); setCommentText('');
    await fetchComments(spot.id);
  };

  // ── Comment ───────────────────────────────────────────────────────────────
  const handlePostComment = async () => {
    if (!selectedSpot || !commentText.trim()) return;
    setPostingComment(true);
    await addComment(selectedSpot.id, commentText.trim(), isAnonymous);
    setCommentText(''); setPostingComment(false);
  };

  // ── Vote ──────────────────────────────────────────────────────────────────
  const handleVote = async (v: 1 | -1) => {
    if (!selectedSpot) return;
    await voteSpot(selectedSpot.id, v, currentVote);
    setCurrentVote(prev => prev === v ? null : v);
    setSelectedSpot(prev => {
      if (!prev) return null;
      let up = prev.thumbs_up, down = prev.thumbs_down;
      if (currentVote === 1) up--; if (currentVote === -1) down--;
      if (v !== currentVote) { if (v === 1) up++; else down++; }
      return { ...prev, thumbs_up: Math.max(0, up), thumbs_down: Math.max(0, down) };
    });
  };

  // ── Delete spot ───────────────────────────────────────────────────────────
  const handleDeleteSpot = async () => {
    if (!selectedSpot) return;
    Alert.alert('Delete Spot', `Remove "${selectedSpot.name}" from the map?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setDeletingPin(true);
          const err = await deleteSpot(selectedSpot.id);
          setDeletingPin(false);
          if (err) { Alert.alert('Error', 'Could not delete spot.'); return; }
          setSelectedSpot(null);
        },
      },
    ]);
  };

  // ── Delete event ──────────────────────────────────────────────────────────
  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;
    Alert.alert('Cancel Event', `Remove "${selectedEvent.name}"? This cannot be undone.`, [
      { text: 'Keep It', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setDeletingPin(true);
          const err = await deleteEvent(selectedEvent.id);
          setDeletingPin(false);
          if (err) { Alert.alert('Error', 'Could not delete event.'); return; }
          setSelectedEvent(null);
        },
      },
    ]);
  };

  // ── Filtered/visible items ────────────────────────────────────────────────
  const visibleSpots  = showSpots  ? spots.filter(s => spotTypeFilters.includes(s.spot_type))   : [];
  const visibleEvents = showEvents ? events.filter(e => eventTypeFilters.includes(e.event_type)) : [];

  // Events panel list (filtered by panel tab + distance)
  const panelEvents = useMemo(() => {
    const typeFilter =
      eventPanelFilter === 'race'   ? RACE_TYPES :
      eventPanelFilter === 'meetup' ? MEETUP_TYPES : ALL_EVENT_TYPES;
    return events.filter(e => typeFilter.includes(e.event_type));
  }, [events, eventPanelFilter]);

  // Count badges for quick-filter buttons
  const raceCount   = events.filter(e => RACE_TYPES.includes(e.event_type)).length;
  const meetupCount = events.filter(e => MEETUP_TYPES.includes(e.event_type)).length;

  // Permission denied screen
  if (locationGranted === false) {
    return (
      <View style={styles.permScreen}>
        <Ionicons name="location-outline" size={60} color="#ff4500" />
        <Text style={styles.permTitle}>Location Required</Text>
        <Text style={styles.permDesc}>Enable location to find FPV spots and races near you.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={() => Location.requestForegroundPermissionsAsync()}>
          <Text style={styles.permBtnText}>Enable Location</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* ─── Map ─────────────────────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={isSatellite ? 'hybrid' : 'standard'}
        customMapStyle={!isSatellite && Platform.OS === 'android' ? DARK_MAP_STYLE : undefined}
        userInterfaceStyle={isSatellite ? undefined : 'dark'}
        initialRegion={{ latitude: 39.5, longitude: -98.35, latitudeDelta: 20, longitudeDelta: 20 }}
        showsUserLocation
        showsMyLocationButton={false}
        onPress={handleMapPress}
      >
        {userLocation && (
          <Circle
            center={userLocation}
            radius={radiusMiles * 1609.34}
            strokeColor="rgba(255,69,0,0.85)"
            fillColor="rgba(255,69,0,0.07)"
            strokeWidth={3}
          />
        )}
        {visibleSpots.map(spot => {
          const SpotPin = SPOT_PIN_MAP[spot.spot_type] ?? SPOT_PIN_MAP['freestyle'];
          return (
            <Marker key={spot.id} coordinate={{ latitude: spot.latitude, longitude: spot.longitude }} onPress={() => openSpot(spot)} tracksViewChanges={false}>
              <SpotPin size={44} />
            </Marker>
          );
        })}
        {visibleEvents.map(evt => {
          const EvtPin = EVENT_PIN_MAP[evt.event_type] ?? EVENT_PIN_MAP['race'];
          return (
            <Marker key={evt.id} coordinate={{ latitude: evt.latitude, longitude: evt.longitude }} onPress={() => setSelectedEvent(evt)} tracksViewChanges={false}>
              <EvtPin size={44} isMultiGP={evt.event_source === 'multigp'} />
            </Marker>
          );
        })}
        {spotPin && <Marker coordinate={spotPin}><Ionicons name="add-circle" size={36} color="#ff4500" /></Marker>}
        {evtPin  && <Marker coordinate={evtPin}><Ionicons name="calendar" size={36} color="#FFD700" /></Marker>}
      </MapView>

      {/* ─── Pin-drop overlay ─────────────────────────────────────────────── */}
      {(spotPinMode || evtPinMode) && (
        <View style={styles.pinDropOverlay} pointerEvents="box-none">
          <View style={styles.pinDropBanner}>
            <Ionicons name="location" size={18} color="#ff4500" />
            <Text style={styles.pinDropText}>{spotPinMode ? 'Tap the map to drop your FPV spot' : 'Tap the map to set event location'}</Text>
          </View>
          <TouchableOpacity style={styles.pinDropCancel} onPress={() => { setSpotPinMode(false); setEvtPinMode(false); }}>
            <Text style={styles.pinDropCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── MultiGP syncing badge ─────────────────────────────────────────── */}
      {mgpSyncing && (
        <View style={styles.mgpSyncBadge} pointerEvents="none">
          <ActivityIndicator size="small" color="#2979FF" />
          <Text style={styles.mgpSyncText}>Syncing MultiGP…</Text>
        </View>
      )}
      {showMgpToast && (
        <View style={styles.mgpToast} pointerEvents="none">
          <Text style={styles.mgpToastText}>🏁 {mgpSyncCount} MultiGP race{mgpSyncCount !== 1 ? 's' : ''} synced nearby</Text>
        </View>
      )}
      {showMgpSyncToast && (
        <View style={[styles.mgpToast, { bottom: 145, backgroundColor: 'rgba(41,121,255,0.95)' }]} pointerEvents="none">
          <Text style={styles.mgpToastText}>{mgpSyncToastMsg}</Text>
        </View>
      )}

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <SafeAreaView style={styles.headerSafe} pointerEvents="box-none">
        {/* Title row */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Animated.Text style={[styles.headerTitle, { color: animatedColor }]}>FPV Map</Animated.Text>
            <Text style={styles.headerSub}>{radiusMiles}mi · {spots.length + events.length} pins{isSatellite ? '  🛰 Satellite' : ''}</Text>
            {loading && <ActivityIndicator size="small" color="#ff4500" style={{ marginLeft: 8 }} />}
          </View>
          <View style={styles.headerRight}>
            {/* MultiGP sync button — only visible to chapter owners */}
            {mgpConnection?.is_active && (
              <TouchableOpacity
                style={[styles.iconBtn, styles.iconBtnMgp]}
                onPress={handleMapMgpSync}
                disabled={mgpSyncing2}
              >
                {mgpSyncing2
                  ? <ActivityIndicator size="small" color="#2979FF" />
                  : <Ionicons name="sync-outline" size={18} color="#2979FF" />
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.iconBtn, isSatellite && styles.iconBtnSatellite]} onPress={() => setIsSatellite(v => !v)}>
              <Ionicons name="layers-outline" size={20} color={isSatellite ? '#FFD700' : '#fff'} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowFilterPanel(true)}>
              <Ionicons name="options-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { if (userLocation) mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 0.3, longitudeDelta: 0.3 }, 600); }}>
              <Ionicons name="locate-outline" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Quick-filter buttons row — clean, no legend clutter */}
        <View style={styles.quickFilterRow}>
          {/* Race button */}
          <TouchableOpacity
            style={[styles.qfBtn, styles.qfBtnRace]}
            onPress={() => openPanel('race')}
          >
            <Ionicons name="trophy" size={14} color="#fff" style={{ marginRight: 5 }} />
            <Text style={styles.qfBtnText}>Race</Text>
            {raceCount > 0 && (
              <View style={styles.qfBadge}><Text style={styles.qfBadgeText}>{raceCount}</Text></View>
            )}
          </TouchableOpacity>

          {/* Meetup button */}
          <TouchableOpacity
            style={[styles.qfBtn, styles.qfBtnMeetup]}
            onPress={() => openPanel('meetup')}
          >
            <Ionicons name="people" size={14} color="#fff" style={{ marginRight: 5 }} />
            <Text style={styles.qfBtnText}>Meetup</Text>
            {meetupCount > 0 && (
              <View style={styles.qfBadge}><Text style={styles.qfBadgeText}>{meetupCount}</Text></View>
            )}
          </TouchableOpacity>

          {/* All events button */}
          <TouchableOpacity
            style={[styles.qfBtn, styles.qfBtnAll]}
            onPress={() => openPanel('all')}
          >
            <Ionicons name="calendar-outline" size={14} color="#fff" style={{ marginRight: 5 }} />
            <Text style={styles.qfBtnText}>All Events</Text>
            {events.length > 0 && (
              <View style={[styles.qfBadge, { backgroundColor: '#555' }]}>
                <Text style={styles.qfBadgeText}>{events.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* ─── Events Panel (slide-up bottom sheet) ────────────────────────── */}
      {showEventsPanel && (
        <Animated.View
          style={[styles.eventsPanel, { transform: [{ translateY: panelSlide }] }]}
          pointerEvents="box-none"
        >
          {/* Panel header */}
          <View style={styles.panelHeader}>
            <View style={styles.panelHandle} />
            <View style={styles.panelTitleRow}>
              <Text style={styles.panelTitle}>
                {eventPanelFilter === 'race'   ? '🏁 Race Events' :
                 eventPanelFilter === 'meetup' ? '👥 Meetups' : '📅 All Events'}
              </Text>
              <TouchableOpacity style={styles.panelCloseBtn} onPress={closePanel}>
                <Ionicons name="close" size={20} color="#888" />
              </TouchableOpacity>
            </View>

            {/* Tab bar */}
            <View style={styles.panelTabs}>
              {(['all', 'race', 'meetup'] as const).map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.panelTab, eventPanelFilter === tab && styles.panelTabActive]}
                  onPress={() => setEventPanelFilter(tab)}
                >
                  <Text style={[styles.panelTabText, eventPanelFilter === tab && styles.panelTabTextActive]}>
                    {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
              <View style={{ flex: 1 }} />
              {/* Schedule Event button inside panel */}
              <TouchableOpacity
                style={styles.scheduleBtn}
                onPress={() => { closePanel(); setTimeout(() => { setEvtPinMode(true); }, 300); }}
              >
                <Ionicons name="add" size={15} color="#fff" />
                <Text style={styles.scheduleBtnText}>Schedule</Text>
              </TouchableOpacity>
            </View>

            {/* Distance filter row */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.panelDistRow}>
              <Text style={styles.panelDistLabel}>Within:</Text>
              {RADIUS_OPTIONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.panelDistBtn, panelDistance === r && styles.panelDistBtnActive]}
                  onPress={() => setPanelDistance(r)}
                >
                  <Text style={[styles.panelDistBtnText, panelDistance === r && { color: '#fff' }]}>{r}mi</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Event list */}
          <FlatList
            data={panelEvents}
            keyExtractor={e => e.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="calendar-outline" size={44} color="#333" />
                <Text style={styles.emptyText}>No events found</Text>
                <Text style={styles.emptySub}>Tap "Schedule" to post one!</Text>
              </View>
            }
            renderItem={({ item: evt }) => {
              const cfg = EVENT_CONFIG[evt.event_type];
              const countdown = daysUntil(evt.start_time);
              return (
                <TouchableOpacity
                  style={styles.eventRow}
                  onPress={() => { closePanel(); setTimeout(() => setSelectedEvent(evt), 320); }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.eventTypeBar, { backgroundColor: cfg.color }]} />
                  <View style={styles.eventRowBody}>
                    <View style={styles.eventRowTop}>
                      <Ionicons name={cfg.icon as any} size={14} color={cfg.color} style={{ marginRight: 5 }} />
                      <Text style={styles.eventRowName} numberOfLines={1}>{evt.name}</Text>
                      {evt.event_source === 'multigp' && (
                        <View style={styles.multigpBadge}><Text style={styles.multigpText}>M</Text></View>
                      )}
                      <View style={[styles.countdownBadge, { backgroundColor: countdown === 'today' ? '#ff4500' : countdown === 'tomorrow' ? '#FF9100' : '#1a1a2e' }]}>
                        <Text style={styles.countdownText}>{countdown}</Text>
                      </View>
                    </View>
                    <Text style={styles.eventRowDate}>{formatDate(evt.start_time)}</Text>
                    <Text style={styles.eventRowLoc} numberOfLines={1}>
                      📍 {[evt.venue_name, evt.city, evt.state].filter(Boolean).join(', ') || 'Location TBD'}
                    </Text>
                    <View style={styles.eventRowFooter}>
                      <Text style={[styles.eventTypePill, { color: cfg.color }]}>{cfg.label}</Text>
                      <TouchableOpacity
                        style={[styles.rsvpMiniBtn, evt.user_rsvpd && styles.rsvpMiniBtnActive]}
                        onPress={async (e) => {
                          e.stopPropagation?.();
                          await toggleRsvp(evt.id);
                        }}
                      >
                        <Ionicons name={evt.user_rsvpd ? 'checkmark-circle' : 'add-circle-outline'} size={14} color="#fff" />
                        <Text style={styles.rsvpMiniText}>{evt.user_rsvpd ? 'Going' : 'RSVP'} · {evt.rsvp_count}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </Animated.View>
      )}

      {/* ─── FABs ─────────────────────────────────────────────────────────── */}
      {!spotPinMode && !evtPinMode && !showEventsPanel && (
        <View style={styles.fabGroup}>
          <TouchableOpacity style={[styles.fab, styles.fabEvent]} onPress={() => { setEvtPinMode(true); }}>
            <Ionicons name="calendar-outline" size={18} color="#fff" />
            <Text style={styles.fabLabel}>Event</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={() => { setSpotPinMode(true); }}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.fabLabel}>Spot</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Filter panel modal ───────────────────────────────────────────── */}
      <Modal visible={showFilterPanel} transparent animationType="slide" onRequestClose={() => setShowFilterPanel(false)}>
        <View style={styles.modalWrap}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowFilterPanel(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Map Filters</Text>
            <Text style={styles.sheetSection}>Search Radius</Text>
            <View style={styles.radiusRow}>
              {RADIUS_OPTIONS.map(r => (
                <TouchableOpacity key={r} style={[styles.radiusBtn, radiusMiles === r && styles.radiusBtnActive]} onPress={() => setRadiusMiles(r)}>
                  <Text style={[styles.radiusBtnText, radiusMiles === r && { color: '#fff' }]}>{r} mi</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.toggleRow}>
              <View><Text style={styles.toggleLabel}>Show FPV Spots</Text><Text style={styles.toggleCount}>{spots.length} in range</Text></View>
              <Switch value={showSpots} onValueChange={setShowSpots} trackColor={{ false: '#333', true: '#ff4500' }} thumbColor="#fff" />
            </View>
            {showSpots && (
              <View style={styles.chipWrap}>
                {ALL_SPOT_TYPES.map(t => { const cfg = SPOT_CONFIG[t]; const on = spotTypeFilters.includes(t);
                  return <TouchableOpacity key={t} style={[styles.chip, on ? { backgroundColor: cfg.color } : styles.chipOff]} onPress={() => toggleSpotType(t)}><Text style={[styles.chipText, !on && styles.chipTextOff]}>{cfg.label}</Text></TouchableOpacity>;
                })}
              </View>
            )}
            <View style={styles.toggleRow}>
              <View><Text style={styles.toggleLabel}>Show Race Events</Text><Text style={styles.toggleCount}>{events.length} upcoming</Text></View>
              <Switch value={showEvents} onValueChange={setShowEvents} trackColor={{ false: '#333', true: '#ff4500' }} thumbColor="#fff" />
            </View>
            {showEvents && (
              <View style={styles.chipWrap}>
                {ALL_EVENT_TYPES.map(t => { const cfg = EVENT_CONFIG[t]; const on = eventTypeFilters.includes(t);
                  return <TouchableOpacity key={t} style={[styles.chip, on ? { backgroundColor: cfg.color } : styles.chipOff]} onPress={() => toggleEventType(t)}><Text style={[styles.chipText, !on && styles.chipTextOff]}>{cfg.label}</Text></TouchableOpacity>;
                })}
              </View>
            )}
            <TouchableOpacity style={styles.applyBtn} onPress={() => { setShowFilterPanel(false); refreshData(); }}>
              <Text style={styles.applyBtnText}>Apply & Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Add Spot modal ───────────────────────────────────────────────── */}
      <Modal visible={showAddSpot} transparent animationType="slide" onRequestClose={() => setShowAddSpot(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowAddSpot(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>📍 Add FPV Spot</Text>
            {spotPin && <Text style={styles.coordText}>{spotPin.latitude.toFixed(5)}, {spotPin.longitude.toFixed(5)}</Text>}
            <TextInput style={styles.input} placeholder="Spot name *" placeholderTextColor="#555" value={spotName} onChangeText={setSpotName} />
            <TextInput style={[styles.input, { height: 72, textAlignVertical: 'top' }]} placeholder="Description (optional)" placeholderTextColor="#555" value={spotDesc} onChangeText={setSpotDesc} multiline numberOfLines={3} />
            <Text style={styles.fieldLabel}>Spot Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipWrap}>
                {ALL_SPOT_TYPES.map(t => { const cfg = SPOT_CONFIG[t];
                  return <TouchableOpacity key={t} style={[styles.chip, spotType === t ? { backgroundColor: cfg.color } : styles.chipOff]} onPress={() => setSpotType(t as FlySpot['spot_type'])}><Text style={[styles.chipText, spotType !== t && styles.chipTextOff]}>{cfg.label}</Text></TouchableOpacity>;
                })}
              </View>
            </ScrollView>
            <Text style={styles.fieldLabel}>Hazard Level</Text>
            <View style={styles.chipWrap}>
              {(['low','medium','high'] as const).map(h => { const col = h === 'low' ? '#00C853' : h === 'medium' ? '#FFD600' : '#FF1744';
                return <TouchableOpacity key={h} style={[styles.chip, spotHazard === h ? { backgroundColor: col } : styles.chipOff]} onPress={() => setSpotHazard(h)}><Text style={[styles.chipText, spotHazard !== h && styles.chipTextOff]}>{h.charAt(0).toUpperCase() + h.slice(1)}</Text></TouchableOpacity>;
              })}
            </View>
            <TouchableOpacity style={[styles.applyBtn, submitting && { opacity: 0.5 }]} onPress={handleSubmitSpot} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyBtnText}>Save Spot</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Add Event modal ──────────────────────────────────────────────── */}
      <Modal visible={showAddEvent} transparent animationType="slide" onRequestClose={() => setShowAddEvent(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowAddEvent(false)} />
          <ScrollView style={[styles.sheet, { maxHeight: '85%' }]} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>📅 Schedule Event</Text>
            {evtPin && <Text style={styles.coordText}>📍 {evtPin.latitude.toFixed(5)}, {evtPin.longitude.toFixed(5)}</Text>}

            {/* Event Type as tags — all 6 types as selectable chips */}
            <Text style={styles.fieldLabel}>EVENT TAG</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {ALL_EVENT_TYPES.map(t => { const cfg = EVENT_CONFIG[t];
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.chip, evtType === t ? { backgroundColor: cfg.color } : styles.chipOff]}
                      onPress={() => setEvtType(t as RaceEvent['event_type'])}
                    >
                      <Ionicons name={cfg.icon as any} size={12} color={evtType === t ? '#fff' : '#555'} style={{ marginRight: 4 }} />
                      <Text style={[styles.chipText, evtType !== t && styles.chipTextOff]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <TextInput style={styles.input} placeholder="Event name *" placeholderTextColor="#555" value={evtName} onChangeText={setEvtName} />
            <TextInput style={[styles.input, { height: 72, textAlignVertical: 'top' }]} placeholder="Description" placeholderTextColor="#555" value={evtDesc} onChangeText={setEvtDesc} multiline />
            <TextInput style={styles.input} placeholder="Venue name" placeholderTextColor="#555" value={evtVenue} onChangeText={setEvtVenue} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="City" placeholderTextColor="#555" value={evtCity} onChangeText={setEvtCity} />
              <TextInput style={[styles.input, { width: 70 }]} placeholder="State" placeholderTextColor="#555" value={evtState} onChangeText={setEvtState} />
            </View>
            <TextInput style={styles.input} placeholder="Start: YYYY-MM-DD HH:MM *" placeholderTextColor="#555" value={evtStart} onChangeText={setEvtStart} />
            <TextInput style={styles.input} placeholder="End: YYYY-MM-DD HH:MM (optional)" placeholderTextColor="#555" value={evtEnd} onChangeText={setEvtEnd} />
            <TextInput style={styles.input} placeholder="Max participants" placeholderTextColor="#555" value={evtMax} onChangeText={setEvtMax} keyboardType="numeric" />
            <TextInput style={styles.input} placeholder="Registration URL (optional)" placeholderTextColor="#555" value={evtUrl} onChangeText={setEvtUrl} autoCapitalize="none" />
            <TouchableOpacity style={[styles.applyBtn, submitting && { opacity: 0.5 }, { marginBottom: 32 }]} onPress={handleSubmitEvent} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyBtnText}>Publish Event</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Spot detail modal ────────────────────────────────────────────── */}
      <Modal visible={!!selectedSpot} transparent animationType="slide" onRequestClose={() => setSelectedSpot(null)}>
        <View style={styles.modalWrap}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelectedSpot(null)} />
          <View style={[styles.sheet, { maxHeight: '85%' }]}>
            <View style={styles.sheetHandle} />
            {selectedSpot && (
              <>
                <View style={styles.detailHeader}>
                  <View style={[styles.detailTypeBadge, { backgroundColor: SPOT_CONFIG[selectedSpot.spot_type]?.color ?? '#888' }]}>
                    <Text style={styles.detailTypeTxt}>{SPOT_CONFIG[selectedSpot.spot_type]?.label}</Text>
                  </View>
                  <View style={[styles.hazardBadge, { backgroundColor: selectedSpot.hazard_level === 'low' ? '#00C853' : selectedSpot.hazard_level === 'medium' ? '#FFD600' : '#FF1744' }]}>
                    <Text style={styles.hazardText}>⚠ {selectedSpot.hazard_level}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  {/* Delete button — only for owner */}
                  {selectedSpot.created_by === user?.id && (
                    <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteSpot} disabled={deletingPin}>
                      {deletingPin
                        ? <ActivityIndicator size="small" color="#FF1744" />
                        : <><Ionicons name="trash-outline" size={15} color="#FF1744" /><Text style={styles.deleteBtnText}>Delete</Text></>
                      }
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.detailName}>{selectedSpot.name}</Text>
                {selectedSpot.creator_username && <Text style={styles.detailMeta}>Added by @{selectedSpot.creator_username}</Text>}
                {selectedSpot.description ? <Text style={styles.detailDesc}>{selectedSpot.description}</Text> : null}
                <View style={styles.voteRow}>
                  <TouchableOpacity style={[styles.voteBtn, currentVote === 1 && styles.voteBtnActive]} onPress={() => handleVote(1)}>
                    <Ionicons name="thumbs-up" size={18} color={currentVote === 1 ? '#fff' : '#00C853'} />
                    <Text style={[styles.voteCount, currentVote === 1 && { color: '#fff' }]}>{selectedSpot.thumbs_up}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.voteBtn, styles.voteBtnDown, currentVote === -1 && styles.voteBtnDownActive]} onPress={() => handleVote(-1)}>
                    <Ionicons name="thumbs-down" size={18} color={currentVote === -1 ? '#fff' : '#FF1744'} />
                    <Text style={[styles.voteCount, currentVote === -1 && { color: '#fff' }]}>{selectedSpot.thumbs_down}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.commentsHeader}>Comments ({comments.length})</Text>
                <FlatList
                  data={comments}
                  keyExtractor={c => c.id}
                  style={{ maxHeight: 160 }}
                  ListEmptyComponent={<Text style={styles.noComments}>No comments yet. Be first!</Text>}
                  renderItem={({ item: c }) => (
                    <View style={styles.commentItem}>
                      <View style={styles.commentAvatar}><Ionicons name="person" size={14} color="#888" /></View>
                      <View style={styles.commentBody}>
                        <Text style={styles.commentUser}>{c.is_anonymous ? '👤 Anonymous Pilot' : (c.username ?? 'Pilot')}</Text>
                        <Text style={styles.commentText}>{c.content}</Text>
                      </View>
                    </View>
                  )}
                />
                <View style={styles.commentInputRow}>
                  <TextInput style={styles.commentInput} placeholder="Add a comment..." placeholderTextColor="#555" value={commentText} onChangeText={setCommentText} />
                  <TouchableOpacity style={styles.commentSendBtn} onPress={handlePostComment} disabled={postingComment}>
                    {postingComment ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={16} color="#fff" />}
                  </TouchableOpacity>
                </View>
                <View style={styles.anonRow}>
                  <Switch value={isAnonymous} onValueChange={setIsAnonymous} trackColor={{ false: '#333', true: '#ff4500' }} thumbColor="#fff" />
                  <Text style={styles.anonLabel}>Post anonymously</Text>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ─── Event detail modal ───────────────────────────────────────────── */}
      <Modal visible={!!selectedEvent} transparent animationType="slide" onRequestClose={() => setSelectedEvent(null)}>
        <View style={styles.modalWrap}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelectedEvent(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {selectedEvent && (
              <>
                {selectedEvent.event_source === 'multigp' && (
                  <View style={styles.multigpBanner}><Text style={styles.multigpBannerText}>🏁 Official MultiGP Race</Text></View>
                )}
                <View style={styles.eventDetailHeaderRow}>
                  <View style={[styles.detailTypeBadge, { backgroundColor: EVENT_CONFIG[selectedEvent.event_type]?.color ?? '#ff4500' }]}>
                    <Text style={styles.detailTypeTxt}>{EVENT_CONFIG[selectedEvent.event_type]?.label}</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  {/* Delete button — only for organizer, non-MultiGP */}
                  {selectedEvent.organizer_id === user?.id && selectedEvent.event_source !== 'multigp' && (
                    <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteEvent} disabled={deletingPin}>
                      {deletingPin
                        ? <ActivityIndicator size="small" color="#FF1744" />
                        : <><Ionicons name="trash-outline" size={15} color="#FF1744" /><Text style={styles.deleteBtnText}>Delete</Text></>
                      }
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.detailName}>{selectedEvent.name}</Text>
                <Text style={styles.detailMeta}>🗓 {formatDate(selectedEvent.start_time)}</Text>
                {selectedEvent.end_time && <Text style={styles.detailMeta}>🏁 Ends: {formatDate(selectedEvent.end_time)}</Text>}
                <Text style={styles.detailMeta}>📍 {[selectedEvent.venue_name, selectedEvent.city, selectedEvent.state].filter(Boolean).join(', ') || 'Location TBD'}</Text>
                {selectedEvent.max_participants && <Text style={styles.detailMeta}>👥 Max: {selectedEvent.max_participants} pilots</Text>}
                {selectedEvent.organizer_username && <Text style={styles.detailMeta}>Organized by @{selectedEvent.organizer_username}</Text>}
                {selectedEvent.multigp_chapter_name && !selectedEvent.organizer_username && <Text style={styles.detailMeta}>🏟 {selectedEvent.multigp_chapter_name}</Text>}
                {selectedEvent.description ? <Text style={styles.detailDesc}>{selectedEvent.description}</Text> : null}
                <View style={styles.eventDetailFooter}>
                  <View style={styles.rsvpCountWrap}>
                    <Text style={styles.rsvpCountNum}>{selectedEvent.rsvp_count}</Text>
                    <Text style={styles.rsvpCountLabel}>going</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, selectedEvent.user_rsvpd && styles.rsvpBtnActive]}
                    onPress={async () => {
                      await toggleRsvp(selectedEvent.id);
                      setSelectedEvent(prev => prev ? { ...prev, user_rsvpd: !prev.user_rsvpd, rsvp_count: prev.user_rsvpd ? prev.rsvp_count - 1 : prev.rsvp_count + 1 } : null);
                    }}
                  >
                    <Ionicons name={selectedEvent.user_rsvpd ? 'checkmark-circle' : 'add-circle-outline'} size={18} color="#fff" />
                    <Text style={styles.rsvpBtnText}>{selectedEvent.user_rsvpd ? "I'm Going ✓" : "RSVP"}</Text>
                  </TouchableOpacity>
                </View>
                {selectedEvent.registration_url ? <Text style={styles.regLink} numberOfLines={1}>🔗 {selectedEvent.registration_url}</Text> : null}
              </>
            )}
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a' },
  permScreen:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a', padding: 32 },
  permTitle:   { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  permDesc:    { color: '#888', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  permBtn:     { backgroundColor: '#ff4500', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Header
  headerSafe:    { position: 'absolute', top: 0, left: 0, right: 0 },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
  headerLeft:    { flexDirection: 'column' },
  headerTitle:   { fontSize: 22, fontWeight: '800', letterSpacing: 1, textShadowColor: '#000', textShadowRadius: 6 },
  headerSub:     { color: '#888', fontSize: 11, fontWeight: '500', marginTop: 1 },
  headerRight:   { flexDirection: 'row', gap: 6 },
  iconBtn:          { backgroundColor: 'rgba(0,0,0,0.65)', padding: 8, borderRadius: 20, borderWidth: 1, borderColor: '#333' },
  iconBtnSatellite: { borderColor: '#FFD700', backgroundColor: 'rgba(255,215,0,0.15)' },
  iconBtnMgp:       { borderColor: '#2979FF', backgroundColor: 'rgba(41,121,255,0.12)' },

  // Quick filter row (replaces old legend)
  quickFilterRow: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 6, gap: 8 },
  qfBtn:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  qfBtnRace:      { backgroundColor: '#cc0000' },
  qfBtnMeetup:    { backgroundColor: '#cc7000' },
  qfBtnAll:       { backgroundColor: '#1a3a5c' },
  qfBtnText:      { color: '#fff', fontWeight: '700', fontSize: 13 },
  qfBadge:        { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 10, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, marginLeft: 6 },
  qfBadgeText:    { color: '#fff', fontSize: 10, fontWeight: '800' },

  // Events panel
  eventsPanel:      { position: 'absolute', bottom: 0, left: 0, right: 0, height: PANEL_HEIGHT, backgroundColor: '#0f0f0f', borderTopLeftRadius: 22, borderTopRightRadius: 22, elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.5, shadowRadius: 16 },
  panelHeader:      { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  panelHandle:      { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  panelTitleRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  panelTitle:       { color: '#fff', fontSize: 17, fontWeight: '800', flex: 1 },
  panelCloseBtn:    { padding: 4 },
  panelTabs:        { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 },
  panelTab:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  panelTabActive:   { backgroundColor: '#ff4500', borderColor: '#ff4500' },
  panelTabText:     { color: '#666', fontWeight: '700', fontSize: 12 },
  panelTabTextActive: { color: '#fff' },
  scheduleBtn:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a3a5c', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, gap: 4, borderWidth: 1, borderColor: '#2979FF' },
  scheduleBtnText:  { color: '#fff', fontWeight: '700', fontSize: 12 },
  panelDistRow:     { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, gap: 6 },
  panelDistLabel:   { color: '#555', fontSize: 11, fontWeight: '700', marginRight: 2 },
  panelDistBtn:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  panelDistBtnActive: { backgroundColor: '#ff4500', borderColor: '#ff4500' },
  panelDistBtnText: { color: '#666', fontWeight: '600', fontSize: 11 },

  // Event rows in panel
  eventRow:         { flexDirection: 'row', marginHorizontal: 12, marginVertical: 4, borderRadius: 12, overflow: 'hidden', backgroundColor: '#141414', borderWidth: 1, borderColor: '#1e1e1e' },
  eventTypeBar:     { width: 4 },
  eventRowBody:     { flex: 1, padding: 10 },
  eventRowTop:      { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  eventRowName:     { color: '#fff', fontWeight: '700', fontSize: 14, flex: 1 },
  eventRowDate:     { color: '#777', fontSize: 11, marginBottom: 2 },
  eventRowLoc:      { color: '#555', fontSize: 11, marginBottom: 5 },
  eventRowFooter:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventTypePill:    { fontSize: 11, fontWeight: '700' },
  countdownBadge:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginLeft: 4 },
  countdownText:    { color: '#fff', fontSize: 9, fontWeight: '800' },
  rsvpMiniBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a3a5c', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#2979FF' },
  rsvpMiniBtnActive: { backgroundColor: '#2979FF' },
  rsvpMiniText:     { color: '#fff', fontSize: 11, fontWeight: '700' },
  multigpBadge:     { backgroundColor: '#2979FF', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, marginLeft: 4 },
  multigpText:      { color: '#fff', fontSize: 8, fontWeight: '800' },

  // Empty state
  emptyWrap: { alignItems: 'center', paddingTop: 50, gap: 8 },
  emptyText: { color: '#555', fontSize: 16, fontWeight: '600' },
  emptySub:  { color: '#444', fontSize: 13 },

  // FABs
  fabGroup: { position: 'absolute', bottom: 32, right: 16, gap: 10, alignItems: 'flex-end' },
  fab:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ff4500', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, gap: 6, elevation: 6, shadowColor: '#ff4500', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
  fabEvent: { backgroundColor: '#1a3a5c' },
  fabLabel: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Pin drop
  pinDropOverlay:    { position: 'absolute', bottom: 110, left: 0, right: 0, alignItems: 'center' },
  pinDropBanner:     { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, gap: 8, borderWidth: 1, borderColor: '#ff4500' },
  pinDropText:       { color: '#fff', fontWeight: '600', fontSize: 13 },
  pinDropCancel:     { marginTop: 10, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#444' },
  pinDropCancelText: { color: '#ccc', fontWeight: '600', fontSize: 13 },

  // MGP badges
  mgpSyncBadge: { position: 'absolute', bottom: 148, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  mgpSyncText:  { color: '#2979FF', fontSize: 12, fontWeight: '600' },
  mgpToast:     { position: 'absolute', bottom: 110, alignSelf: 'center', backgroundColor: 'rgba(41,121,255,0.92)', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: '#2979FF' },
  mgpToastText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Modals / sheets
  modalWrap:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  backdrop:    { ...StyleSheet.absoluteFillObject },
  sheet:       { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32 },
  sheetHandle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  sheetTitle:  { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 16 },
  sheetSection:{ color: '#888', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 4 },

  // Filters
  radiusRow:       { flexDirection: 'row', gap: 8, marginBottom: 16 },
  radiusBtn:       { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1a1a1a', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  radiusBtnActive: { backgroundColor: '#ff4500', borderColor: '#ff4500' },
  radiusBtnText:   { color: '#888', fontWeight: '700', fontSize: 13 },
  toggleRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  toggleLabel: { color: '#fff', fontWeight: '600', fontSize: 14 },
  toggleCount: { color: '#555', fontSize: 11, marginTop: 2 },
  chipWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, flexDirection: 'row', alignItems: 'center' },
  chipOff:     { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  chipText:    { color: '#fff', fontWeight: '700', fontSize: 12 },
  chipTextOff: { color: '#555' },
  applyBtn:     { backgroundColor: '#ff4500', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Inputs
  input:      { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: '#2a2a2a' },
  coordText:  { color: '#555', fontSize: 11, marginBottom: 10, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  fieldLabel: { color: '#888', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6, marginTop: 4 },

  // Spot/Event detail
  detailHeader:        { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  eventDetailHeaderRow:{ flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  detailTypeBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  detailTypeTxt:       { color: '#fff', fontWeight: '800', fontSize: 11 },
  hazardBadge:         { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  hazardText:          { color: '#fff', fontWeight: '700', fontSize: 11 },
  detailName:          { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  detailMeta:          { color: '#666', fontSize: 12, marginBottom: 3 },
  detailDesc:          { color: '#aaa', fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 8 },

  // Delete button
  deleteBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(255,23,68,0.12)', borderWidth: 1, borderColor: '#FF1744' },
  deleteBtnText: { color: '#FF1744', fontWeight: '700', fontSize: 12 },

  // Votes
  voteRow:           { flexDirection: 'row', gap: 10, marginVertical: 12 },
  voteBtn:           { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  voteBtnActive:     { backgroundColor: '#00C853', borderColor: '#00C853' },
  voteBtnDown:       { borderColor: '#2a2a2a' },
  voteBtnDownActive: { backgroundColor: '#FF1744', borderColor: '#FF1744' },
  voteCount:         { color: '#aaa', fontWeight: '700', fontSize: 14 },

  // Comments
  commentsHeader: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  noComments:     { color: '#444', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  commentItem:    { flexDirection: 'row', gap: 8, marginBottom: 10 },
  commentAvatar:  { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  commentBody:    { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 8 },
  commentUser:    { color: '#ff4500', fontSize: 11, fontWeight: '700', marginBottom: 2 },
  commentText:    { color: '#ccc', fontSize: 13 },
  commentInputRow:{ flexDirection: 'row', gap: 8, marginTop: 8 },
  commentInput:   { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, color: '#fff', fontSize: 13, borderWidth: 1, borderColor: '#2a2a2a' },
  commentSendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ff4500', justifyContent: 'center', alignItems: 'center' },
  anonRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  anonLabel:      { color: '#666', fontSize: 12 },

  // Event detail footer
  multigpBanner:     { backgroundColor: '#1a1a2e', borderRadius: 8, padding: 8, marginBottom: 10, alignItems: 'center', borderWidth: 1, borderColor: '#2979FF' },
  multigpBannerText: { color: '#2979FF', fontWeight: '800', fontSize: 13 },
  eventDetailFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  rsvpCountWrap:     { alignItems: 'center' },
  rsvpCountNum:      { color: '#fff', fontSize: 24, fontWeight: '800' },
  rsvpCountLabel:    { color: '#666', fontSize: 11 },
  rsvpBtn:           { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a3a5c', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#2979FF' },
  rsvpBtnActive:     { backgroundColor: '#2979FF' },
  rsvpBtnText:       { color: '#fff', fontWeight: '700', fontSize: 14 },
  regLink:           { color: '#2979FF', fontSize: 12, marginTop: 8 },
});
