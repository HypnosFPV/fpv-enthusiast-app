// src/utils/boostNotifications.ts
// Schedule a local push notification 2 hours before a featured listing expires.

import * as Notifications from 'expo-notifications';

/** Call this right after a successful spend_props_for_featured / paid boost. */
export async function scheduleBoostExpiryNotification(
  listingTitle: string,
  endsAt: string | Date,
): Promise<string | null> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return null;

    const endTime  = new Date(endsAt).getTime();
    const alertAt  = new Date(endTime - 2 * 60 * 60 * 1000); // 2 h before
    const now      = Date.now();

    if (alertAt.getTime() <= now) return null; // already within 2 h window

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚡ Featured listing expiring soon',
        body:  `"${listingTitle}" will leave the Featured carousel in 2 hours. Boost again to keep it pinned!`,
        data:  { type: 'boost_expiry', listingTitle },
        sound: true,
      },
      trigger: { type: 'date', date: alertAt } as any,
    });

    return id;
  } catch (e) {
    console.warn('[boostNotifications] scheduleBoostExpiryNotification error:', e);
    return null;
  }
}

/** Cancel a previously scheduled notification by its ID. */
export async function cancelBoostNotification(notificationId: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (_) {}
}
