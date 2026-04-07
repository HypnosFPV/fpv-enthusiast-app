// src/context/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

interface AuthResponse {
  data: { user: User | null; session: Session | null } | null;
  error: Error | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResponse>;
  signUp: (email: string, password: string) => Promise<AuthResponse>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({ data: null, error: null }),
  signUp: async () => ({ data: null, error: null }),
  signOut: async () => {},
});

function getProjectRefFromUrl() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const match = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

async function clearSupabaseAuthStorage() {
  const projectRef = getProjectRefFromUrl();
  const keys = await AsyncStorage.getAllKeys();
  const authKeys = keys.filter((key) => {
    const normalized = key.toLowerCase();
    const isSupabaseSessionKey =
      normalized.startsWith('sb-') ||
      normalized.includes('auth-token') ||
      normalized.includes('supabase.auth.token');
    const matchesProject = projectRef ? normalized.includes(projectRef.toLowerCase()) : false;
    return isSupabaseSessionKey || matchesProject;
  });

  if (authKeys.length > 0) {
    await AsyncStorage.multiRemove(authKeys);
    console.log('[Auth] Cleared cached Supabase auth keys:', authKeys);
  }
}

async function hardResetInvalidSession() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // ignore local signout failures during cleanup
  }
  await clearSupabaseAuthStorage();
}

async function resolveValidUser(session: Session | null): Promise<User | null> {
  if (!session?.access_token) {
    return null;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (!userError && userData.user) {
    return userData.user;
  }

  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshData.session?.access_token) {
    console.log('[Auth] Refresh failed, resetting invalid session:', refreshError?.message ?? 'unknown');
    await hardResetInvalidSession();
    return null;
  }

  const { data: refreshedUserData, error: refreshedUserError } = await supabase.auth.getUser();
  if (refreshedUserError || !refreshedUserData.user) {
    console.log('[Auth] Refreshed session still invalid, resetting:', refreshedUserError?.message ?? 'unknown');
    await hardResetInvalidSession();
    return null;
  }

  return refreshedUserData.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const syncAuthState = async (session: Session | null) => {
      try {
        const nextUser = await resolveValidUser(session);
        if (!active) return;
        setUser(nextUser);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncAuthState(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setLoading(false);
        return;
      }

      void syncAuthState(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (
    email: string,
    password: string,
  ): Promise<AuthResponse> => {
    await hardResetInvalidSession();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { data, error };
    }

    if (data?.session?.access_token && data?.session?.refresh_token) {
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      if (setSessionError) {
        await hardResetInvalidSession();
        return {
          data: null,
          error: new Error(`Could not persist auth session: ${setSessionError.message}`),
        };
      }
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      await hardResetInvalidSession();
      return {
        data: null,
        error: new Error(userError?.message ?? 'Login succeeded but the auth session is invalid. Please try again.'),
      };
    }

    setUser(userData.user);
    return { data, error: null };
  };

  const signUp = async (
    email: string,
    password: string,
  ): Promise<AuthResponse> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    return { data, error };
  };

  const signOut = async (): Promise<void> => {
    await hardResetInvalidSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextType => useContext(AuthContext);
