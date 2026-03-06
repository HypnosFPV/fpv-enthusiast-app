// app/(tabs)/map.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  FlatList, ActivityIndicator, Platform, Alert, ScrollView,
  KeyboardAvoidingView, Dimensions, SafeAreaView, Switch,
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE, MapPressEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { useMap, FlySpot, RaceEvent, SpotComment, NewSpotData, NewEventData } from '../../src/hooks/useMap';

const { width } = Dimensions.get('window');

// ─── Dark map style ────────────────────────────────────────────────────────────
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

// ─── Config ────────────────────────────────────────────────────────────────────
const SPOT_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  freestyle:  { color: '#00C853', label: 'Freestyle',  icon: 'bicycle'   },
  bando:      { color: '#FF6D00', label: 'Bando',      icon: 'business'  },
  race_track: { color: '#2979FF', label: 'Race Track', icon: 'flag'      },
  open_field: { color: '#FFD600', label: 'Open Field', icon: 'leaf'      },
  indoor:     { color: '#E040FB', label: 'Indoor',     icon: 'home'      },
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

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// ─── Custom pin marker ─────────────────────────────────────────────────────────
function PinMarker({ color, icon, isMultiGP }: { color: string; icon: string; isMultiGP?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[pStyles.circle, { backgroundColor: color }]}>
        <Ionicons name={icon as any} size={13} color="#fff" />
      </View>
      {isMultiGP && (
        <View style={pStyles.badge}><Text style={pStyles.badgeText}>M</Text></View>
      )}
      <View style={[pStyles.tail, { borderTopColor: color }]} />
    </View>
  );
}
const pStyles = StyleSheet.create({
  circle: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  tail:   { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  badge:  { position: 'absolute', top: -5, right: -8, backgroundColor: '#FF6D00', borderRadius: 7, width: 14, height: 14, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 7, fontWeight: '900' },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function MapScreen() {
  const { user } = useAuth();
  const {
    spots, events, comments, loading,
    fetchSpots, fetchEvents, fetchComments,
    addSpot, voteSpot, addComment,
    addEvent, toggleRsvp,
  } = useMap(user?.id);

  const mapRef = useRef<MapView>(null);

  // location
  const [userLocation,    setUserLocation]    = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);

  // filters
  const [radiusMiles,      setRadiusMiles]      = useState(50);
  const [showSpots,        setShowSpots]        = useState(true);
  const [showEvents,       setShowEvents]       = useState(true);
  const [spotTypeFilters,  setSpotTypeFilters]  = useState<string[]>([...ALL_SPOT_TYPES]);
  const [eventTypeFilters, setEventTypeFilters] = useState<string[]>([...ALL_EVENT_TYPES]);
  const [showFilterPanel,  setShowFilterPanel]  = useState(false);

  // view
  const [activeView, setActiveView] = useState<'map' | 'events'>('map');

  // pin-drop modes
  const [spotPinMode, setSpotPinMode] = useState(false);
  const [evtPinMode,  setEvtPinMode]  = useState(false);
  const [spotPin,     setSpotPin]     = useState<{ latitude: number; longitude: number } | null>(null);
  const [evtPin,      setEvtPin]      = useState<{ latitude: number; longitude: number } | null>(null);

  // modals
  const [selectedSpot,  setSelectedSpot]  = useState<FlySpot | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<RaceEvent | null>(null);
  const [showAddSpot,   setShowAddSpot]   = useState(false);
  const [showAddEvent,  setShowAddEvent]  = useState(false);

  // add-spot form
  const [spotName,    setSpotName]   = useState('');
  const [spotDesc,    setSpotDesc]   = useState('');
  const [spotType,    setSpotType]   = useState<FlySpot['spot_type']>('freestyle');
  const [spotHazard,  setSpotHazard] = useState<FlySpot['hazard_level']>('low');

  // add-event form
  const [evtName,  setEvtName]  = useState('');
  const [evtDesc,  setEvtDesc]  = useState('');
  const [evtType,  setEvtType]  = useState<RaceEvent['event_type']>('race');
  const [evtVenue, setEvtVenue] = useState('');
  const [evtCity,  setEvtCity]  = useState('');
  const [evtState, setEvtState] = useState('');
  const [evtStart, setEvtStart] = useState('');
  const [evtEnd,   setEvtEnd]   = useState('');
  const [evtMax,   setEvtMax]   = useState('');
  const [evtUrl,   setEvtUrl]   = useState('');

  // comment form
  const [commentText,     setCommentText]     = useState('');
  const [isAnonymous,     setIsAnonymous]     = useState(false);
  const [submitting,      setSubmitting]      = useState(false);
  const [postingComment,  setPostingComment]  = useState(false);

  // current vote state for selected spot
  const [currentVote, setCurrentVote] = useState<1 | -1 | null>(null);

  // ── Init: location ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocationGranted(false); return; }
      setLocationGranted(true);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      setUserLocation({ latitude, longitude });
      mapRef.current?.animateToRegion(
        { latitude, longitude, latitudeDelta: 0.5, longitudeDelta: 0.5 }, 800,
      );
      fetchSpots(latitude, longitude, 50, ALL_SPOT_TYPES);
      fetchEvents(latitude, longitude, 50, ALL_EVENT_TYPES);
    })();
  }, []);

  // ── Refresh on filter change ────────────────────────────────────────────────
  const refreshData = useCallback(() => {
    if (!userLocation) return;
    const { latitude, longitude } = userLocation;
    if (showSpots)  fetchSpots(latitude, longitude, radiusMiles, spotTypeFilters);
    if (showEvents) fetchEvents(latitude, longitude, radiusMiles, eventTypeFilters);
  }, [userLocation, radiusMiles, showSpots, showEvents, spotTypeFilters, eventTypeFilters]);

  // ── Map press ───────────────────────────────────────────────────────────────
  const handleMapPress = (e: MapPressEvent) => {
    const coords = e.nativeEvent.coordinate;
    if (spotPinMode) {
      setSpotPin(coords);
      setSpotPinMode(false);
      setShowAddSpot(true);
    } else if (evtPinMode) {
      setEvtPin(coords);
      setEvtPinMode(false);
      setShowAddEvent(true);
    }
  };

  // ── Toggle filters ──────────────────────────────────────────────────────────
  const toggleSpotType = (t: string) =>
    setSpotTypeFilters(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const toggleEventType = (t: string) =>
    setEventTypeFilters(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  // ── Submit spot ─────────────────────────────────────────────────────────────
  const handleSubmitSpot = async () => {
    if (!spotPin || !spotName.trim()) {
      Alert.alert('Missing info', 'Spot name and map pin are required.'); return;
    }
    setSubmitting(true);
    const { data, error } = await addSpot(
      {
        name: spotName.trim(), description: spotDesc.trim(),
        spot_type: spotType, hazard_level: spotHazard,
        latitude: spotPin.latitude, longitude: spotPin.longitude,
      },
      user?.email ?? 'Pilot',
    );
    setSubmitting(false);
    if (error) { Alert.alert('Error', 'Could not add spot.'); return; }
    setShowAddSpot(false);
    setSpotName(''); setSpotDesc(''); setSpotType('freestyle');
    setSpotHazard('low'); setSpotPin(null);
    Alert.alert('✅ Spot added!', `"${data?.name}" is now on the map.`);
  };

  // ── Submit event ────────────────────────────────────────────────────────────
  const handleSubmitEvent = async () => {
    if (!evtPin || !evtName.trim() || !evtStart.trim()) {
      Alert.alert('Missing info', 'Name, start time, and map pin are required.'); return;
    }
    setSubmitting(true);
    const startISO = new Date(evtStart).toISOString();
    const endISO   = evtEnd.trim() ? new Date(evtEnd).toISOString() : '';
    const { data, error } = await addEvent({
      name: evtName.trim(), description: evtDesc.trim(),
      event_type: evtType, latitude: evtPin.latitude, longitude: evtPin.longitude,
      venue_name: evtVenue.trim(), city: evtCity.trim(), state: evtState.trim(),
      start_time: startISO, end_time: endISO,
      max_participants: evtMax, registration_url: evtUrl.trim(),
    });
    setSubmitting(false);
    if (error) { Alert.alert('Error', 'Could not publish event.'); return; }
    setShowAddEvent(false);
    setEvtName(''); setEvtDesc(''); setEvtVenue(''); setEvtCity(''); setEvtState('');
    setEvtStart(''); setEvtEnd(''); setEvtMax(''); setEvtUrl(''); setEvtPin(null);
    Alert.alert('✅ Event published!', `"${data?.name}" is live on the map.`);
  };

  // ── Open spot detail ────────────────────────────────────────────────────────
  const openSpot = async (spot: FlySpot) => {
    setSelectedSpot(spot);
    setCurrentVote(null);
    setCommentText('');
    await fetchComments(spot.id);
  };

  // ── Post comment ────────────────────────────────────────────────────────────
  const handlePostComment = async () => {
    if (!selectedSpot || !commentText.trim()) return;
    setPostingComment(true);
    await addComment(selectedSpot.id, commentText.trim(), isAnonymous);
    setCommentText('');
    setPostingComment(false);
  };

  // ── Vote ────────────────────────────────────────────────────────────────────
  const handleVote = async (v: 1 | -1) => {
    if (!selectedSpot) return;
    await voteSpot(selectedSpot.id, v, currentVote);
    setCurrentVote(prev => prev === v ? null : v);
    setSelectedSpot(prev => {
      if (!prev) return null;
      let up = prev.thumbs_up, down = prev.thumbs_down;
      if (currentVote === 1)  up--;
      if (currentVote === -1) down--;
      if (v !== currentVote) { if (v === 1) up++; else down++; }
      return { ...prev, thumbs_up: Math.max(0, up), thumbs_down: Math.max(0, down) };
    });
  };

  // ── No permission ───────────────────────────────────────────────────────────
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

  const visibleSpots  = showSpots  ? spots.filter(s => spotTypeFilters.includes(s.spot_type))   : [];
  const visibleEvents = showEvents ? events.filter(e => eventTypeFilters.includes(e.event_type)) : [];

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <View style={styles.container}>

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        customMapStyle={Platform.OS === 'android' ? DARK_MAP_STYLE : undefined}
        userInterfaceStyle="dark"
        initialRegion={{ latitude: 39.5, longitude: -98.35, latitudeDelta: 20, longitudeDelta: 20 }}
        showsUserLocation
        showsMyLocationButton={false}
        onPress={handleMapPress}
      >
        {userLocation && (
          <Circle
            center={userLocation}
            radius={radiusMiles * 1609.34}
            strokeColor="rgba(255,69,0,0.35)"
            fillColor="rgba(255,69,0,0.04)"
            strokeWidth={1.5}
          />
        )}
        {visibleSpots.map(spot => (
          <Marker
            key={spot.id}
            coordinate={{ latitude: spot.latitude, longitude: spot.longitude }}
            onPress={() => openSpot(spot)}
          >
            <PinMarker color={SPOT_CONFIG[spot.spot_type]?.color ?? '#888'} icon={SPOT_CONFIG[spot.spot_type]?.icon ?? 'location'} />
          </Marker>
        ))}
        {visibleEvents.map(evt => (
          <Marker
            key={evt.id}
            coordinate={{ latitude: evt.latitude, longitude: evt.longitude }}
            onPress={() => setSelectedEvent(evt)}
          >
            <PinMarker
              color={EVENT_CONFIG[evt.event_type]?.color ?? '#ff4500'}
              icon={EVENT_CONFIG[evt.event_type]?.icon ?? 'calendar'}
              isMultiGP={evt.event_source === 'multigp'}
            />
          </Marker>
        ))}
        {spotPin && (
          <Marker coordinate={spotPin}>
            <Ionicons name="add-circle" size={36} color="#ff4500" />
          </Marker>
        )}
        {evtPin && (
          <Marker coordinate={evtPin}>
            <Ionicons name="calendar" size={36} color="#FFD700" />
          </Marker>
        )}
      </MapView>

      {/* ── Pin-drop overlay ─────────────────────────────────────────────────── */}
      {(spotPinMode || evtPinMode) && (
        <View style={styles.pinDropOverlay} pointerEvents="box-none">
          <View style={styles.pinDropBanner}>
            <Ionicons name="location" size={18} color="#ff4500" />
            <Text style={styles.pinDropText}>
              {spotPinMode ? 'Tap the map to drop your FPV spot' : 'Tap the map to set event location'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.pinDropCancel}
            onPress={() => { setSpotPinMode(false); setEvtPinMode(false); }}
          >
            <Text style={styles.pinDropCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <SafeAreaView style={styles.headerSafe} pointerEvents="box-none">
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>FPV Map</Text>
            {loading && <ActivityIndicator size="small" color="#ff4500" style={{ marginLeft: 8 }} />}
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setActiveView(v => v === 'map' ? 'events' : 'map')}>
              <Ionicons name={activeView === 'map' ? 'list-outline' : 'map-outline'} size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowFilterPanel(true)}>
              <Ionicons name="options-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => {
              if (userLocation) mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 0.3, longitudeDelta: 0.3 }, 600);
            }}>
              <Ionicons name="locate-outline" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Legend chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legendRow}>
          {Object.entries(SPOT_CONFIG).map(([key, cfg]) => (
            <TouchableOpacity
              key={key}
              style={[styles.legendChip, !spotTypeFilters.includes(key) && styles.legendChipOff]}
              onPress={() => toggleSpotType(key)}
            >
              <View style={[styles.legendDot, { backgroundColor: cfg.color }]} />
              <Text style={styles.legendLabel}>{cfg.label}</Text>
            </TouchableOpacity>
          ))}
          {Object.entries(EVENT_CONFIG).map(([key, cfg]) => (
            <TouchableOpacity
              key={key}
              style={[styles.legendChip, !eventTypeFilters.includes(key) && styles.legendChipOff]}
              onPress={() => toggleEventType(key)}
            >
              <View style={[styles.legendDot, { backgroundColor: cfg.color }]} />
              <Text style={styles.legendLabel}>{cfg.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>

      {/* ── Events list view ─────────────────────────────────────────────────── */}
      {activeView === 'events' && (
        <View style={styles.eventsPanel}>
          <Text style={styles.eventsPanelTitle}>
            Upcoming Events · {radiusMiles}mi · {visibleEvents.length} found
          </Text>
          <FlatList
            data={visibleEvents}
            keyExtractor={e => e.id}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="calendar-outline" size={44} color="#333" />
                <Text style={styles.emptyText}>No events in this area</Text>
                <Text style={styles.emptySub}>Tap the calendar FAB to post one!</Text>
              </View>
            }
            renderItem={({ item: evt }) => {
              const cfg = EVENT_CONFIG[evt.event_type];
              return (
                <TouchableOpacity style={styles.eventRow} onPress={() => setSelectedEvent(evt)}>
                  <View style={[styles.eventTypeBar, { backgroundColor: cfg.color }]} />
                  <View style={styles.eventRowBody}>
                    <View style={styles.eventRowTop}>
                      <Text style={styles.eventRowName} numberOfLines={1}>{evt.name}</Text>
                      {evt.event_source === 'multigp' && (
                        <View style={styles.multigpBadge}><Text style={styles.multigpText}>MultiGP</Text></View>
                      )}
                    </View>
                    <Text style={styles.eventRowDate}>{formatDate(evt.start_time)}</Text>
                    <Text style={styles.eventRowLoc} numberOfLines={1}>
                      📍 {[evt.venue_name, evt.city, evt.state].filter(Boolean).join(', ') || 'Location TBD'}
                    </Text>
                    <View style={styles.eventRowFooter}>
                      <Text style={[styles.eventTypePill, { color: cfg.color }]}>{cfg.label}</Text>
                      <Text style={styles.eventRowRsvp}>👥 {evt.rsvp_count}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* ── FABs ─────────────────────────────────────────────────────────────── */}
      {!spotPinMode && !evtPinMode && (
        <View style={styles.fabGroup}>
          <TouchableOpacity style={[styles.fab, styles.fabEvent]} onPress={() => { setEvtPinMode(true); setActiveView('map'); }}>
            <Ionicons name="calendar-outline" size={18} color="#fff" />
            <Text style={styles.fabLabel}>Event</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={() => { setSpotPinMode(true); setActiveView('map'); }}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.fabLabel}>Spot</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ══ Filter Panel ════════════════════════════════════════════════════ */}
      <Modal visible={showFilterPanel} transparent animationType="slide" onRequestClose={() => setShowFilterPanel(false)}>
        <View style={styles.modalWrap}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowFilterPanel(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Map Filters</Text>

            <Text style={styles.sheetSection}>Search Radius</Text>
            <View style={styles.radiusRow}>
              {RADIUS_OPTIONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.radiusBtn, radiusMiles === r && styles.radiusBtnActive]}
                  onPress={() => setRadiusMiles(r)}
                >
                  <Text style={[styles.radiusBtnText, radiusMiles === r && { color: '#fff' }]}>{r} mi</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.toggleRow}>
              <View>
                <Text style={styles.toggleLabel}>Show FPV Spots</Text>
                <Text style={styles.toggleCount}>{spots.length} in range</Text>
              </View>
              <Switch value={showSpots} onValueChange={setShowSpots} trackColor={{ false: '#333', true: '#ff4500' }} thumbColor="#fff" />
            </View>
            {showSpots && (
              <View style={styles.chipWrap}>
                {ALL_SPOT_TYPES.map(t => {
                  const cfg = SPOT_CONFIG[t];
                  const on  = spotTypeFilters.includes(t);
                  return (
                    <TouchableOpacity key={t} style={[styles.chip, on ? { backgroundColor: cfg.color } : styles.chipOff]} onPress={() => toggleSpotType(t)}>
                      <Text style={[styles.chipText, !on && styles.chipTextOff]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={styles.toggleRow}>
              <View>
                <Text style={styles.toggleLabel}>Show Race Events</Text>
                <Text style={styles.toggleCount}>{events.length} upcoming</Text>
              </View>
              <Switch value={showEvents} onValueChange={setShowEvents} trackColor={{ false: '#333', true: '#ff4500' }} thumbColor="#fff" />
            </View>
            {showEvents && (
              <View style={styles.chipWrap}>
                {ALL_EVENT_TYPES.map(t => {
                  const cfg = EVENT_CONFIG[t];
                  const on  = eventTypeFilters.includes(t);
                  return (
                    <TouchableOpacity key={t} style={[styles.chip, on ? { backgroundColor: cfg.color } : styles.chipOff]} onPress={() => toggleEventType(t)}>
                      <Text style={[styles.chipText, !on && styles.chipTextOff]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <TouchableOpacity style={styles.applyBtn} onPress={() => { setShowFilterPanel(false); refreshData(); }}>
              <Text style={styles.applyBtnText}>Apply & Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ══ Add Spot Modal ═══════════════════════════════════════════════════ */}
      <Modal visible={showAddSpot} transparent animationType="slide" onRequestClose={() => setShowAddSpot(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowAddSpot(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>📍 Add FPV Spot</Text>
            {spotPin && (
              <Text style={styles.coordText}>
                {spotPin.latitude.toFixed(5)},  {spotPin.longitude.toFixed(5)}
              </Text>
            )}
            <TextInput
              style={styles.input} placeholder="Spot name *" placeholderTextColor="#555"
              value={spotName} onChangeText={setSpotName}
            />
            <TextInput
              style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
              placeholder="Description (optional)" placeholderTextColor="#555"
              value={spotDesc} onChangeText={setSpotDesc} multiline numberOfLines={3}
            />
            <Text style={styles.fieldLabel}>Spot Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipWrap}>
                {ALL_SPOT_TYPES.map(t => {
                  const cfg = SPOT_CONFIG[t];
                  return (
                    <TouchableOpacity key={t} style={[styles.chip, spotType === t ? { backgroundColor: cfg.color } : styles.chipOff]} onPress={() => setSpotType(t as FlySpot['spot_type'])}>
                      <Text style={[styles.chipText, spotType !== t && styles.chipTextOff]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
            <Text style={styles.fieldLabel}>Hazard Level</Text>
            <View style={styles.chipWrap}>
              {(['low','medium','high'] as const).map(h => {
                const col = h === 'low' ? '#00C853' : h === 'medium' ? '#FFD600' : '#FF1744';
                return (
                  <TouchableOpacity key={h} style={[styles.chip, spotHazard === h ? { backgroundColor: col } : styles.chipOff]} onPress={() => setSpotHazard(h)}>
                    <Text style={[styles.chipText, spotHazard !== h && styles.chipTextOff]}>{h.charAt(0).toUpperCase() + h.slice(1)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={[styles.applyBtn, submitting && { opacity: 0.5 }]} onPress={handleSubmitSpot} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyBtnText}>Save Spot</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══ Add Event Modal ══════════════════════════════════════════════════ */}
      <Modal visible={showAddEvent} transparent animationType="slide" onRequestClose={() => setShowAddEvent(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowAddEvent(false)} />
          <ScrollView style={[styles.sheet, { maxHeight: '85%' }]} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>📅 Publish Race Event</Text>
            {evtPin && (
              <Text style={styles.coordText}>📍 {evtPin.latitude.toFixed(5)}, {evtPin.longitude.toFixed(5)}</Text>
            )}
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
            <Text style={styles.fieldLabel}>Event Type</Text>
            <View style={styles.chipWrap}>
              {ALL_EVENT_TYPES.map(t => {
                const cfg = EVENT_CONFIG[t];
                return (
                  <TouchableOpacity key={t} style={[styles.chip, evtType === t ? { backgroundColor: cfg.color } : styles.chipOff]} onPress={() => setEvtType(t as RaceEvent['event_type'])}>
                    <Text style={[styles.chipText, evtType !== t && styles.chipTextOff]}>{cfg.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={[styles.applyBtn, submitting && { opacity: 0.5 }, { marginBottom: 32 }]} onPress={handleSubmitEvent} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyBtnText}>Publish Event</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══ Spot Detail Modal ════════════════════════════════════════════════ */}
      <Modal visible={!!selectedSpot} transparent animationType="slide" onRequestClose={() => setSelectedSpot(null)}>
        <View style={styles.modalWrap}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelectedSpot(null)} />
          <View style={[styles.sheet, { maxHeight: '85%' }]}>
            <View style={styles.sheetHandle} />
            {selectedSpot && (
              <>
                {/* Spot header */}
                <View style={styles.detailHeader}>
                  <View style={[styles.detailTypeBadge, { backgroundColor: SPOT_CONFIG[selectedSpot.spot_type]?.color ?? '#888' }]}>
                    <Text style={styles.detailTypeTxt}>{SPOT_CONFIG[selectedSpot.spot_type]?.label}</Text>
                  </View>
                  <View style={[styles.hazardBadge, {
                    backgroundColor: selectedSpot.hazard_level === 'low' ? '#00C853' : selectedSpot.hazard_level === 'medium' ? '#FFD600' : '#FF1744',
                  }]}>
                    <Text style={styles.hazardText}>⚠ {selectedSpot.hazard_level}</Text>
                  </View>
                </View>
                <Text style={styles.detailName}>{selectedSpot.name}</Text>
                {selectedSpot.creator_username && (
                  <Text style={styles.detailMeta}>Added by @{selectedSpot.creator_username}</Text>
                )}
                {selectedSpot.description ? (
                  <Text style={styles.detailDesc}>{selectedSpot.description}</Text>
                ) : null}

                {/* Votes */}
                <View style={styles.voteRow}>
                  <TouchableOpacity
                    style={[styles.voteBtn, currentVote === 1 && styles.voteBtnActive]}
                    onPress={() => handleVote(1)}
                  >
                    <Ionicons name="thumbs-up" size={18} color={currentVote === 1 ? '#fff' : '#00C853'} />
                    <Text style={[styles.voteCount, currentVote === 1 && { color: '#fff' }]}>{selectedSpot.thumbs_up}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.voteBtn, styles.voteBtnDown, currentVote === -1 && styles.voteBtnDownActive]}
                    onPress={() => handleVote(-1)}
                  >
                    <Ionicons name="thumbs-down" size={18} color={currentVote === -1 ? '#fff' : '#FF1744'} />
                    <Text style={[styles.voteCount, currentVote === -1 && { color: '#fff' }]}>{selectedSpot.thumbs_down}</Text>
                  </TouchableOpacity>
                </View>

                {/* Comments */}
                <Text style={styles.commentsHeader}>
                  Comments ({comments.length})
                </Text>
                <FlatList
                  data={comments}
                  keyExtractor={c => c.id}
                  style={{ maxHeight: 180 }}
                  ListEmptyComponent={<Text style={styles.noComments}>No comments yet. Be first!</Text>}
                  renderItem={({ item: c }) => (
                    <View style={styles.commentItem}>
                      <View style={styles.commentAvatar}>
                        <Ionicons name="person" size={14} color="#888" />
                      </View>
                      <View style={styles.commentBody}>
                        <Text style={styles.commentUser}>
                          {c.is_anonymous ? '👤 Anonymous Pilot' : (c.username ?? 'Pilot')}
                        </Text>
                        <Text style={styles.commentText}>{c.content}</Text>
                      </View>
                    </View>
                  )}
                />

                {/* Add comment */}
                <View style={styles.commentInputRow}>
                  <TextInput
                    style={styles.commentInput}
                    placeholder="Add a comment..."
                    placeholderTextColor="#555"
                    value={commentText}
                    onChangeText={setCommentText}
                  />
                  <TouchableOpacity style={styles.commentSendBtn} onPress={handlePostComment} disabled={postingComment}>
                    {postingComment
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="send" size={16} color="#fff" />}
                  </TouchableOpacity>
                </View>
                <View style={styles.anonRow}>
                  <Switch
                    value={isAnonymous}
                    onValueChange={setIsAnonymous}
                    trackColor={{ false: '#333', true: '#ff4500' }}
                    thumbColor="#fff"
                  />
                  <Text style={styles.anonLabel}>Post anonymously</Text>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ══ Event Detail Modal ═══════════════════════════════════════════════ */}
      <Modal visible={!!selectedEvent} transparent animationType="slide" onRequestClose={() => setSelectedEvent(null)}>
        <View style={styles.modalWrap}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelectedEvent(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {selectedEvent && (
              <>
                {selectedEvent.event_source === 'multigp' && (
                  <View style={styles.multigpBanner}>
                    <Text style={styles.multigpBannerText}>🏁 Official MultiGP Race</Text>
                  </View>
                )}
                <View style={[styles.detailTypeBadge, { backgroundColor: EVENT_CONFIG[selectedEvent.event_type]?.color ?? '#ff4500', alignSelf: 'flex-start', marginBottom: 6 }]}>
                  <Text style={styles.detailTypeTxt}>{EVENT_CONFIG[selectedEvent.event_type]?.label}</Text>
                </View>
                <Text style={styles.detailName}>{selectedEvent.name}</Text>
                <Text style={styles.detailMeta}>🗓 {formatDate(selectedEvent.start_time)}</Text>
                {selectedEvent.end_time && (
                  <Text style={styles.detailMeta}>🏁 Ends: {formatDate(selectedEvent.end_time)}</Text>
                )}
                <Text style={styles.detailMeta}>
                  📍 {[selectedEvent.venue_name, selectedEvent.city, selectedEvent.state].filter(Boolean).join(', ') || 'Location TBD'}
                </Text>
                {selectedEvent.max_participants && (
                  <Text style={styles.detailMeta}>👥 Max: {selectedEvent.max_participants} pilots</Text>
                )}
                {selectedEvent.organizer_username && (
                  <Text style={styles.detailMeta}>Organized by @{selectedEvent.organizer_username}</Text>
                )}
                {selectedEvent.description ? (
                  <Text style={styles.detailDesc}>{selectedEvent.description}</Text>
                ) : null}

                <View style={styles.eventDetailFooter}>
                  <View style={styles.rsvpCountWrap}>
                    <Text style={styles.rsvpCountNum}>{selectedEvent.rsvp_count}</Text>
                    <Text style={styles.rsvpCountLabel}>going</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, selectedEvent.user_rsvpd && styles.rsvpBtnActive]}
                    onPress={async () => {
                      await toggleRsvp(selectedEvent.id);
                      setSelectedEvent(prev => prev ? {
                        ...prev,
                        user_rsvpd: !prev.user_rsvpd,
                        rsvp_count: prev.user_rsvpd ? prev.rsvp_count - 1 : prev.rsvp_count + 1,
                      } : null);
                    }}
                  >
                    <Ionicons name={selectedEvent.user_rsvpd ? 'checkmark-circle' : 'add-circle-outline'} size={18} color="#fff" />
                    <Text style={styles.rsvpBtnText}>{selectedEvent.user_rsvpd ? "I'm Going ✓" : "RSVP"}</Text>
                  </TouchableOpacity>
                </View>

                {selectedEvent.registration_url ? (
                  <Text style={styles.regLink} numberOfLines={1}>🔗 {selectedEvent.registration_url}</Text>
                ) : null}
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
  container:    { flex: 1, backgroundColor: '#0a0a0a' },

  // Permission screen
  permScreen:   { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a', padding: 32 },
  permTitle:    { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  permDesc:     { color: '#888', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  permBtn:      { backgroundColor: '#ff4500', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24 },
  permBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Header
  headerSafe:   { position: 'absolute', top: 0, left: 0, right: 0 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
  headerLeft:   { flexDirection: 'row', alignItems: 'center' },
  headerTitle:  { color: '#fff', fontSize: 20, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 6 },
  headerRight:  { flexDirection: 'row', gap: 6 },
  iconBtn:      { backgroundColor: 'rgba(0,0,0,0.65)', padding: 8, borderRadius: 20, borderWidth: 1, borderColor: '#333' },

  // Legend chips
  legendRow:    { paddingHorizontal: 10, paddingVertical: 4, gap: 6 },
  legendChip:   { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#333', gap: 5 },
  legendChipOff:{ opacity: 0.35 },
  legendDot:    { width: 8, height: 8, borderRadius: 4 },
  legendLabel:  { color: '#ddd', fontSize: 11, fontWeight: '600' },

  // Pin drop overlay
  pinDropOverlay: { position: 'absolute', bottom: 110, left: 0, right: 0, alignItems: 'center' },
  pinDropBanner:  { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, gap: 8, borderWidth: 1, borderColor: '#ff4500' },
  pinDropText:    { color: '#fff', fontWeight: '600', fontSize: 13 },
  pinDropCancel:  { marginTop: 8, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16 },
  pinDropCancelText: { color: '#ff4500', fontWeight: '700' },

  // Events panel
  eventsPanel:      { position: 'absolute', top: 120, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,10,0.96)' },
  eventsPanelTitle: { color: '#aaa', fontSize: 12, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  eventRow:         { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  eventTypeBar:     { width: 4 },
  eventRowBody:     { flex: 1, padding: 12 },
  eventRowTop:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  eventRowName:     { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
  eventRowDate:     { color: '#aaa', fontSize: 12, marginBottom: 2 },
  eventRowLoc:      { color: '#777', fontSize: 12, marginBottom: 6 },
  eventRowFooter:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eventTypePill:    { fontSize: 11, fontWeight: '700' },
  eventRowRsvp:     { color: '#888', fontSize: 11 },
  multigpBadge:     { backgroundColor: '#FF6D00', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  multigpText:      { color: '#fff', fontSize: 10, fontWeight: '800' },

  // Empty state
  emptyWrap:  { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText:  { color: '#555', fontSize: 16, fontWeight: '600' },
  emptySub:   { color: '#444', fontSize: 13 },

  // FABs
  fabGroup:   { position: 'absolute', bottom: 28, right: 16, gap: 10 },
  fab:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ff4500', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, gap: 6, shadowColor: '#ff4500', shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  fabEvent:   { backgroundColor: '#1a4a6b' },
  fabLabel:   { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Modal base
  modalWrap:  { flex: 1, justifyContent: 'flex-end' },
  backdrop:   { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet:      { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  sheetHandle:{ width: 40, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 16 },
  sheetSection:{ color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },

  // Radius
  radiusRow:  { flexDirection: 'row', gap: 8, marginBottom: 16 },
  radiusBtn:  { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1a1a1a', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  radiusBtnActive: { backgroundColor: '#ff4500', borderColor: '#ff4500' },
  radiusBtnText:   { color: '#888', fontWeight: '600', fontSize: 12 },

  // Toggle
  toggleRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  toggleLabel:{ color: '#ddd', fontWeight: '600', fontSize: 14 },
  toggleCount:{ color: '#666', fontSize: 12, marginTop: 2 },

  // Chips
  chipWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  chipOff:    { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  chipText:   { color: '#fff', fontWeight: '600', fontSize: 12 },
  chipTextOff:{ color: '#666' },

  // Apply button
  applyBtn:     { backgroundColor: '#ff4500', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  applyBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // Form inputs
  input:        { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 10 },
  fieldLabel:   { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6, marginTop: 4 },
  coordText:    { color: '#666', fontSize: 11, marginBottom: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Detail modal
  detailHeader:   { flexDirection: 'row', gap: 8, marginBottom: 8 },
  detailTypeBadge:{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  detailTypeTxt:  { color: '#fff', fontWeight: '700', fontSize: 12 },
  hazardBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  hazardText:     { color: '#fff', fontWeight: '600', fontSize: 12 },
  detailName:     { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  detailMeta:     { color: '#888', fontSize: 13, marginBottom: 3 },
  detailDesc:     { color: '#bbb', fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 4 },

  // Votes
  voteRow:       { flexDirection: 'row', gap: 12, marginVertical: 14 },
  voteBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#00C853' },
  voteBtnActive: { backgroundColor: '#00C853' },
  voteBtnDown:   { borderColor: '#FF1744' },
  voteBtnDownActive: { backgroundColor: '#FF1744' },
  voteCount:     { color: '#00C853', fontWeight: '700', fontSize: 14 },

  // Comments
  commentsHeader: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  noComments:     { color: '#444', fontSize: 13, textAlign: 'center', paddingVertical: 12 },
  commentItem:    { flexDirection: 'row', gap: 8, marginBottom: 10 },
  commentAvatar:  { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  commentBody:    { flex: 1 },
  commentUser:    { color: '#aaa', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  commentText:    { color: '#ddd', fontSize: 13, lineHeight: 18 },
  commentInputRow:{ flexDirection: 'row', gap: 8, marginTop: 10 },
  commentInput:   { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 13, borderWidth: 1, borderColor: '#2a2a2a' },
  commentSendBtn: { backgroundColor: '#ff4500', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  anonRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  anonLabel:      { color: '#666', fontSize: 12 },

  // Event detail
  multigpBanner:      { backgroundColor: 'rgba(255,109,0,0.15)', borderWidth: 1, borderColor: '#FF6D00', borderRadius: 8, padding: 8, marginBottom: 10, alignItems: 'center' },
  multigpBannerText:  { color: '#FF6D00', fontWeight: '700', fontSize: 13 },
  eventDetailFooter:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  rsvpCountWrap:      { alignItems: 'center' },
  rsvpCountNum:       { color: '#fff', fontSize: 24, fontWeight: '800' },
  rsvpCountLabel:     { color: '#666', fontSize: 12 },
  rsvpBtn:            { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a4a6b', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24 },
  rsvpBtnActive:      { backgroundColor: '#00C853' },
  rsvpBtnText:        { color: '#fff', fontWeight: '700', fontSize: 14 },
  regLink:            { color: '#4a6fa5', fontSize: 12, marginTop: 10 },
});
