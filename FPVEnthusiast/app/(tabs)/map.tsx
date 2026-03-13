// app/(tabs)/map.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter }           from 'expo-router';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  FlatList, ActivityIndicator, Platform, Alert, ScrollView,
  KeyboardAvoidingView, Dimensions, Switch,
  Animated, Easing, AppState, AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Circle, Polygon, PROVIDER_GOOGLE, MapPressEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/services/supabase';
import {
  useMap, FlySpot, RaceEvent, SpotComment,
  NewSpotData, NewEventData, haversineDistance,
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

// Safe ISO conversion — returns empty string on invalid input
function safeIso(raw: string): string {
  if (!raw.trim()) return '';
  try {
    const d = new Date(raw.trim());
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  } catch { return ''; }
}

// PinMarker replaced by SVG FPVMapPins.tsx components

// ─── DateTime Picker ─────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const HOURS  = Array.from({ length: 24 }, (_, i) => i);
const MINS   = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

interface DateTimePickerProps {
  year: number; month: number; day: number; hour: number; minute: number;
  onChangeYear: (v: number) => void; onChangeMonth: (v: number) => void;
  onChangeDay: (v: number) => void; onChangeHour: (v: number) => void;
  onChangeMinute: (v: number) => void;
}

function DateTimePicker({ year, month, day, hour, minute,
  onChangeYear, onChangeMonth, onChangeDay, onChangeHour, onChangeMinute
}: DateTimePickerProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear + i);
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const clampedDay = Math.min(day, daysInMonth);
  return (
    <View style={dtStyles.container}>
      <View style={dtStyles.col}>
        <Text style={dtStyles.colLabel}>Month</Text>
        <ScrollView style={dtStyles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {MONTHS.map((m, idx) => (
            <TouchableOpacity key={m} style={[dtStyles.item, month === idx+1 && dtStyles.itemActive]}
              onPress={() => { onChangeMonth(idx+1); onChangeDay(Math.min(clampedDay, new Date(year, idx+1, 0).getDate())); }}>
              <Text style={[dtStyles.itemText, month === idx+1 && dtStyles.itemTextActive]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={dtStyles.col}>
        <Text style={dtStyles.colLabel}>Day</Text>
        <ScrollView style={dtStyles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {days.map(d => (
            <TouchableOpacity key={d} style={[dtStyles.item, clampedDay === d && dtStyles.itemActive]} onPress={() => onChangeDay(d)}>
              <Text style={[dtStyles.itemText, clampedDay === d && dtStyles.itemTextActive]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={dtStyles.col}>
        <Text style={dtStyles.colLabel}>Year</Text>
        <ScrollView style={dtStyles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {years.map(y => (
            <TouchableOpacity key={y} style={[dtStyles.item, year === y && dtStyles.itemActive]} onPress={() => onChangeYear(y)}>
              <Text style={[dtStyles.itemText, year === y && dtStyles.itemTextActive]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={dtStyles.col}>
        <Text style={dtStyles.colLabel}>Hour</Text>
        <ScrollView style={dtStyles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {HOURS.map(h => (
            <TouchableOpacity key={h} style={[dtStyles.item, hour === h && dtStyles.itemActive]} onPress={() => onChangeHour(h)}>
              <Text style={[dtStyles.itemText, hour === h && dtStyles.itemTextActive]}>{String(h).padStart(2,'0')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={dtStyles.col}>
        <Text style={dtStyles.colLabel}>Min</Text>
        <ScrollView style={dtStyles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {MINS.map(m => (
            <TouchableOpacity key={m} style={[dtStyles.item, minute === m && dtStyles.itemActive]} onPress={() => onChangeMinute(m)}>
              <Text style={[dtStyles.itemText, minute === m && dtStyles.itemTextActive]}>{String(m).padStart(2,'0')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const dtStyles = StyleSheet.create({
  container:      { flexDirection: 'row', gap: 4, marginBottom: 12, backgroundColor: '#0d0d0d', borderRadius: 14, padding: 8, borderWidth: 1, borderColor: '#222' },
  col:            { flex: 1, alignItems: 'center' },
  colLabel:       { color: '#555', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  scroll:         { height: 120 },
  item:           { paddingVertical: 6, paddingHorizontal: 2, borderRadius: 8, alignItems: 'center', width: '100%' },
  itemActive:     { backgroundColor: '#ff4500' },
  itemText:       { color: '#555', fontSize: 13, fontWeight: '600' },
  itemTextActive: { color: '#fff', fontWeight: '800' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
// ─── Airspace overlay types & helpers ────────────────────────────────────────
type AirspaceZone = {
  id: string;
  name: string;
  type: string;       // CLASS-B, CLASS-C, CLASS-D, CLASS-E, MODE-C, LAANC
  ceiling: number | null;
  coords: { latitude: number; longitude: number }[][];
};

const AIRSPACE_COLORS: Record<string, { fill: string; stroke: string }> = {
  // Class B  — deep cobalt blue  (large, most restrictive controlled)
  'CLASS-B':  { fill: 'rgba(0,80,220,0.22)',    stroke: 'rgba(0,80,220,0.95)'    },
  // Class C  — vivid magenta/red (medium airports)
  'CLASS-C':  { fill: 'rgba(220,0,80,0.18)',    stroke: 'rgba(220,0,80,0.92)'    },
  // Class D  — bright cyan-teal  (towered, smaller)
  'CLASS-D':  { fill: 'rgba(0,210,210,0.15)',   stroke: 'rgba(0,210,210,0.90)'   },
  // Class E  — soft amber/gold   (wide low-level controlled, least restrictive)
  'CLASS-E':  { fill: 'rgba(255,180,0,0.10)',   stroke: 'rgba(255,180,0,0.65)'   },
  // Mode C   — orange-red dashed veil
  'MODE-C':   { fill: 'rgba(255,90,0,0.07)',    stroke: 'rgba(255,90,0,0.55)'    },
  // LAANC    — lime green  (UAS facility map altitude grid)
  'LAANC':    { fill: 'rgba(50,220,80,0.14)',   stroke: 'rgba(50,220,80,0.85)'   },
  // Default  — grey fallback
  'DEFAULT':  { fill: 'rgba(180,180,180,0.08)', stroke: 'rgba(180,180,180,0.50)' },
};

const FAA_BASE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services';

function classifyZone(props: Record<string, any>): string {
  const tc = (props.TYPE_CODE || props.LOCAL_TYPE || '').toUpperCase();
  const cl = (props.CLASS || '').toUpperCase();
  if (tc === 'MODE-C') return 'MODE-C';
  if (cl === 'B' || tc.includes('CLASS B')) return 'CLASS-B';
  if (cl === 'C' || tc.includes('CLASS C')) return 'CLASS-C';
  if (cl === 'D' || tc.includes('CLASS D')) return 'CLASS-D';
  if (cl === 'E' || tc.includes('CLASS E')) return 'CLASS-E';
  if (tc === 'LAANC') return 'LAANC';
  return 'DEFAULT';
}

function geoJsonToCoords(geometry: any): { latitude: number; longitude: number }[][] {
  if (!geometry) return [];
  try {
    if (geometry.type === 'Polygon') {
      return geometry.coordinates.map((ring: number[][]) =>
        ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))
      );
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.flatMap((poly: number[][][]) =>
        poly.map((ring: number[][]) =>
          ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))
        )
      );
    }
  } catch {}
  return [];
}

export default function MapScreen() {
  const { user } = useAuth();
  const router   = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  const {
    spots, events, comments, loading,
    mgpSyncing, mgpSyncCount,
    fetchSpots, fetchEvents, fetchComments,
    syncMultiGPEvents,
    addSpot, voteSpot, addComment, reportSpot, reportEvent, checkNearbySpots,
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
    const result = await triggerMgpSync();
    if (!result.error) {
      fetchEvents(userLocation.latitude, userLocation.longitude, radiusMiles, [...ALL_EVENT_TYPES]);
      setMgpSyncToastMsg(`🏁 ${result.synced} race${result.synced !== 1 ? 's' : ''} synced to map`);
    } else {
      setMgpSyncToastMsg('⚠️ Sync failed — check your API key in Settings');
    }
    setShowMgpSyncToast(true);
    setTimeout(() => setShowMgpSyncToast(false), 4000);
  }, [triggerMgpSync, fetchEvents, userLocation, radiusMiles]);

  const mapRef = useRef<MapView>(null);

  // ── Load FAA airspace zones for visible map region ────────────────────────
  const loadAirspaceZones = useCallback(async (
    minLat: number, minLng: number, maxLat: number, maxLng: number
  ) => {
    setAirspaceLoading(true);
    try {
      // Pad bbox slightly
      const pad = 0.1;
      const bbox = `${(minLng - pad).toFixed(4)},${(minLat - pad).toFixed(4)},${(maxLng + pad).toFixed(4)},${(maxLat + pad).toFixed(4)}`;
      const geomParam = `geometry=${bbox}&geometryType=esriGeometryEnvelope&outSR=4326`;

      // Fetch Class Airspace (B/C/D/E) and LAANC grids in parallel
      const [classRes, laancRes] = await Promise.allSettled([
        fetch(`${FAA_BASE}/Class_Airspace/FeatureServer/0/query?where=1%3D1&${geomParam}&f=geojson&resultRecordCount=200&outFields=NAME,CLASS,TYPE_CODE,LOCAL_TYPE,LOWER_VAL,UPPER_VAL`),
        fetch(`${FAA_BASE}/FAA_UAS_FacilityMap_Data_V5/FeatureServer/0/query?where=CEILING+IS+NOT+NULL+AND+CEILING+%3C+400&${geomParam}&f=geojson&resultRecordCount=200&outFields=CEILING,UNIT,APT1_FAAID`),
      ]);

      const zones: AirspaceZone[] = [];

      // Parse Class Airspace
      if (classRes.status === 'fulfilled' && classRes.value.ok) {
        const data = await classRes.value.json();
        for (const feat of (data.features || [])) {
          const coords = geoJsonToCoords(feat.geometry);
          if (!coords.length) continue;
          zones.push({
            id: `class-${feat.properties.OBJECTID || Math.random()}`,
            name: feat.properties.NAME || 'Controlled Airspace',
            type: classifyZone(feat.properties),
            ceiling: feat.properties.UPPER_VAL ?? null,
            coords,
          });
        }
      }

      // Parse LAANC/UAS Facility Map (restricted altitude areas < 400ft)
      if (laancRes.status === 'fulfilled' && laancRes.value.ok) {
        const data = await laancRes.value.json();
        for (const feat of (data.features || [])) {
          const coords = geoJsonToCoords(feat.geometry);
          if (!coords.length) continue;
          const ceiling = feat.properties.CEILING ?? 0;
          zones.push({
            id: `laanc-${feat.properties.OBJECTID || Math.random()}`,
            name: `LAANC Zone – Max ${ceiling}ft AGL`,
            type: 'LAANC',
            ceiling,
            coords,
          });
        }
      }

      setAirspaceZones(zones);
    } catch (e) {
      console.warn('Airspace load error:', e);
    } finally {
      setAirspaceLoading(false);
    }
  }, []);

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
  const [showAirspace,      setShowAirspace]      = useState(false);
  const [showAirspaceLegend, setShowAirspaceLegend] = useState(false);
  const [airspaceZones,     setAirspaceZones]     = useState<AirspaceZone[]>([]);
  const [airspaceLoading,   setAirspaceLoading]   = useState(false);
  const [radiusMiles,       setRadiusMiles]       = useState(50);
  const [showSpots,         setShowSpots]         = useState(true);
  const [showEvents,        setShowEvents]        = useState(true);
  const [spotTypeFilters,   setSpotTypeFilters]   = useState<string[]>([...ALL_SPOT_TYPES]);
  const [eventTypeFilters,  setEventTypeFilters]  = useState<string[]>([...ALL_EVENT_TYPES]);
  const [showFilterPanel,   setShowFilterPanel]   = useState(false);

  // Address search state
  const [showAddrSearch,    setShowAddrSearch]    = useState(false);
  const [addrQuery,         setAddrQuery]         = useState('');
  const [addrSearching,     setAddrSearching]     = useState(false);
  const [addrFound,         setAddrFound]         = useState<{ latitude: number; longitude: number } | null>(null);
  const addrInputRef = useRef<TextInput>(null);

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
  // Report modal state
  const [reportModalVisible,  setReportModalVisible]  = useState(false);
  const [reportTargetType,    setReportTargetType]    = useState<'spot' | 'event'>('spot');
  const [reportReason,        setReportReason]        = useState<string>('wrong_type');
  const [reportDetail,        setReportDetail]        = useState('');
  const [reportSubmitting,    setReportSubmitting]    = useState(false);

  // ── Community Guidelines modal state (shown before every pin/event) ────────
  const [showGuidelinesModal, setShowGuidelinesModal] = useState(false);
  const [guidelinesPendingAction, setGuidelinesPendingAction] = useState<'spot' | 'event' | null>(null);
  const [guidelinesChecked, setGuidelinesChecked] = useState(false);

  // ── DateTime picker state ────────────────────────────────────────────────
  const [evtStartYear,  setEvtStartYear]  = useState(new Date().getFullYear());
  const [evtStartMonth, setEvtStartMonth] = useState(new Date().getMonth() + 1);
  const [evtStartDay,   setEvtStartDay]   = useState(new Date().getDate());
  const [evtStartHour,  setEvtStartHour]  = useState(10);
  const [evtStartMin,   setEvtStartMin]   = useState(0);
  const [evtHasEnd,     setEvtHasEnd]     = useState(false);
  const [evtEndYear,    setEvtEndYear]    = useState(new Date().getFullYear());
  const [evtEndMonth,   setEvtEndMonth]   = useState(new Date().getMonth() + 1);
  const [evtEndDay,     setEvtEndDay]     = useState(new Date().getDate());
  const [evtEndHour,    setEvtEndHour]    = useState(14);
  const [evtEndMin,     setEvtEndMin]     = useState(0);
  const [evtUseExistingPin, setEvtUseExistingPin] = useState(false);
  const [showExistingPinPicker, setShowExistingPinPicker] = useState(false);
  const [evtLinkedSpotId, setEvtLinkedSpotId] = useState<string | null>(null); // spot this event is anchored to

  // ── Location + initial fetch ─────────────────────────────────────────────
  // ── Fetch admin status once on mount ────────────────────────────────────
  useEffect(() => {
    if (!user?.id) { setIsAdmin(false); return; }
    supabase.from('users').select('is_admin').eq('id', user.id).single()
      .then(({ data }) => setIsAdmin(data?.is_admin === true))
      .catch(() => setIsAdmin(false));
  }, [user?.id]);

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
            shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
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

  // ── Reload airspace data when toggle turned on or user moves map far ──────
  useEffect(() => {
    if (!showAirspace) return;
    if (userLocation) {
      const { latitude, longitude } = userLocation;
      loadAirspaceZones(latitude - 0.5, longitude - 0.7, latitude + 0.5, longitude + 0.7);
    } else {
      // Default to CONUS centre until we have a location
      loadAirspaceZones(38, -92, 41, -86);
    }
  }, [showAirspace, userLocation, loadAirspaceZones]);

  // ── Refresh ───────────────────────────────────────────────────────────────
  const refreshData = useCallback(() => {
    if (!userLocation) return;
    const { latitude, longitude } = userLocation;
    if (showSpots)  fetchSpots(latitude, longitude, radiusMiles, spotTypeFilters);
    if (showEvents) fetchEvents(latitude, longitude, radiusMiles, eventTypeFilters);
  }, [userLocation, radiusMiles, showSpots, showEvents, spotTypeFilters, eventTypeFilters]);

  // ── Community Guidelines gate ──────────────────────────────────────────────
  // Called instead of directly opening the spot/event pin-drop mode.
  // If user has already accepted (stored in AsyncStorage), proceeds immediately.
  // Otherwise shows the guidelines modal first; on accept it sets the key and
  // continues with the pending action.
  const checkGuidelinesAndProceed = useCallback((action: 'spot' | 'event') => {
    // Show Community Guidelines before every pin/event submission
    setGuidelinesPendingAction(action);
    setGuidelinesChecked(false);
    setShowGuidelinesModal(true);
  }, []);

  const handleGuidelinesAccept = useCallback(() => {
    if (!guidelinesChecked) {
      Alert.alert('Agreement Required', 'Please check the box to confirm you have read and agree to the Community Guidelines.');
      return;
    }
    setShowGuidelinesModal(false);
    if (guidelinesPendingAction === 'spot') setSpotPinMode(true);
    else if (guidelinesPendingAction === 'event') setEvtPinMode(true);
    setGuidelinesPendingAction(null);
  }, [guidelinesChecked, guidelinesPendingAction]);

  // ── Map press ────────────────────────────────────────────────────────────
  const handleMapPress = (e: MapPressEvent) => {
    const coords = e.nativeEvent.coordinate;
    if (spotPinMode) { setSpotPin(coords); setSpotPinMode(false); setShowAddSpot(true); }
    else if (evtPinMode) { setEvtPin(coords); setEvtPinMode(false); setShowAddEvent(true); }
    else { setAddrFound(null); }  // dismiss address result on map tap
  };

  const toggleSpotType  = (t: string) => setSpotTypeFilters(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const toggleEventType = (t: string) => setEventTypeFilters(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  // ── Address search ────────────────────────────────────────────────────────
  const handleAddressSearch = useCallback(async () => {
    const q = addrQuery.trim();
    if (!q) return;
    setAddrSearching(true);
    setAddrFound(null);
    try {
      const results = await Location.geocodeAsync(q);
      if (results.length > 0) {
        const { latitude, longitude } = results[0];
        setAddrFound({ latitude, longitude });
        mapRef.current?.animateToRegion(
          { latitude, longitude, latitudeDelta: 0.04, longitudeDelta: 0.04 },
          700,
        );
      } else {
        Alert.alert('Not Found', 'No location found. Try a more specific address.');
      }
    } catch {
      Alert.alert('Search Error', 'Could not geocode that address. Check your connection.');
    }
    setAddrSearching(false);
  }, [addrQuery]);

  const handleDropSpotAtAddr = () => {
    if (!addrFound) return;
    const coords = addrFound;          // capture before clearing
    setAddrFound(null);
    setShowAddrSearch(false);
    setAddrQuery('');
    setSpotPin(coords);
    setShowAddSpot(true);
  };

  const handleDropEventAtAddr = () => {
    if (!addrFound) return;
    const coords = addrFound;          // capture before clearing
    setAddrFound(null);
    setShowAddrSearch(false);
    setAddrQuery('');
    setEvtPin(coords);
    setShowAddEvent(true);
  };

  // ── Submit spot ──────────────────────────────────────────────────────────
  const handleSubmitSpot = async () => {
    if (!spotPin || !spotName.trim()) { Alert.alert('Missing info', 'Spot name and map pin are required.'); return; }

    // ── 7. Account age gate (24 hours) ────────────────────────────────────────
    if (user?.created_at) {
      const ageHours = (Date.now() - new Date(user.created_at).getTime()) / 3_600_000;
      if (ageHours < 24) {
        Alert.alert(
          'Account Too New',
          'You need an account for at least 24 hours before adding spots.\n\nThis keeps the map trustworthy for everyone.'
        );
        return;
      }
    }

    // ── 3. Input validation — name/desc length + no URLs ──────────────────────
    const name = spotName.trim();
    const desc = spotDesc.trim();
    if (name.length < 3)   { Alert.alert('Name too short',  'At least 3 characters required.'); return; }
    if (name.length > 60)  { Alert.alert('Name too long',   'Max 60 characters.'); return; }
    if (desc.length > 300) { Alert.alert('Description too long', 'Max 300 characters.'); return; }
    if (/https?:\/\//i.test(desc)) {
      Alert.alert('No links allowed', 'URLs are not permitted in spot descriptions.'); return;
    }

    // ── 1. Proximity gate — pin must be within 100 miles of user ─────────────
    if (userLocation) {
      const dist = haversineDistance(
        userLocation.latitude, userLocation.longitude,
        spotPin.latitude, spotPin.longitude,
      );
      if (dist > 100) {
        Alert.alert(
          'Too Far Away',
          `Your pin is ${Math.round(dist)} miles from your current location.\n\nYou can only add spots within 100 miles of where you are.`
        );
        return;
      }
    }

    // ── 2. Duplicate check — live DB query, ALL spot types, ½ mile radius ───────
    const DEDUP_MILES = 0.5;
    const { tooClose, nearestName } = await checkNearbySpots(
      spotPin.latitude, spotPin.longitude, DEDUP_MILES,
    );
    if (tooClose) {
      setShowAddSpot(false);
      setSpotPin(null);
      Alert.alert(
        'Spot Already Exists',
        nearestName
          ? `"${nearestName}" is already within ½ mile.\n\nTap the existing pin to comment or vote instead.`
          : 'There is already a pin within ½ mile of this location.\n\nTap the existing pin to comment or vote instead.'
      );
      setShowAddSpot(false);   // dismiss form
      setSpotPin(null);        // ← remove ghost orange marker
      return;
    }

    setSubmitting(true);
    const { data, error } = await addSpot(
      { name, description: desc, spot_type: spotType,
        hazard_level: spotHazard, latitude: spotPin.latitude, longitude: spotPin.longitude },
      (user as any)?.user_metadata?.username ?? (user as any)?.username ?? 'Pilot',
    );
    setSubmitting(false);
    if (error) {
      // Unique index violation = exact duplicate coords in DB
      const msg = (error?.message ?? '');
      if (msg.includes('idx_fly_spots_location_dedup') || msg.includes('unique')) {
        Alert.alert('Duplicate Spot', 'A spot already exists at this exact location.');
      } else {
        Alert.alert('Error', 'Could not add spot. Please try again.');
      }
      return;
    }
    setShowAddSpot(false);
    setSpotName(''); setSpotDesc(''); setSpotType('freestyle'); setSpotHazard('low'); setSpotPin(null);
    Alert.alert('✅ Spot added!', `"${data?.name}" is now on the map.`);
  };

  // ── Submit event ──────────────────────────────────────────────────────────
  const handleSubmitEvent = async () => {
    if (!evtPin) {
      Alert.alert('No Location', 'Please tap the map to set an event location, or pick an existing spot.'); return;
    }
    if (!evtName.trim()) {
      Alert.alert('Missing info', 'Event name is required.'); return;
    }

    // ── 7. Account age gate ───────────────────────────────────────────────────
    if (user?.created_at) {
      const ageHours = (Date.now() - new Date(user.created_at).getTime()) / 3_600_000;
      if (ageHours < 24) {
        Alert.alert('Account Too New', 'You need an account for at least 24 hours before posting events.'); return;
      }
    }

    // ── 1. Event proximity gate — within 200 miles ────────────────────────────
    if (userLocation) {
      const dist = haversineDistance(
        userLocation.latitude, userLocation.longitude,
        evtPin.latitude, evtPin.longitude,
      );
      if (dist > 200) {
        Alert.alert('Too Far Away', `Event location is ${Math.round(dist)} miles from you. Max 200 miles.`); return;
      }
    }

    // ── 3. Event name length + description URL block ───────────────────────────
    if (evtName.trim().length > 80) { Alert.alert('Name too long', 'Max 80 characters.'); return; }
    if (evtDesc.trim().length > 500) { Alert.alert('Description too long', 'Max 500 characters.'); return; }
    if (/https?:\/\//i.test(evtDesc.trim())) {
      Alert.alert('No links allowed', 'URLs are not permitted in event descriptions.'); return;
    }

    // Build ISO strings from picker values
    const pad = (n: number) => String(n).padStart(2, '0');
    const startStr = `${evtStartYear}-${pad(evtStartMonth)}-${pad(evtStartDay)}T${pad(evtStartHour)}:${pad(evtStartMin)}:00`;
    const startIso = safeIso(startStr);
    if (!startIso) { Alert.alert('Invalid Date', 'Could not build start time. Please check year/month/day.'); return; }

    // ── 5. Event date range validation ────────────────────────────────────────
    const startDate  = new Date(startIso);
    const now        = new Date();
    const maxFuture  = new Date();
    maxFuture.setFullYear(maxFuture.getFullYear() + 2);
    if (startDate <= now) {
      Alert.alert('Invalid Date', 'Event start time must be in the future.'); return;
    }
    if (startDate > maxFuture) {
      Alert.alert('Too Far Ahead', 'Events can only be scheduled up to 2 years in advance.'); return;
    }
    const endIso = evtHasEnd
      ? safeIso(`${evtEndYear}-${pad(evtEndMonth)}-${pad(evtEndDay)}T${pad(evtEndHour)}:${pad(evtEndMin)}:00`)
      : '';
    if (evtHasEnd && endIso && new Date(endIso) <= startDate) {
      Alert.alert('Invalid End Time', 'End time must be after the start time.'); return;
    }
    setSubmitting(true);
    const { data, error } = await addEvent({
      name: evtName.trim(), description: evtDesc.trim(), event_type: evtType,
      latitude: evtPin.latitude, longitude: evtPin.longitude,
      venue_name: evtVenue.trim(), city: evtCity.trim(), state: evtState.trim(),
      start_time: startIso,
      end_time: endIso,
      max_participants: evtMax, registration_url: evtUrl.trim(),
      fly_spot_id: evtLinkedSpotId ?? undefined,
    });
    setSubmitting(false);
    if (error) { Alert.alert('Error', 'Could not publish event.'); return; }
    setShowAddEvent(false);
    // Reset all event form state
    setEvtName(''); setEvtDesc(''); setEvtVenue(''); setEvtCity(''); setEvtState('');
    setEvtMax(''); setEvtUrl(''); setEvtPin(null);
    setEvtHasEnd(false); setEvtUseExistingPin(false); setEvtLinkedSpotId(null);
    const resetNow = new Date();
    setEvtStartYear(resetNow.getFullYear()); setEvtStartMonth(resetNow.getMonth()+1); setEvtStartDay(resetNow.getDate());
    setEvtStartHour(10); setEvtStartMin(0);
    setEvtEndHour(14); setEvtEndMin(0);
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
    const trimmed = commentText.trim();
    if (trimmed.length > 280) {
      Alert.alert('Too Long', 'Comments are limited to 280 characters.'); return;
    }
    if (/https?:\/\//i.test(trimmed)) {
      Alert.alert('No Links', 'URLs are not allowed in comments.'); return;
    }
    setPostingComment(true);
    await addComment(selectedSpot.id, trimmed, isAnonymous);
    setCommentText(''); setPostingComment(false);
  };

  // ── Vote ──────────────────────────────────────────────────────────────────
  const handleVote = async (v: 1 | -1) => {
    if (!selectedSpot) return;
    const result = await voteSpot(selectedSpot.id, v, currentVote);
    if (!result.ok) {
      if (result.error === 'rate_limit') {
        Alert.alert('Slow down!', 'You can vote on up to 20 spots per hour. Come back soon.');
      }
      return;
    }
    setCurrentVote(prev => prev === v ? null : v);
    setSelectedSpot(prev => {
      if (!prev) return null;
      let up = prev.thumbs_up, down = prev.thumbs_down;
      if (currentVote === 1) up--; if (currentVote === -1) down--;
      if (v !== currentVote) { if (v === 1) up++; else down++; }
      return { ...prev, thumbs_up: Math.max(0, up), thumbs_down: Math.max(0, down) };
    });
  };

  // ── Handle spot report ────────────────────────────────────────────────────
  const handleReportSpot = async () => {
    if (!selectedSpot) return;
    setReportSubmitting(true);
    const result = await reportSpot(
      selectedSpot.id,
      reportReason as any,
      reportDetail.trim() || undefined,
    );
    setReportSubmitting(false);
    setReportModalVisible(false);
    setReportReason('wrong_type'); setReportDetail('');
    if (!result.ok) {
      if (result.error === 'already_reported') {
        Alert.alert('Already Reported', 'You have already reported this spot. Thanks for keeping the map clean!');
      } else {
        Alert.alert('Error', 'Could not submit report. Please try again.');
      }
      return;
    }
    Alert.alert('Report Submitted', 'Thanks! Our community moderators will review this spot.');
  };

  // ── Handle event report ───────────────────────────────────────────────────
  const handleReportEvent = async () => {
    if (!selectedEvent) return;
    setReportSubmitting(true);
    const result = await reportEvent(
      selectedEvent.id,
      reportReason as any,
      reportDetail.trim() || undefined,
    );
    setReportSubmitting(false);
    setReportModalVisible(false);
    setReportReason('wrong_type'); setReportDetail('');
    if (!result.ok) {
      if (result.error === 'already_reported') {
        Alert.alert('Already Reported', 'You have already reported this event. Thanks for keeping the map clean!');
      } else {
        Alert.alert('Error', 'Could not submit report. Please try again.');
      }
      return;
    }
    Alert.alert('Report Submitted', 'Thanks! Our community moderators will review this event.');
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
  
  // Spots that have ≥1 upcoming event (for badge on pin)
  const spotEventIds = useMemo(() => {
    const ids = new Set<string>();
    events.forEach(e => { if (e.fly_spot_id) ids.add(e.fly_spot_id); });
    return ids;
  }, [events]);

  const panelEvents = useMemo(() => {
    const typeFilter =
      eventPanelFilter === 'race'   ? RACE_TYPES :
      eventPanelFilter === 'meetup' ? MEETUP_TYPES : ALL_EVENT_TYPES;
    return events
      .filter(e => typeFilter.includes(e.event_type))
      .filter(e =>
        !userLocation ||
        haversineDistance(
          userLocation.latitude, userLocation.longitude,
          e.latitude, e.longitude,
        ) <= panelDistance,
      );
  }, [events, eventPanelFilter, panelDistance, userLocation]);

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
        onRegionChangeComplete={(region) => {
          if (showAirspace) {
            loadAirspaceZones(
              region.latitude  - region.latitudeDelta,
              region.longitude - region.longitudeDelta,
              region.latitude  + region.latitudeDelta,
              region.longitude + region.longitudeDelta,
            );
          }
        }}
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
        {addrFound && (
          <Marker coordinate={addrFound} tracksViewChanges={false}>
            <Ionicons name="search-circle" size={40} color="#FFD700" />
          </Marker>
        )}
        {visibleSpots.map(spot => {
          const SpotPin = SPOT_PIN_MAP[spot.spot_type] ?? SPOT_PIN_MAP['freestyle'];
          return (
            <Marker key={spot.id} coordinate={{ latitude: spot.latitude, longitude: spot.longitude }} onPress={() => openSpot(spot)} tracksViewChanges={false}>
              <SpotPin size={44} hasEvent={spotEventIds.has(spot.id)} />
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
        {spotPin && <Marker coordinate={spotPin} tracksViewChanges={false}><Ionicons name="add-circle" size={36} color="#ff4500" /></Marker>}
        {evtPin && !showAddEvent && <Marker coordinate={evtPin} tracksViewChanges={false}><Ionicons name="calendar" size={36} color="#FFD700" /></Marker>}

        {/* ── FAA Airspace Restriction Polygons (B4UFLY data) ────────────────
            Data from FAA UAS Data Delivery System (public, no key needed).
            Class B = blue, C = purple, D = dashed blue, E = light blue,
            LAANC grids = green (shows altitude ceiling). ─────────────────── */}
        {showAirspace && airspaceZones.map(zone =>
          zone.coords.map((ring, ri) => {
            const col = AIRSPACE_COLORS[zone.type] ?? AIRSPACE_COLORS.DEFAULT;
            return (
              <Polygon
                key={`${zone.id}-${ri}`}
                coordinates={ring}
                fillColor={col.fill}
                strokeColor={col.stroke}
                strokeWidth={zone.type === 'CLASS-B' ? 2.5 : zone.type === 'LAANC' ? 1.5 : 2}
                zIndex={zone.type === 'LAANC' ? 8 : 10}
                tappable={false}
              />
            );
          })
        )}
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

      {/* ─── Address search result overlay ────────────────────────────────── */}
      {addrFound && !spotPinMode && !evtPinMode && (
        <View style={styles.addrResultBar} pointerEvents="box-none">
          <View style={styles.addrResultInner}>
            <Ionicons name="location" size={16} color="#FFD700" />
            <Text style={styles.addrResultText} numberOfLines={1}>{addrQuery}</Text>
            <TouchableOpacity style={styles.addrPinBtn} onPress={handleDropSpotAtAddr}>
              <Ionicons name="add-circle-outline" size={14} color="#fff" />
              <Text style={styles.addrPinBtnText}>Spot Here</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.addrPinBtn, { backgroundColor: '#1a3a5c', borderColor: '#2979FF' }]} onPress={handleDropEventAtAddr}>
              <Ionicons name="calendar-outline" size={14} color="#fff" />
              <Text style={styles.addrPinBtnText}>Event Here</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAddrFound(null)} style={{ padding: 4 }}>
              <Ionicons name="close" size={16} color="#666" />
            </TouchableOpacity>
          </View>
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

      
      {/* ── FAA Airspace: floating pill ────────────────────────────── */}
      {showAirspace && !airspaceLoading && (
        <TouchableOpacity
          style={styles.airspaceLegendBtn}
          onPress={() => setShowAirspaceLegend(v => !v)}
          activeOpacity={0.85}
        >
          <Ionicons name="warning" size={14} color="#ff4500" />
          <Text style={styles.airspaceLegendBtnText}>{airspaceZones.length} zones</Text>
          <Ionicons name={showAirspaceLegend ? "chevron-down" : "chevron-up"} size={13} color="#aaa" />
        </TouchableOpacity>
      )}

      {/* ── FAA Airspace Legend panel ─────────────────────────────── */}
      {showAirspace && showAirspaceLegend && (
        <View style={styles.airspaceLegendPanel} pointerEvents="box-none">
          <View style={styles.airspaceLegendHeader}>
            <Ionicons name="shield-checkmark-outline" size={14} color="#ff4500" />
            <Text style={styles.airspaceLegendTitle}>FAA Airspace Legend</Text>
            <TouchableOpacity onPress={() => setShowAirspaceLegend(false)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
              <Ionicons name="close" size={16} color="#666" />
            </TouchableOpacity>
          </View>
          {[
            { color: 'rgba(0,80,220,0.95)',   label: 'Class B', desc: 'Major airports – LAANC auth required' },
            { color: 'rgba(220,0,80,0.92)',   label: 'Class C', desc: 'Regional airports – LAANC auth required' },
            { color: 'rgba(0,210,210,0.90)',  label: 'Class D', desc: 'Towered airports – LAANC auth required' },
            { color: 'rgba(255,180,0,0.90)',  label: 'Class E', desc: 'Controlled airspace – check altitude rules' },
            { color: 'rgba(255,90,0,0.85)',   label: 'Mode C',  desc: 'Transponder veil – notify ATC' },
            { color: 'rgba(50,220,80,0.90)',  label: 'LAANC',   desc: 'UAS facility – altitude ceiling noted' },
          ].map(({ color, label, desc }) => (
            <View key={label} style={styles.airspaceLegendRow}>
              <View style={[styles.airspaceLegendSwatch, { backgroundColor: color }]} />
              <View style={styles.airspaceLegendRowText}>
                <Text style={styles.airspaceLegendLabel}>{label}</Text>
                <Text style={styles.airspaceLegendDesc}>{desc}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.airspaceLegendFooter}>
            {'Data: FAA UDDS · Always verify at '}
            <Text style={styles.airspaceLegendLink}>b4ufly.faa.gov</Text>
            {' before flying'}
          </Text>
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
            {/* Address search toggle button */}
            <TouchableOpacity
              style={[styles.iconBtn, showAddrSearch && styles.iconBtnSearchActive]}
              onPress={() => {
                const next = !showAddrSearch;
                setShowAddrSearch(next);
                if (next) setTimeout(() => addrInputRef.current?.focus(), 200);
                else { setAddrQuery(''); setAddrFound(null); }
              }}
            >
              <Ionicons name="search-outline" size={20} color={showAddrSearch ? '#FFD700' : '#fff'} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.iconBtn, isSatellite && styles.iconBtnSatellite]} onPress={() => setIsSatellite(v => !v)}>
              <Ionicons name={isSatellite ? "earth" : "earth-outline"} size={20} color={isSatellite ? '#FFD700' : '#fff'} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, showAirspace && styles.iconBtnAirspace]}
              onPress={() => setShowAirspace(v => !v)}
            >
              <Ionicons name={showAirspace ? "warning" : "warning-outline"} size={20} color={showAirspace ? '#ff4500' : '#fff'} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.iconBtn, showFilterPanel && styles.iconBtnActive]} onPress={() => setShowFilterPanel(true)}>
              <Ionicons name={showFilterPanel ? "funnel" : "funnel-outline"} size={20} color={showFilterPanel ? '#FFD700' : '#fff'} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => { if (userLocation) mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 0.3, longitudeDelta: 0.3 }, 600); }}>
              <Ionicons name="navigate" size={20} color="#fff" />
            </TouchableOpacity>
            {/* Admin moderation button — only visible to admins */}
            {isAdmin && (
              <TouchableOpacity
                style={[styles.iconBtn, styles.iconBtnAdmin]}
                onPress={() => router.push('/(tabs)/admin')}
              >
                <Ionicons name="shield-checkmark" size={20} color="#FF9800" />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {/* ── Airspace: slim loading badge (top-right, unobtrusive) ─────── */}
        {showAirspace && airspaceLoading && (
          <View style={styles.airspaceLoadingBadge} pointerEvents="none">
            <ActivityIndicator size="small" color="#ff4500" />
            <Text style={styles.airspaceLoadingText}>Loading airspace…</Text>
          </View>
        )}

        {/* Address search bar — shown when search icon is active */}
        {showAddrSearch && (
          <View style={styles.addrSearchRow}>
            <Ionicons name="search" size={16} color="#888" style={{ marginLeft: 12 }} />
            <TextInput
              ref={addrInputRef}
              style={styles.addrSearchInput}
              placeholder="Search address or place…"
              placeholderTextColor="#555"
              value={addrQuery}
              onChangeText={setAddrQuery}
              onSubmitEditing={handleAddressSearch}
              returnKeyType="search"
              autoCorrect={false}
            />
            {addrSearching
              ? <ActivityIndicator size="small" color="#ff4500" style={{ marginRight: 10 }} />
              : (
                <TouchableOpacity style={styles.addrSearchBtn} onPress={handleAddressSearch}>
                  <Text style={styles.addrSearchBtnText}>Go</Text>
                </TouchableOpacity>
              )
            }
          </View>
        )}

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
                onPress={() => { closePanel(); setTimeout(() => checkGuidelinesAndProceed('event'), 350); }}
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
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={true}
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
          <TouchableOpacity style={[styles.fab, styles.fabEvent]} onPress={() => checkGuidelinesAndProceed('event')}>
            <Ionicons name="calendar-outline" size={18} color="#fff" />
            <Text style={styles.fabLabel}>Event</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={() => checkGuidelinesAndProceed('spot')}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.fabLabel}>Spot</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Filter panel modal ───────────────────────────────────────────── */}
      <Modal visible={showFilterPanel} transparent animationType="slide" onRequestClose={() => setShowFilterPanel(false)}>
        <View style={styles.modalWrap} pointerEvents="box-none">
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
      <Modal visible={showAddSpot} transparent animationType="slide" onRequestClose={() => { setShowAddSpot(false); setSpotPin(null); }}>
        <View style={styles.modalWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => { setShowAddSpot(false); setSpotPin(null); }} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>📍 Add FPV Spot</Text>
              {spotPin && <Text style={styles.coordText}>{spotPin.latitude.toFixed(5)}, {spotPin.longitude.toFixed(5)}</Text>}
              <TextInput style={styles.input} placeholder="Spot name *" placeholderTextColor="#555" value={spotName} onChangeText={setSpotName} />
              <TextInput style={[styles.input, { height: 72, textAlignVertical: 'top' }]} placeholder="Description (optional)" placeholderTextColor="#555" value={spotDesc} onChangeText={setSpotDesc} multiline numberOfLines={3} />
              <Text style={styles.fieldLabel}>Spot Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
        </View>
      </Modal>

      {/* ─── Add Event modal ─────────────────────────────────────────────── */}
      <Modal visible={showAddEvent} transparent animationType="slide" onRequestClose={() => { setShowAddEvent(false); setEvtPin(null); setEvtLinkedSpotId(null); }}>
        <View style={styles.modalWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => { setShowAddEvent(false); setEvtPin(null); setEvtLinkedSpotId(null); }} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
            <View style={[styles.sheet, { maxHeight: height * 0.9, padding: 0 }]}>
              <ScrollView
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
              >
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>📅 Schedule Event</Text>

                {/* Location row */}
                <Text style={styles.fieldLabel}>LOCATION</Text>
                {evtPin ? (
                  <View style={styles.evtPinRow}>
                    <Ionicons name="location" size={14} color="#ff4500" />
                    <Text style={styles.evtPinText}>{evtPin.latitude.toFixed(5)}, {evtPin.longitude.toFixed(5)}</Text>
                    <TouchableOpacity onPress={() => setEvtPin(null)} style={styles.evtPinClear}>
                      <Ionicons name="close-circle" size={16} color="#555" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 8, marginBottom: 12 }}>
                    <TouchableOpacity
                      style={styles.evtLocBtn}
                      onPress={() => { setShowAddEvent(false); setTimeout(() => checkGuidelinesAndProceed('event'), 200); }}
                    >
                      <Ionicons name="map-outline" size={16} color="#ff4500" />
                      <Text style={styles.evtLocBtnText}>Tap map to drop a new pin</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.evtLocBtn, { borderColor: '#2979FF' }]}
                      onPress={() => setShowExistingPinPicker(true)}
                    >
                      <Ionicons name="pin-outline" size={16} color="#2979FF" />
                      <Text style={[styles.evtLocBtnText, { color: '#2979FF' }]}>Use an existing FPV spot</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Event Type chips */}
                <Text style={styles.fieldLabel}>EVENT TAG</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 12 }}>
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
                <TextInput style={[styles.input, { height: 60, textAlignVertical: 'top' }]} placeholder="Description (optional)" placeholderTextColor="#555" value={evtDesc} onChangeText={setEvtDesc} multiline />
                <TextInput style={styles.input} placeholder="Venue name" placeholderTextColor="#555" value={evtVenue} onChangeText={setEvtVenue} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="City" placeholderTextColor="#555" value={evtCity} onChangeText={setEvtCity} />
                  <TextInput style={[styles.input, { width: 70 }]} placeholder="State" placeholderTextColor="#555" value={evtState} onChangeText={setEvtState} />
                </View>

                {/* Start date/time picker */}
                <Text style={styles.fieldLabel}>START DATE & TIME</Text>
                <View onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}>
                  <DateTimePicker
                    year={evtStartYear} month={evtStartMonth} day={evtStartDay}
                    hour={evtStartHour} minute={evtStartMin}
                    onChangeYear={setEvtStartYear} onChangeMonth={setEvtStartMonth}
                    onChangeDay={setEvtStartDay} onChangeHour={setEvtStartHour}
                    onChangeMinute={setEvtStartMin}
                  />
                </View>

                {/* End date/time toggle */}
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Add end time (optional)</Text>
                  <Switch
                    value={evtHasEnd}
                    onValueChange={setEvtHasEnd}
                    trackColor={{ false: '#333', true: '#ff4500' }}
                    thumbColor="#fff"
                  />
                </View>
                {evtHasEnd && (
                  <>
                    <Text style={styles.fieldLabel}>END DATE & TIME</Text>
                    <View onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}>
                      <DateTimePicker
                        year={evtEndYear} month={evtEndMonth} day={evtEndDay}
                        hour={evtEndHour} minute={evtEndMin}
                        onChangeYear={setEvtEndYear} onChangeMonth={setEvtEndMonth}
                        onChangeDay={setEvtEndDay} onChangeHour={setEvtEndHour}
                        onChangeMinute={setEvtEndMin}
                      />
                    </View>
                  </>
                )}

                <TextInput style={styles.input} placeholder="Max participants" placeholderTextColor="#555" value={evtMax} onChangeText={setEvtMax} keyboardType="numeric" />
                <TextInput style={styles.input} placeholder="Registration URL (optional)" placeholderTextColor="#555" value={evtUrl} onChangeText={setEvtUrl} autoCapitalize="none" keyboardType="url" />
                <TouchableOpacity style={[styles.applyBtn, submitting && { opacity: 0.5 }]} onPress={handleSubmitEvent} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyBtnText}>Publish Event 🚀</Text>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ─── Existing Pin Picker modal ───────────────────────────────────────── */}
      <Modal visible={showExistingPinPicker} transparent animationType="slide" onRequestClose={() => setShowExistingPinPicker(false)}>
        <View style={styles.modalWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowExistingPinPicker(false)} />
          <View style={[styles.sheet, { maxHeight: '70%' }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>📍 Pick an Existing Spot</Text>
            <Text style={styles.sheetSection}>Select a spot to use as the event location</Text>
            <FlatList
              data={spots}
              keyExtractor={s => s.id}
              style={{ maxHeight: 400 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <Ionicons name="location-outline" size={40} color="#333" />
                  <Text style={{ color: '#555', marginTop: 8 }}>No spots found nearby</Text>
                </View>
              }
              renderItem={({ item: spot }) => {
                const cfg = SPOT_CONFIG[spot.spot_type] ?? SPOT_CONFIG['freestyle'];
                return (
                  <TouchableOpacity
                    style={styles.spotPickerRow}
                    onPress={() => {
                      setEvtPin({ latitude: spot.latitude, longitude: spot.longitude });
                      if (!evtVenue.trim()) setEvtVenue(spot.name);
                      setShowExistingPinPicker(false);
                    }}
                  >
                    <View style={[styles.spotPickerDot, { backgroundColor: cfg.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.spotPickerName}>{spot.name}</Text>
                      <Text style={styles.spotPickerType}>{cfg.label}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#444" />
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* ─── Spot detail modal ────────────────────────────────────────────── */}
      <Modal visible={!!selectedSpot} transparent animationType="slide" onRequestClose={() => setSelectedSpot(null)}>
        <View style={styles.modalWrap} pointerEvents="box-none">
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
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 }}>
                  <Text style={styles.detailName}>{selectedSpot.name}</Text>
                  {selectedSpot.is_verified && (
                    <View style={styles.verifiedBadge}><Text style={styles.verifiedBadgeTxt}>✅ Verified</Text></View>
                  )}
                  {selectedSpot.is_flagged && (
                    <View style={styles.flaggedBadge}><Text style={styles.flaggedBadgeTxt}>🚩 Flagged</Text></View>
                  )}
                </View>
                {/* ── Schedule at this Spot — Race OR Meetup ── */}
                <View style={styles.scheduleAtSpotRow}>
                  <TouchableOpacity
                    style={[styles.scheduleAtSpotBtn, { flex: 1 }]}
                    onPress={() => {
                      setEvtPin({ latitude: selectedSpot.latitude, longitude: selectedSpot.longitude });
                      setEvtVenue(selectedSpot.name);
                      setEvtLinkedSpotId(selectedSpot.id);
                      setEvtType('race');
                      setSelectedSpot(null);
                      setTimeout(() => setShowAddEvent(true), 320);
                    }}
                  >
                    <Ionicons name="trophy-outline" size={15} color="#fff" />
                    <Text style={styles.scheduleAtSpotBtnText}>Race</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.scheduleAtSpotBtn, styles.scheduleAtSpotBtnMeetup, { flex: 1 }]}
                    onPress={() => {
                      setEvtPin({ latitude: selectedSpot.latitude, longitude: selectedSpot.longitude });
                      setEvtVenue(selectedSpot.name);
                      setEvtLinkedSpotId(selectedSpot.id);
                      setEvtType('meetup');
                      setSelectedSpot(null);
                      setTimeout(() => setShowAddEvent(true), 320);
                    }}
                  >
                    <Ionicons name="people-outline" size={15} color="#fff" />
                    <Text style={styles.scheduleAtSpotBtnText}>Meetup</Text>
                  </TouchableOpacity>
                </View>
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
                {/* Report spot button */}
                {selectedSpot.created_by !== user?.id && (
                  <TouchableOpacity
                    style={styles.reportSpotBtn}
                    onPress={() => { setReportTargetType('spot'); setReportReason('wrong_type'); setReportDetail(''); setReportModalVisible(true); }}
                  >
                    <Ionicons name="flag-outline" size={14} color="#FF9800" />
                    <Text style={styles.reportSpotBtnTxt}>Report this spot</Text>
                  </TouchableOpacity>
                )}
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
        <View style={styles.modalWrap} pointerEvents="box-none">
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
                {/* Report event button — hidden for organizer and MultiGP events */}
                {selectedEvent.organizer_id !== user?.id && selectedEvent.event_source !== 'multigp' && (
                  <TouchableOpacity
                    style={styles.reportSpotBtn}
                    onPress={() => {
                      setReportTargetType('event');
                      setReportReason('wrong_type');
                      setReportDetail('');
                      setReportModalVisible(true);
                    }}
                  >
                    <Ionicons name="flag-outline" size={14} color="#FF9800" />
                    <Text style={styles.reportSpotBtnTxt}>Report this event</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ─── Report Spot Modal ──────────────────────────────────────────────── */}
      <Modal visible={reportModalVisible} transparent animationType="fade" onRequestClose={() => setReportModalVisible(false)}>
        <View style={styles.reportModalOverlay}>
          <View style={styles.reportModalBox}>
            <Text style={styles.reportModalTitle}>{reportTargetType === 'event' ? '🚩 Report Event' : '🚩 Report Spot'}</Text>
            <Text style={styles.reportModalSub}>{reportTargetType === 'event' ? 'Help keep events accurate. Select a reason:' : 'Help keep the map accurate. Select a reason:'}</Text>
            {(reportTargetType === 'event' ? ([
              ['wrong_type',     '🏷  Wrong event type'],
              ['does_not_exist', '❌  Event cancelled / never existed'],
              ['spam',           '📢  Spam or irrelevant'],
              ['offensive_name', '🤬  Offensive name'],
              ['fake_event',     '🎭  Fake or fraudulent event'],
              ['wrong_date',     '📅  Wrong date / time'],
              ['other',          '💬  Other'],
            ] as [string, string][]) : ([
              ['wrong_type',     '🏷  Wrong spot type'],
              ['wrong_hazard',   '⚠️  Wrong hazard level'],
              ['does_not_exist', "❌  Location doesn't exist"],
              ['dangerous',      '☠️  Dangerous / restricted airspace'],
              ['duplicate',      '📍 Duplicate pin nearby'],
              ['offensive_name', '🤬  Offensive name'],
              ['other',          '💬  Other'],
            ] as [string, string][])).map(([val, label]) => (
              <TouchableOpacity
                key={val}
                style={[styles.reportOption, reportReason === val && styles.reportOptionActive]}
                onPress={() => setReportReason(val)}
              >
                <Text style={[styles.reportOptionTxt, reportReason === val && { color: '#fff' }]}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TextInput
              style={styles.reportDetailInput}
              placeholder="Additional details (optional)..."
              placeholderTextColor="#555"
              value={reportDetail}
              onChangeText={setReportDetail}
              multiline
              numberOfLines={2}
            />
            <View style={styles.reportModalBtns}>
              <TouchableOpacity style={styles.reportCancelBtn} onPress={() => setReportModalVisible(false)}>
                <Text style={{ color: '#888', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.reportSubmitBtn} onPress={reportTargetType === 'event' ? handleReportEvent : handleReportSpot} disabled={reportSubmitting}>
                {reportSubmitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Submit Report</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Community Guidelines Modal ──────────────────────────────────────── */}
      <Modal
        visible={showGuidelinesModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGuidelinesModal(false)}
      >
        <View style={styles.guidelinesOverlay}>
          <View style={styles.guidelinesBox}>
            {/* Header */}
            <View style={styles.guidelinesHeader}>
              <Text style={styles.guidelinesIcon}>📋</Text>
              <Text style={styles.guidelinesTitle}>Community Guidelines</Text>
            </View>
            <Text style={styles.guidelinesSub}>
              Please read and agree to our Community Guidelines before every pin or event you submit.
            </Text>

            <ScrollView
              style={styles.guidelinesScroll}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {/* Section: What Makes a Good Pin */}
              <View style={styles.guidelinesSection}>
                <Text style={styles.guidelinesSectionTitle}>✅  What Makes a Good Pin</Text>
                <Text style={styles.guidelinesBullet}>• Spots must be <Text style={styles.guidelinesEm}>real, flyable locations</Text> you have personally verified or know well.</Text>
                <Text style={styles.guidelinesBullet}>• Place the pin <Text style={styles.guidelinesEm}>accurately</Text> — within walking distance of the actual flying area.</Text>
                <Text style={styles.guidelinesBullet}>• Use clear, descriptive names (e.g. "Riverside Bando" not "cool spot").</Text>
                <Text style={styles.guidelinesBullet}>• Set the correct spot type and hazard level honestly.</Text>
              </View>

              {/* Section: What Is Not Allowed */}
              <View style={styles.guidelinesSection}>
                <Text style={styles.guidelinesSectionTitle}>🚫  What Is Not Allowed</Text>
                <Text style={styles.guidelinesBullet}>• <Text style={styles.guidelinesEm}>Fake or duplicate pins</Text> — check the map before submitting.</Text>
                <Text style={styles.guidelinesBullet}>• Pins on <Text style={styles.guidelinesEm}>private property without permission</Text> or in no-fly zones.</Text>
                <Text style={styles.guidelinesBullet}>• Offensive, hateful, or inappropriate names or descriptions.</Text>
                <Text style={styles.guidelinesBullet}>• URLs, links, phone numbers, or personal contact info in descriptions.</Text>
                <Text style={styles.guidelinesBullet}>• Deliberately wrong types (e.g. marking a bando as a race track).</Text>
                <Text style={styles.guidelinesBullet}>• Submitting pins far from your actual location (50-mile limit enforced).</Text>
              </View>

              {/* Section: Airspace & Safety */}
              <View style={styles.guidelinesSection}>
                <Text style={styles.guidelinesSectionTitle}>⚠️  Airspace & Safety</Text>
                <Text style={styles.guidelinesBullet}>• Always check FAA airspace (use the airspace toggle on the map) before flying.</Text>
                <Text style={styles.guidelinesBullet}>• Do <Text style={styles.guidelinesEm}>not</Text> add spots inside Class B/C/D airspace without LAANC authorization.</Text>
                <Text style={styles.guidelinesBullet}>• Pins in hazardous areas should have the hazard level set to "High".</Text>
              </View>

              {/* Section: Events */}
              <View style={styles.guidelinesSection}>
                <Text style={styles.guidelinesSectionTitle}>📅  Events</Text>
                <Text style={styles.guidelinesBullet}>• Only post events you are actually organising or have authority to list.</Text>
                <Text style={styles.guidelinesBullet}>• Keep event details accurate — date, location, and type must be correct.</Text>
                <Text style={styles.guidelinesBullet}>• Do not use event descriptions to advertise unrelated products or services.</Text>
              </View>

              {/* Section: Enforcement */}
              <View style={styles.guidelinesSection}>
                <Text style={styles.guidelinesSectionTitle}>🔨  Enforcement</Text>
                <Text style={styles.guidelinesBullet}>• Community members can report pins. Spots with 3+ reports are automatically flagged for review.</Text>
                <Text style={styles.guidelinesBullet}>• Repeated violations may result in account suspension.</Text>
                <Text style={styles.guidelinesBullet}>• Admins may delete any pin that violates these guidelines without notice.</Text>
              </View>
            </ScrollView>

            {/* Agree checkbox row */}
            <TouchableOpacity
              style={styles.guidelinesCheckRow}
              activeOpacity={0.7}
              onPress={() => setGuidelinesChecked(v => !v)}
            >
              <View style={[styles.guidelinesCheckbox, guidelinesChecked && styles.guidelinesCheckboxOn]}>
                {guidelinesChecked && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={styles.guidelinesCheckLabel}>
                I have read and agree to the Community Guidelines
              </Text>
            </TouchableOpacity>

            {/* Buttons */}
            <View style={styles.guidelinesBtns}>
              <TouchableOpacity
                style={styles.guidelinesCancelBtn}
                onPress={() => { setShowGuidelinesModal(false); setGuidelinesPendingAction(null); }}
              >
                <Text style={styles.guidelinesCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.guidelinesAcceptBtn, !guidelinesChecked && styles.guidelinesAcceptBtnDisabled]}
                onPress={handleGuidelinesAccept}
              >
                <Text style={styles.guidelinesAcceptTxt}>I Agree – Continue</Text>
              </TouchableOpacity>
            </View>
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
  iconBtnAirspace:  { borderColor: '#ff4500', backgroundColor: 'rgba(255,69,0,0.18)' },
  // ── Airspace overlay UI ───────────────────────────────────────────────────────
  airspaceLoadingBadge: {
    position: 'absolute', top: 110, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#ff4500', zIndex: 20,
  },
  airspaceLoadingText:   { color: '#ccc', fontSize: 11 },
  airspaceLegendBtn: {
    position: 'absolute', bottom: 178, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(10,10,20,0.90)',
    borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7,
    borderWidth: 1.5, borderColor: '#ff4500',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45, shadowRadius: 6, zIndex: 25,
  },
  airspaceLegendBtnText: { color: '#ff4500', fontSize: 12, fontWeight: '700' },
  airspaceLegendPanel: {
    position: 'absolute', bottom: 222, right: 14, width: 262,
    backgroundColor: 'rgba(8,12,24,0.97)',
    borderRadius: 14, borderWidth: 1.5, borderColor: '#ff4500',
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14,
    elevation: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6, shadowRadius: 10, zIndex: 24,
  },
  airspaceLegendHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  airspaceLegendTitle:  { flex: 1, color: '#fff', fontSize: 13, fontWeight: '700' },
  airspaceLegendRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  airspaceLegendSwatch: { width: 14, height: 14, borderRadius: 3 },
  airspaceLegendRowText: { flex: 1 },
  airspaceLegendLabel:  { color: '#fff', fontSize: 12, fontWeight: '600' },
  airspaceLegendDesc:   { color: '#888', fontSize: 10, marginTop: 1 },
  airspaceLegendFooter: { color: '#555', fontSize: 10, marginTop: 6, lineHeight: 14 },
  airspaceLegendLink:   { color: '#ff4500', textDecorationLine: 'underline' },
  iconBtnMgp:       { borderColor: '#2979FF', backgroundColor: 'rgba(41,121,255,0.12)' },
  iconBtnSearchActive: { borderColor: '#FFD700', backgroundColor: 'rgba(255,215,0,0.15)' },
  iconBtnActive:       { borderColor: '#FFD700', backgroundColor: 'rgba(255,215,0,0.15)' },
  iconBtnAdmin:        { borderColor: '#FF9800', backgroundColor: 'rgba(255,152,0,0.15)' },

  // Address search bar
  addrSearchRow:   { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 14, borderWidth: 1, borderColor: '#FFD700', overflow: 'hidden' },
  addrSearchInput: { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 10, paddingHorizontal: 8, height: 42 },
  addrSearchBtn:   { backgroundColor: '#FFD700', paddingHorizontal: 16, paddingVertical: 10, alignSelf: 'stretch', justifyContent: 'center' },
  addrSearchBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },

  // Address result overlay (shown on map after geocode)
  addrResultBar:   { position: 'absolute', bottom: 110, left: 12, right: 12, alignItems: 'center' },
  addrResultInner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.88)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderWidth: 1, borderColor: '#FFD700', flexWrap: 'wrap' },
  addrResultText:  { color: '#FFD700', fontSize: 12, fontWeight: '600', flex: 1 },
  addrPinBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,69,0,0.85)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: '#ff4500' },
  addrPinBtnText:  { color: '#fff', fontSize: 11, fontWeight: '700' },

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
  dateHint:   { color: '#444', fontSize: 11, marginBottom: 6, fontStyle: 'italic' },

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
  scheduleAtSpotRow: {
    flexDirection: 'row', gap: 8, marginVertical: 8,
  },
  scheduleAtSpotBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#ff4500', borderRadius: 10, paddingVertical: 10,
    paddingHorizontal: 12, gap: 5,
  },
  scheduleAtSpotBtnMeetup: {
    backgroundColor: '#FF9100',
  },
  scheduleAtSpotBtnText: {
    color: '#fff', fontSize: 13, fontWeight: '700',
  },
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

  // Event location picker
  evtPinRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#ff4500' },
  evtPinText:     { flex: 1, color: '#ff4500', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  evtPinClear:    { padding: 2 },
  evtLocBtn:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#ff4500', marginBottom: 0 },
  evtLocBtnText:  { color: '#ff4500', fontWeight: '700', fontSize: 13 },

  // Spot picker list
  spotPickerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  spotPickerDot:  { width: 12, height: 12, borderRadius: 6 },
  spotPickerName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  spotPickerType: { color: '#555', fontSize: 11, marginTop: 2 },

  // ── Map fraud-prevention UI ──────────────────────────────────────────────
  verifiedBadge:      { backgroundColor: '#00C853', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  verifiedBadgeTxt:   { color: '#fff', fontSize: 10, fontWeight: '700' },
  flaggedBadge:       { backgroundColor: '#FF9800', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  flaggedBadgeTxt:    { color: '#fff', fontSize: 10, fontWeight: '700' },
  reportSpotBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 4, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#FF9800' },
  reportSpotBtnTxt:   { color: '#FF9800', fontSize: 12, fontWeight: '600' },
  reportModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  reportModalBox:     { backgroundColor: '#111', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420 },
  reportModalTitle:   { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  reportModalSub:     { color: '#888', fontSize: 13, marginBottom: 12 },
  reportOption:       { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 6 },
  reportOptionActive: { backgroundColor: '#FF9800', borderColor: '#FF9800' },
  reportOptionTxt:    { color: '#ccc', fontSize: 14 },
  reportDetailInput:  { backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', color: '#fff', padding: 10, marginTop: 8, marginBottom: 12, fontSize: 13, minHeight: 52 },
  reportModalBtns:    { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  reportCancelBtn:    { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#333' },
  reportSubmitBtn:    { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FF9800' },
  // ── Community Guidelines Modal ─────────────────────────────────────────────
  guidelinesOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  guidelinesBox: {
    backgroundColor: '#111',
    borderRadius: 20,
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    borderWidth: 1.5,
    borderColor: '#ff4500',
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  guidelinesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  guidelinesIcon: { fontSize: 26 },
  guidelinesTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    flex: 1,
  },
  guidelinesSub: {
    color: '#888',
    fontSize: 13,
    marginBottom: 14,
    lineHeight: 18,
  },
  guidelinesScroll: { maxHeight: 340, marginBottom: 14 },
  guidelinesSection: {
    marginBottom: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  guidelinesSectionTitle: {
    color: '#ff4500',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  guidelinesBullet: {
    color: '#bbb',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  guidelinesEm: {
    color: '#fff',
    fontWeight: '700',
  },
  guidelinesCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#ff4500',
    marginBottom: 14,
  },
  guidelinesCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#ff4500',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidelinesCheckboxOn: { backgroundColor: '#ff4500' },
  guidelinesCheckLabel: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  guidelinesBtns: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  guidelinesCancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  guidelinesCancelTxt: { color: '#888', fontWeight: '600', fontSize: 14 },
  guidelinesAcceptBtn: {
    flex: 1,
    backgroundColor: '#ff4500',
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  guidelinesAcceptBtnDisabled: { backgroundColor: '#4a1a00', opacity: 0.6 },
  guidelinesAcceptTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
