// app/listing/[id].tsx
// Phase 1 completion — full listing detail screen
// • Swipeable image gallery + pinch-zoom via ImageZoomModal
// • Seller card with avg_rating, verification tier, total_sales
// • Full description, condition notes, shipping & LiPo details
// • Watch button (heart)
// • "Contact Seller" → inline message thread sheet
// • Order status banner (if an active order exists)
// • "Mark as Shipped" (seller) / "Confirm Receipt" (buyer) actions

import React, {
  useState, useRef, useCallback, useEffect,
} from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, FlatList, TextInput, KeyboardAvoidingView,
  ActivityIndicator, Platform, Dimensions, Animated,
  Modal, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth }           from '../../src/context/AuthContext';
import { useListingDetail }  from '../../src/hooks/useListingDetail';
import ImageZoomModal        from '../../src/components/ImageZoomModal';
import {
  CATEGORIES, CONDITIONS,
} from '../../src/hooks/useMarketplace';

const { width: W } = Dimensions.get('window');
const IMG_H        = W * 0.78;   // ~78 % wide = square-ish hero

// ─── Helpers ──────────────────────────────────────────────────────────────────
function conditionColor(c: string) {
  return CONDITIONS.find(x => x.value === c)?.color ?? '#888';
}
function conditionLabel(c: string) {
  return CONDITIONS.find(x => x.value === c)?.label ?? c;
}
function starStr(rating?: number | null) {
  if (!rating) return null;
  const full  = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ─── Shipping carrier logos (text labels) ────────────────────────────────────
const CARRIERS: Record<string, string> = {
  usps:  'USPS',
  ups:   'UPS',
  fedex: 'FedEx',
  dhl:   'DHL',
  other: 'Carrier',
};

// ─── Order status pill config ─────────────────────────────────────────────────
const ORDER_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  pending:   { label: 'Payment Pending',   color: '#f59e0b', icon: 'time-outline' },
  paid:      { label: 'Paid — Awaiting Shipment', color: '#3b82f6', icon: 'card-outline' },
  shipped:   { label: 'Shipped',           color: '#8b5cf6', icon: 'airplane-outline' },
  delivered: { label: 'Delivered — Confirm?', color: '#10b981', icon: 'checkmark-circle-outline' },
  completed: { label: 'Completed ✓',       color: '#10b981', icon: 'checkmark-done-outline' },
  cancelled: { label: 'Cancelled',         color: '#ef4444', icon: 'close-circle-outline' },
  disputed:  { label: 'Dispute Open',      color: '#ef4444', icon: 'warning-outline' },
};

// ─── Ship modal ───────────────────────────────────────────────────────────────
function ShipModal({
  visible, onClose, onSubmit, loading,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (tracking: string, carrier: string) => void;
  loading: boolean;
}) {
  const [tracking, setTracking] = useState('');
  const [carrier,  setCarrier]  = useState('usps');
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.shipOverlay}
      >
        <View style={styles.shipSheet}>
          <Text style={styles.shipTitle}>Mark as Shipped</Text>
          <Text style={styles.shipLabel}>Carrier</Text>
          <View style={styles.carrierRow}>
            {Object.entries(CARRIERS).map(([k, v]) => (
              <TouchableOpacity
                key={k}
                style={[styles.carrierChip, carrier === k && styles.carrierChipOn]}
                onPress={() => setCarrier(k)}
              >
                <Text style={[styles.carrierTxt, carrier === k && styles.carrierTxtOn]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.shipLabel}>Tracking Number</Text>
          <TextInput
            style={styles.trackingInput}
            value={tracking}
            onChangeText={setTracking}
            placeholder="e.g. 9400111899223485226790"
            placeholderTextColor="#555"
            autoCapitalize="characters"
          />
          <View style={styles.shipBtnRow}>
            <TouchableOpacity style={styles.shipCancel} onPress={onClose}>
              <Text style={{ color: '#888' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shipConfirm, (!tracking.trim() || loading) && { opacity: 0.4 }]}
              onPress={() => tracking.trim() && onSubmit(tracking.trim(), carrier)}
              disabled={!tracking.trim() || loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ color: '#fff', fontWeight: '700' }}>Confirm Shipped</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Message thread sheet ─────────────────────────────────────────────────────
function MessageSheet({
  visible, onClose,
  messages, sending,
  onSend, currentUserId,
}: {
  visible: boolean;
  onClose: () => void;
  messages: import('../../src/hooks/useListingDetail').ListingMessage[];
  sending: boolean;
  onSend: (body: string) => void;
  currentUserId: string;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible && messages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 120);
    }
  }, [visible, messages.length]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.msgOverlay}
      >
        <View style={styles.msgSheet}>
          {/* header */}
          <View style={styles.msgHeader}>
            <Text style={styles.msgTitle}>Messages</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color="#aaa" />
            </TouchableOpacity>
          </View>

          {/* thread */}
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: 12, gap: 8 }}
            ListEmptyComponent={
              <Text style={styles.msgEmpty}>
                No messages yet.{'\n'}Say hello to the seller!
              </Text>
            }
            renderItem={({ item }) => {
              const isMine = item.sender_id === currentUserId;
              return (
                <View style={[styles.msgBubbleWrap, isMine && styles.msgBubbleWrapMe]}>
                  <View style={[styles.msgBubble, isMine ? styles.msgBubbleMe : styles.msgBubbleThem]}>
                    <Text style={styles.msgBody}>{item.body}</Text>
                  </View>
                  <Text style={styles.msgTime}>
                    {new Date(item.created_at).toLocaleTimeString(undefined, {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                </View>
              );
            }}
          />

          {/* composer */}
          <View style={styles.msgComposer}>
            <TextInput
              style={styles.msgInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="Message…"
              placeholderTextColor="#555"
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[styles.msgSend, (!draft.trim() || sending) && { opacity: 0.4 }]}
              onPress={() => {
                if (!draft.trim() || sending) return;
                onSend(draft.trim());
                setDraft('');
              }}
              disabled={!draft.trim() || sending}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="send" size={18} color="#fff" />
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function ListingDetailScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const { user } = useAuth();

  const {
    listing, loading, fetchListing,
    isWatched, toggleWatch,
    messages, messagesLoad, sendMessage, sending,
    activeOrder, fetchOrder,
    markShipped, confirmReceipt,
  } = useListingDetail(id ?? '', user?.id);

  // ── Gallery state ─────────────────────────────────────────────────────────
  const [activeImg,   setActiveImg]   = useState(0);
  const [zoomUri,     setZoomUri]     = useState<string | null>(null);
  const [showZoom,    setShowZoom]    = useState(false);

  // ── Sheet state ───────────────────────────────────────────────────────────
  const [showMsg,     setShowMsg]     = useState(false);
  const [showShip,    setShowShip]    = useState(false);
  const [shipLoading, setShipLoading] = useState(false);
  const [receiptLoad, setReceiptLoad] = useState(false);

  const isOwner  = user?.id === listing?.seller_id;
  const isBuyer  = activeOrder?.buyer_id === user?.id;

  const images   = listing?.listing_images ?? [];
  const primaryUri = images[activeImg]?.url ?? images[0]?.url ?? null;
  const cat      = CATEGORIES.find(c => c.slug === listing?.category);

  // ── Navigate to seller's public profile ──────────────────────────────────
  const goSeller = useCallback(() => {
    if (listing?.seller_id) {
      router.push({ pathname: '/user/[id]', params: { id: listing.seller_id } });
    }
  }, [listing?.seller_id, router]);

  // ── Mark shipped ──────────────────────────────────────────────────────────
  const handleShipped = useCallback(async (tracking: string, carrier: string) => {
    if (!activeOrder) return;
    setShipLoading(true);
    const res = await markShipped(activeOrder.id, tracking, carrier);
    setShipLoading(false);
    setShowShip(false);
    if (res?.ok) {
      Alert.alert('📦 Shipped!', `Tracking: ${tracking}\nBuyer has been notified.`);
    } else {
      Alert.alert('Error', res?.error ?? 'Could not update order.');
    }
  }, [activeOrder, markShipped]);

  // ── Confirm receipt ───────────────────────────────────────────────────────
  const handleConfirmReceipt = useCallback(() => {
    Alert.alert(
      'Confirm Receipt',
      'Confirming receipt releases payment to the seller. Only do this once you have the item in hand.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, I got it',
          style: 'default',
          onPress: async () => {
            if (!activeOrder) return;
            setReceiptLoad(true);
            const res = await confirmReceipt(activeOrder.id);
            setReceiptLoad(false);
            if (res?.ok) {
              Alert.alert('✅ Receipt confirmed!', 'Payment has been released to the seller.');
            } else {
              Alert.alert('Error', res?.error ?? 'Something went wrong.');
            }
          },
        },
      ],
    );
  }, [activeOrder, confirmReceipt]);

  // ── Loading / not found ───────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#ff4500" />
      </View>
    );
  }
  if (!listing) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#444" />
        <Text style={styles.notFound}>Listing not found or removed.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnTxt}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const orderStatus = activeOrder ? ORDER_STATUS[activeOrder.status] : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* ── Nav bar ── */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{listing.title}</Text>
        <TouchableOpacity onPress={toggleWatch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons
            name={isWatched ? 'heart' : 'heart-outline'}
            size={24}
            color={isWatched ? '#ff4500' : '#aaa'}
          />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>

        {/* ── Image gallery ── */}
        <View style={styles.galleryWrap}>
          {images.length > 0 ? (
            <>
              <FlatList
                data={images}
                keyExtractor={img => img.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={e => {
                  setActiveImg(Math.round(e.nativeEvent.contentOffset.x / W));
                }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    activeOpacity={0.92}
                    onPress={() => { setZoomUri(item.url); setShowZoom(true); }}
                    style={{ width: W }}
                  >
                    <Image
                      source={{ uri: item.url }}
                      style={styles.heroImg}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                )}
              />
              {/* Dot indicators */}
              {images.length > 1 && (
                <View style={styles.dotRow}>
                  {images.map((_, i) => (
                    <View
                      key={i}
                      style={[styles.dot, i === activeImg && styles.dotActive]}
                    />
                  ))}
                </View>
              )}
              {/* Tap-to-zoom hint */}
              <View style={styles.zoomHint}>
                <Ionicons name="expand-outline" size={12} color="#ffffffaa" />
                <Text style={styles.zoomHintTxt}>Tap to zoom</Text>
              </View>
            </>
          ) : (
            <View style={[styles.heroImg, styles.heroPlaceholder]}>
              <Ionicons name="image-outline" size={56} color="#333" />
            </View>
          )}
        </View>

        <View style={styles.body}>

          {/* ── Order status banner ── */}
          {orderStatus && (
            <View style={[styles.orderBanner, { borderColor: orderStatus.color + '55', backgroundColor: orderStatus.color + '15' }]}>
              <Ionicons name={orderStatus.icon as any} size={18} color={orderStatus.color} />
              <Text style={[styles.orderBannerTxt, { color: orderStatus.color }]}>{orderStatus.label}</Text>
              {activeOrder?.tracking_number && (
                <Text style={styles.trackingTxt}>
                  {CARRIERS[activeOrder.carrier ?? ''] ?? activeOrder.carrier ?? 'Carrier'}: {activeOrder.tracking_number}
                </Text>
              )}
            </View>
          )}

          {/* ── Title + price ── */}
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{listing.title}</Text>
              {cat && (
                <Text style={styles.catLabel}>{cat.icon} {cat.label}</Text>
              )}
            </View>
            <View style={styles.priceBlock}>
              <Text style={styles.price}>${listing.price.toFixed(2)}</Text>
              {listing.listing_type === 'offer' && (
                <Text style={styles.offerTag}>Best Offer</Text>
              )}
            </View>
          </View>

          {/* ── Badges row ── */}
          <View style={styles.badgeRow}>
            <View style={[styles.condBadge, { borderColor: conditionColor(listing.condition) }]}>
              <Text style={[styles.condBadgeTxt, { color: conditionColor(listing.condition) }]}>
                {conditionLabel(listing.condition)}
              </Text>
            </View>
            {listing.free_shipping && (
              <View style={styles.freeBadge}>
                <Ionicons name="cube-outline" size={11} color="#22c55e" />
                <Text style={styles.freeBadgeTxt}>Free shipping</Text>
              </View>
            )}
            {listing.lipo_hazmat && (
              <View style={styles.lipoBadge}>
                <Text style={styles.lipoBadgeTxt}>⚠️ LiPo</Text>
              </View>
            )}
            {listing.listing_type === 'auction' && (
              <View style={styles.auctionBadge}>
                <Text style={styles.auctionBadgeTxt}>AUCTION</Text>
              </View>
            )}
          </View>

          {/* ── Seller card ── */}
          <TouchableOpacity style={styles.sellerCard} onPress={goSeller} activeOpacity={0.8}>
            {listing.seller?.avatar_url ? (
              <Image source={{ uri: listing.seller.avatar_url }} style={styles.sellerAvatar} />
            ) : (
              <View style={[styles.sellerAvatar, styles.sellerAvatarPh]}>
                <Ionicons name="person" size={20} color="#555" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={styles.sellerNameRow}>
                {(listing.seller?.verification_tier ?? 0) >= 2 && (
                  <Text style={styles.verifiedBadge}>✅ </Text>
                )}
                <Text style={styles.sellerName}>
                  @{listing.seller?.username ?? 'unknown'}
                </Text>
              </View>
              <View style={styles.sellerMeta}>
                {listing.seller?.avg_rating != null && (
                  <Text style={styles.sellerRating}>
                    {starStr(listing.seller.avg_rating)} {listing.seller.avg_rating.toFixed(1)}
                  </Text>
                )}
                {listing.seller?.total_sales != null && listing.seller.total_sales > 0 && (
                  <Text style={styles.sellerSales}>
                    · {listing.seller.total_sales} sale{listing.seller.total_sales !== 1 ? 's' : ''}
                  </Text>
                )}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#555" />
          </TouchableOpacity>

          {/* ── Description ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{listing.description}</Text>
            {listing.condition_notes ? (
              <View style={styles.condNotes}>
                <Ionicons name="information-circle-outline" size={14} color="#888" />
                <Text style={styles.condNotesTxt}>{listing.condition_notes}</Text>
              </View>
            ) : null}
          </View>

          {/* ── Shipping details ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Shipping</Text>
            <View style={styles.shippingRow}>
              <Ionicons name="location-outline" size={15} color="#888" />
              <Text style={styles.shippingTxt}>
                Ships from: {listing.ships_from_state ?? 'Not specified'}
              </Text>
            </View>
            <View style={styles.shippingRow}>
              <Ionicons name="cube-outline" size={15} color="#888" />
              <Text style={styles.shippingTxt}>
                {listing.free_shipping
                  ? 'Free shipping included'
                  : listing.shipping_cost
                    ? `Buyer pays $${listing.shipping_cost.toFixed(2)}`
                    : 'Shipping cost: TBD'
                }
              </Text>
            </View>
            {listing.lipo_hazmat && (
              <View style={styles.lipoWarning}>
                <Text style={styles.lipoWarningIcon}>⚠️</Text>
                <Text style={styles.lipoWarningTxt}>
                  LiPo battery — ground shipping only (USPS, UPS, FedEx Ground).
                  No air transport. Buyer acknowledges hazmat regulations.
                </Text>
              </View>
            )}
          </View>

          {/* ── Listing metadata ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details</Text>
            <View style={styles.metaGrid}>
              <MetaRow icon="calendar-outline" label="Listed" value={fmtDate(listing.created_at)} />
              <MetaRow icon="eye-outline" label="Views" value={`${listing.view_count ?? 0}`} />
              {listing.listing_type === 'auction' && listing.auction_end && (
                <MetaRow icon="timer-outline" label="Ends" value={fmtDate(listing.auction_end)} />
              )}
              {listing.listing_type === 'auction' && (
                <MetaRow icon="hammer-outline" label="Bids" value={`${listing.bid_count ?? 0}`} />
              )}
            </View>
          </View>

          {/* ── Trust reminder ── */}
          <View style={styles.trustReminder}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#3b82f6" />
            <Text style={styles.trustReminderTxt}>
              Payment is held in escrow and only released after you confirm delivery. Never pay outside the app.
            </Text>
          </View>

          {/* spacer so CTA bar doesn't overlap last content */}
          <View style={{ height: 100 }} />
        </View>
      </ScrollView>

      {/* ── CTA bar ── */}
      {!isOwner && listing.status === 'active' && (
        <View style={styles.ctaBar}>
          <TouchableOpacity
            style={styles.ctaMsgBtn}
            onPress={() => setShowMsg(true)}
          >
            <Ionicons name="chatbubble-outline" size={18} color="#fff" />
            <Text style={styles.ctaBtnTxt}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ctaBuyBtn}
            onPress={() =>
              Alert.alert(
                'Buy Now',
                `Pay $${listing.price.toFixed(2)} for "${listing.title}"?\n\nStripe checkout coming in Phase 2.`,
              )
            }
          >
            <Ionicons name="card-outline" size={18} color="#fff" />
            <Text style={styles.ctaBtnTxt}>
              {listing.listing_type === 'offer' ? 'Make Offer' : `Buy · $${listing.price.toFixed(2)}`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Seller action bar ── */}
      {isOwner && activeOrder?.status === 'paid' && (
        <View style={styles.ctaBar}>
          <TouchableOpacity
            style={[styles.ctaBuyBtn, { flex: 1 }]}
            onPress={() => setShowShip(true)}
          >
            <Ionicons name="airplane-outline" size={18} color="#fff" />
            <Text style={styles.ctaBtnTxt}>Mark as Shipped</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Buyer confirm bar ── */}
      {isBuyer && activeOrder?.status === 'shipped' && (
        <View style={styles.ctaBar}>
          <TouchableOpacity
            style={[styles.ctaBuyBtn, { flex: 1, backgroundColor: '#10b981' }]}
            onPress={handleConfirmReceipt}
            disabled={receiptLoad}
          >
            {receiptLoad
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.ctaBtnTxt}>Confirm Receipt</Text>
                </>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* ── Modals ── */}
      <ImageZoomModal
        visible={showZoom}
        uri={zoomUri}
        onClose={() => setShowZoom(false)}
      />

      <MessageSheet
        visible={showMsg}
        onClose={() => setShowMsg(false)}
        messages={messages}
        sending={sending}
        currentUserId={user?.id ?? ''}
        onSend={body => {
          if (!listing.seller_id) return;
          sendMessage(body, listing.seller_id);
        }}
      />

      <ShipModal
        visible={showShip}
        onClose={() => setShowShip(false)}
        onSubmit={handleShipped}
        loading={shipLoading}
      />
    </View>
  );
}

// ─── MetaRow helper ───────────────────────────────────────────────────────────
function MetaRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon as any} size={14} color="#666" />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:            { flex: 1, backgroundColor: '#0a0a0a' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a', gap: 14 },
  notFound:        { color: '#888', fontSize: 15 },
  backBtn:         { marginTop: 8 },
  backBtnTxt:      { color: '#ff4500', fontSize: 14 },

  // nav
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 54 : 16, paddingBottom: 10,
    paddingHorizontal: 16, backgroundColor: '#0a0a0a',
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  navTitle: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600', marginHorizontal: 10 },

  // gallery
  galleryWrap:    { position: 'relative' },
  heroImg:        { width: W, height: IMG_H },
  heroPlaceholder:{ backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  dotRow:         { flexDirection: 'row', justifyContent: 'center', gap: 5, position: 'absolute', bottom: 12, left: 0, right: 0 },
  dot:            { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff55' },
  dotActive:      { backgroundColor: '#fff', width: 18 },
  zoomHint:       { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  zoomHintTxt:    { color: '#ffffffaa', fontSize: 10 },

  // body
  body:           { paddingHorizontal: 16, paddingTop: 16 },

  // order banner
  orderBanner:    { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 14, flexWrap: 'wrap' },
  orderBannerTxt: { fontWeight: '700', fontSize: 13, flex: 1 },
  trackingTxt:    { color: '#aaa', fontSize: 11, width: '100%', marginTop: 4 },

  // title
  titleRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  title:          { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 26 },
  catLabel:       { color: '#888', fontSize: 12, marginTop: 3 },
  priceBlock:     { alignItems: 'flex-end', minWidth: 90 },
  price:          { color: '#ff4500', fontSize: 22, fontWeight: '900' },
  offerTag:       { color: '#f59e0b', fontSize: 10, fontWeight: '700', marginTop: 2 },

  // badges
  badgeRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  condBadge:      { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  condBadgeTxt:   { fontSize: 11, fontWeight: '700' },
  freeBadge:      { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: '#22c55e44', backgroundColor: '#22c55e15', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  freeBadgeTxt:   { color: '#22c55e', fontSize: 11, fontWeight: '600' },
  lipoBadge:      { backgroundColor: '#7f1d1d44', borderWidth: 1, borderColor: '#ef444466', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  lipoBadgeTxt:   { color: '#fca5a5', fontSize: 11, fontWeight: '600' },
  auctionBadge:   { backgroundColor: '#9c27b044', borderWidth: 1, borderColor: '#9c27b0aa', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  auctionBadgeTxt:{ color: '#e879f9', fontSize: 11, fontWeight: '800' },

  // seller card
  sellerCard:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111', borderRadius: 12, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: '#1e2a3a' },
  sellerAvatar:   { width: 44, height: 44, borderRadius: 22 },
  sellerAvatarPh: { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  sellerNameRow:  { flexDirection: 'row', alignItems: 'center' },
  verifiedBadge:  { fontSize: 13 },
  sellerName:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  sellerMeta:     { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  sellerRating:   { color: '#f59e0b', fontSize: 12, fontWeight: '600' },
  sellerSales:    { color: '#888', fontSize: 12, marginLeft: 4 },

  // sections
  section:        { marginBottom: 20 },
  sectionTitle:   { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 8, letterSpacing: 0.3 },
  description:    { color: '#ccc', fontSize: 14, lineHeight: 21 },
  condNotes:      { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10, backgroundColor: '#1a2030', borderRadius: 8, padding: 10 },
  condNotesTxt:   { color: '#aaa', fontSize: 13, flex: 1, lineHeight: 19 },

  // shipping
  shippingRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  shippingTxt:    { color: '#aaa', fontSize: 13 },
  lipoWarning:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#7f1d1d22', borderRadius: 8, borderWidth: 1, borderColor: '#ef444433', padding: 10, marginTop: 8 },
  lipoWarningIcon:{ fontSize: 14, lineHeight: 20 },
  lipoWarningTxt: { color: '#fca5a5', fontSize: 12, flex: 1, lineHeight: 18 },

  // meta grid
  metaGrid:       { gap: 6 },
  metaRow:        { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaLabel:      { color: '#666', fontSize: 12, flex: 1 },
  metaValue:      { color: '#ccc', fontSize: 12, fontWeight: '600' },

  // trust reminder
  trustReminder:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#0f1a2e', borderRadius: 10, borderWidth: 1, borderColor: '#1e3a5f', padding: 12, marginBottom: 4 },
  trustReminderTxt:{ color: '#93c5fd', fontSize: 12, flex: 1, lineHeight: 18 },

  // CTA bar
  ctaBar:         { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12, paddingBottom: Platform.OS === 'ios' ? 30 : 14, backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  ctaMsgBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1e2030', borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: '#2a3040' },
  ctaBuyBtn:      { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#ff4500', borderRadius: 12, paddingVertical: 14 },
  ctaBtnTxt:      { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ship modal
  shipOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  shipSheet:      { backgroundColor: '#0f1520', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1.5, borderColor: '#3b82f6', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  shipTitle:      { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 16 },
  shipLabel:      { color: '#aaa', fontSize: 12, fontWeight: '600', marginBottom: 8, letterSpacing: 0.4 },
  carrierRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  carrierChip:    { borderWidth: 1, borderColor: '#2a3040', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  carrierChipOn:  { borderColor: '#3b82f6', backgroundColor: '#1e3a5f' },
  carrierTxt:     { color: '#666', fontSize: 13, fontWeight: '600' },
  carrierTxtOn:   { color: '#93c5fd' },
  trackingInput:  { backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a3040', borderRadius: 10, padding: 12, color: '#fff', fontSize: 13, marginBottom: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  shipBtnRow:     { flexDirection: 'row', gap: 10 },
  shipCancel:     { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 10, backgroundColor: '#1a1a1a' },
  shipConfirm:    { flex: 2, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 10, backgroundColor: '#3b82f6' },

  // message sheet
  msgOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  msgSheet:       { backgroundColor: '#0f1520', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1.5, borderColor: '#ff4500', height: '72%' },
  msgHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a2030' },
  msgTitle:       { color: '#fff', fontSize: 17, fontWeight: '700' },
  msgEmpty:       { color: '#445', textAlign: 'center', marginTop: 40, fontSize: 13, lineHeight: 20 },
  msgBubbleWrap:  { alignItems: 'flex-start', maxWidth: '82%' },
  msgBubbleWrapMe:{ alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgBubble:      { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  msgBubbleMe:    { backgroundColor: '#ff4500', borderBottomRightRadius: 4 },
  msgBubbleThem:  { backgroundColor: '#1e2030', borderBottomLeftRadius: 4 },
  msgBody:        { color: '#fff', fontSize: 14, lineHeight: 20 },
  msgTime:        { color: '#556', fontSize: 10, marginTop: 3, marginHorizontal: 4 },
  msgComposer:    { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1a2030' },
  msgInput:       { flex: 1, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a3040', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, color: '#fff', fontSize: 14, maxHeight: 100 },
  msgSend:        { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ff4500', alignItems: 'center', justifyContent: 'center' },
});
