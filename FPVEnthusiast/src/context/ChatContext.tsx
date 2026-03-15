// src/context/ChatContext.tsx
// Single shared useChat instance — provides unread badge + markRoomRead
// to both the tab bar AND the chat room screen so badge clears on open.
import React, { createContext, useContext } from 'react';
import { useAuth } from './AuthContext';
import { useChat } from '../hooks/useChat';

interface ChatContextValue {
  unreadCount:  number;
  markRoomRead: (roomId: string) => Promise<void>;
  fetchRooms:   () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue>({
  unreadCount:  0,
  markRoomRead: async () => {},
  fetchRooms:   async () => {},
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { totalUnread, markRoomRead, fetchRooms } = useChat(user?.id);

  return (
    <ChatContext.Provider value={{ unreadCount: totalUnread, markRoomRead, fetchRooms }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  return useContext(ChatContext);
}
