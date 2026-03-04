import { useState, useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { supabase } from '../services/supabase';

WebBrowser.maybeCompleteAuthSession();

// ── Replace these with your actual Google Cloud Console client IDs ────────────
const IOS_CLIENT_ID =
  '518946115446-g375c3c0beIneIg6hp4q1I8Imf3uev91.apps.googleusercontent.com';
const WEB_CLIENT_ID =
  '518946115446-8ejcogvq2mq7k1a9i360hg8r4d3v2t23.apps.googleusercontent.com';

export function useYouTubeAuth(userId: string | undefined) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
    scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
  });

  // Debug: log the redirect URI so you can whitelist it in Google Cloud Console
  useEffect(() => {
    if (request?.redirectUri) {
      console.log('[YT Auth] Redirect URI:', request.redirectUri);
    }
  }, [request?.redirectUri]);

  // Load saved token from Supabase on mount
  useEffect(() => {
    if (!userId) return;
    supabase
      .from('user_profiles')
      .select('youtube_access_token')
      .eq('id', userId)
      .single()
      .then(({ data }: { data: { youtube_access_token: string | null } | null }) => {
        if (data?.youtube_access_token) {
          setAccessToken(data.youtube_access_token);
        }
      });
  }, [userId]);

  // Handle OAuth response — save token to Supabase
  useEffect(() => {
    if (response?.type !== 'success') return;
    const token = response.authentication?.accessToken ?? null;
    if (!token || !userId) return;
    setAccessToken(token);
    supabase
      .from('user_profiles')
      .update({ youtube_access_token: token })
      .eq('id', userId)
      .then(() => {
        console.log('[YT Auth] Token saved to Supabase');
      });
  }, [response, userId]);

  const signIn = async () => {
    setLoading(true);
    await promptAsync();
    setLoading(false);
  };

  const signOut = async () => {
    setAccessToken(null);
    if (userId) {
      await supabase
        .from('user_profiles')
        .update({ youtube_access_token: null })
        .eq('id', userId);
    }
  };

  return {
    // ── Primary API ──────────────────────────────────────────────────────────
    accessToken,
    loading,
    signIn,
    signOut,
    ready: !!request,

    // ── Aliases used by profile.tsx ──────────────────────────────────────────
    // profile.tsx destructures: { linked, loading, promptAsync, unlinkYouTube }
    linked: !!accessToken,          // true when a YouTube token is stored
    promptAsync: signIn,            // triggers the OAuth flow
    unlinkYouTube: signOut,         // clears the token from state + Supabase
  };
}
