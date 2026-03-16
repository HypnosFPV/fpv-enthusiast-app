// src/hooks/useOrders.ts
// Fetches the current user's order history:
//   purchases — orders where buyer_id = me
//   sales     — orders where seller_id = me
// Includes listing title/image, other party username, and full order state.

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';

export type OrderStatus =
  | 'pending' | 'paid' | 'shipped' | 'delivered'
  | 'completed' | 'cancelled' | 'disputed' | 'resolved';

export interface OrderSummary {
  id:                  string;
  listing_id:          string;
  listing_title:       string;
  listing_image:       string | null;
  listing_type:        string;
  amount_cents:        number;
  platform_fee_cents:  number;
  seller_payout_cents: number;
  status:              OrderStatus;
  tracking_number:     string | null;
  carrier:             string | null;
  stripe_payment_intent: string | null;
  // other party
  other_user_id:       string;
  other_username:      string;
  other_avatar:        string | null;
  // timestamps
  created_at:          string;
  paid_at:             string | null;
  shipped_at:          string | null;
  delivered_at:        string | null;
  auto_release_at:     string | null;
  // which side am I?
  role:                'buyer' | 'seller';
}

function normaliseOrder(raw: any, myId: string): OrderSummary {
  const isBuyer = raw.buyer_id === myId;
  const listing  = raw.marketplace_listings ?? {};
  const images   = listing.listing_images ?? [];
  const primary  = images.find((i: any) => i.is_primary) ?? images[0] ?? null;
  const other    = isBuyer ? raw.seller : raw.buyer;

  return {
    id:                  raw.id,
    listing_id:          raw.listing_id,
    listing_title:       listing.title ?? 'Unknown listing',
    listing_image:       primary?.url ?? null,
    listing_type:        listing.listing_type ?? 'fixed',
    amount_cents:        raw.amount_cents,
    platform_fee_cents:  raw.platform_fee_cents,
    seller_payout_cents: raw.seller_payout_cents,
    status:              raw.status as OrderStatus,
    tracking_number:     raw.tracking_number ?? null,
    carrier:             raw.carrier ?? null,
    stripe_payment_intent: raw.stripe_payment_intent ?? null,
    other_user_id:       other?.id ?? '',
    other_username:      other?.username ?? 'Unknown',
    other_avatar:        other?.avatar_url ?? null,
    created_at:          raw.created_at,
    paid_at:             raw.paid_at ?? null,
    shipped_at:          raw.shipped_at ?? null,
    delivered_at:        raw.delivered_at ?? null,
    auto_release_at:     raw.auto_release_at ?? null,
    role:                isBuyer ? 'buyer' : 'seller',
  };
}

const ORDER_QUERY = `
  id, listing_id, buyer_id, seller_id,
  amount_cents, platform_fee_cents, seller_payout_cents,
  status, tracking_number, carrier, stripe_payment_intent,
  created_at, paid_at, shipped_at, delivered_at, auto_release_at,
  marketplace_listings (
    title, listing_type,
    listing_images ( url, is_primary, position )
  ),
  buyer:users!marketplace_orders_buyer_id_fkey ( id, username, avatar_url ),
  seller:users!marketplace_orders_seller_id_fkey ( id, username, avatar_url )
`.trim();

export function useOrders(userId: string | undefined) {
  const [purchases,    setPurchases]    = useState<OrderSummary[]>([]);
  const [sales,        setSales]        = useState<OrderSummary[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [activeTab,    setActiveTab]    = useState<'purchases' | 'sales'>('purchases');

  const fetchOrders = useCallback(async (silent = false) => {
    if (!userId) return;
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [buyRes, sellRes] = await Promise.all([
        supabase
          .from('marketplace_orders')
          .select(ORDER_QUERY)
          .eq('buyer_id', userId)
          .not('status', 'eq', 'pending')   // hide unpaid intents
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('marketplace_orders')
          .select(ORDER_QUERY)
          .eq('seller_id', userId)
          .not('status', 'eq', 'pending')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (buyRes.data)  setPurchases((buyRes.data  as any[]).map(r => normaliseOrder(r, userId)));
      if (sellRes.data) setSales    ((sellRes.data as any[]).map(r => normaliseOrder(r, userId)));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const refresh = useCallback(() => fetchOrders(true), [fetchOrders]);

  return {
    purchases,
    sales,
    loading,
    refreshing,
    activeTab,
    setActiveTab,
    fetchOrders,
    refresh,
    allOrders: activeTab === 'purchases' ? purchases : sales,
  };
}
