// src/context/AuthContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
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
    await supabase.auth.signOut();
    return null;
  }

  const { data: refreshedUserData, error: refreshedUserError } = await supabase.auth.getUser();
  if (refreshedUserError || !refreshedUserData.user) {
    await supabase.auth.signOut();
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
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
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextType => useContext(AuthContext);
