import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Text, TextStyle, StyleProp } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../services/supabase';

interface Props {
  text: string;
  style?: StyleProp<TextStyle>;
}

const mentionIdCache = new Map<string, string | null>();

export default function MentionText({ text, style }: Props) {
  const router = useRouter();
  const [knownMentionIds, setKnownMentionIds] = useState<Record<string, string>>({});

  const parts = useMemo(() => text.split(/(@[a-zA-Z0-9_]+)/g), [text]);
  const usernames = useMemo(() => {
    const matches = text.match(/@[a-zA-Z0-9_]+/g) ?? [];
    return [...new Set(matches.map(match => match.slice(1).toLowerCase()))];
  }, [text]);

  useEffect(() => {
    let cancelled = false;

    const applyCachedMentions = () => {
      const nextKnownIds = usernames.reduce<Record<string, string>>((acc, username) => {
        const cachedId = mentionIdCache.get(username);
        if (cachedId) acc[username] = cachedId;
        return acc;
      }, {});
      if (!cancelled) setKnownMentionIds(nextKnownIds);
    };

    if (!usernames.length) {
      setKnownMentionIds({});
      return () => {
        cancelled = true;
      };
    }

    const unresolved = usernames.filter(username => !mentionIdCache.has(username));
    if (!unresolved.length) {
      applyCachedMentions();
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, username')
        .in('username', unresolved);

      if (error) {
        console.warn('[MentionText] mention lookup failed:', error.message);
        applyCachedMentions();
        return;
      }

      const foundMap = new Map<string, string>();
      (data ?? []).forEach((user: any) => {
        const normalized = String(user.username ?? '').toLowerCase();
        if (normalized && user.id) foundMap.set(normalized, user.id);
      });

      unresolved.forEach(username => {
        mentionIdCache.set(username, foundMap.get(username) ?? null);
      });

      applyCachedMentions();
    })();

    return () => {
      cancelled = true;
    };
  }, [usernames]);

  const handleMentionPress = useCallback(async (username: string) => {
    const normalized = username.toLowerCase();
    let userId = mentionIdCache.get(normalized) ?? null;

    if (!userId) {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      if (error) {
        console.warn('[MentionText] mention press lookup failed:', error.message);
      }

      userId = data?.id ?? null;
      mentionIdCache.set(normalized, userId);
      if (userId) {
        setKnownMentionIds(prev => ({ ...prev, [normalized]: userId as string }));
      }
    }

    if (!userId) {
      Alert.alert('User not found', `@${username} does not have a profile yet.`);
      return;
    }

    router.push(`/user/${userId}` as any);
  }, [router]);

  return (
    <Text style={style}>
      {parts.map((part, index) => {
        if (/^@[a-zA-Z0-9_]+$/.test(part)) {
          const username = part.slice(1);
          const mentionId = knownMentionIds[username.toLowerCase()];

          if (!mentionId) {
            return <Text key={index}>{part}</Text>;
          }

          return (
            <Text
              key={index}
              style={{ color: '#f97316', fontWeight: '600' }}
              onPress={() => { void handleMentionPress(username); }}
            >
              {part}
            </Text>
          );
        }
        return <Text key={index}>{part}</Text>;
      })}
    </Text>
  );
}
