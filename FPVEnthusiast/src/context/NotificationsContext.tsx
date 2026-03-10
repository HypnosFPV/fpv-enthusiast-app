// src/context/NotificationsContext.tsx
// Single shared instance of useNotifications so the badge and the
// notifications screen always reflect the same state.
import React, { createContext, useContext } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { useAuth } from './AuthContext';

type NotificationsContextValue = ReturnType<typeof useNotifications>;

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const value = useNotifications(user?.id);
  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotificationsContext must be inside NotificationsProvider');
  return ctx;
}
