// src/context/ChatContext.tsx
// Provides chat unread count to the tab bar badge
import React, { createContext, useContext } from 'react';
import { useAuth } from './AuthContext';
import { useChat } from '../hooks/useChat';

interface ChatContextValue {
  unreadCount: number;
}

const ChatContext = createContext<ChatContextValue>({ unreadCount: 0 });

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { totalUnread } = useChat(user?.id);

  return (
    <ChatContext.Provider value={{ unreadCount: totalUnread }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  return useContext(ChatContext);
}
