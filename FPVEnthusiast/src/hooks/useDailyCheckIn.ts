import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { useNotificationsContext } from '../context/NotificationsContext';

export function useDailyCheckIn() {
  const { user } = useAuth();
  const { fetchNotifications } = useNotificationsContext();
  const lastAttemptRef = useRef<string | null>(null);

  const awardDailyCheckIn = useCallback(async () => {
    if (!user?.id) {
      lastAttemptRef.current = null;
      return;
    }

    const utcDay = new Date().toISOString().slice(0, 10);
    const attemptKey = `${user.id}:${utcDay}`;

    if (lastAttemptRef.current === attemptKey) return;
    lastAttemptRef.current = attemptKey;

    const { data, error } = await supabase.rpc('award_daily_check_in', {
      p_user_id: user.id,
    });

    if (error) {
      console.warn('[useDailyCheckIn] award_daily_check_in:', error.message);
      lastAttemptRef.current = null;
      return;
    }

    if ((data as any)?.ok || (data as any)?.awarded) {
      void fetchNotifications();
    }
  }, [user?.id, fetchNotifications]);

  useEffect(() => {
    void awardDailyCheckIn();
  }, [awardDailyCheckIn]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void awardDailyCheckIn();
    });
    return () => sub.remove();
  }, [awardDailyCheckIn]);
}
