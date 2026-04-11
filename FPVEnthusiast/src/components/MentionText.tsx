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
  const parts = useMemo(() => text.split(/(@[a-zA-Z0-9_]+)/g), [text]);
  const mentionedUsernames = useMemo(
    () => [...new Set((text.match(/@([a-zA-Z0-9_]+)/g) ?? []).map(token => token.slice(1).toLowerCase()))],
    [text],
  );
  const [validMentions, setValidMentions] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const hydrateMentions = async () => {
      if (!mentionedUsernames.length) {
        setValidMentions(new Set());
        return;
      }

      const nextValid = new Set<string>();
      const unresolved = mentionedUsernames.filter((username) => {
        const cached = mentionIdCache.get(username);
        if (cached) {
          nextValid.add(username);
          return false;
        }
        if (cached === null) {
          return false;
        }
        return true;
      });

      if (unresolved.length) {
        const { data, error } = await supabase
          .from('users')
          .select('id, username')
          .in('username', unresolved);

        if (error) {
          console.warn('[MentionText] hydrate mentions failed:', error.message);
        }

        const found = new Set<string>((data ?? []).map((user: any) => String(user.username ?? '').toLowerCase()).filter(Boolean));
        unresolved.forEach((username) => {
          if (found.has(username)) {
            const matched = (data ?? []).find((user: any) => String(user.username ?? '').toLowerCase() === username);
            mentionIdCache.set(username, matched?.id ?? null);
            nextValid.add(username);
          } else {
            mentionIdCache.set(username, null);
          }
        });
      }

      if (!cancelled) {
        setValidMentions(nextValid);
      }
    };

    void hydrateMentions();
    return () => {
      cancelled = true;
    };
  }, [mentionedUsernames]);

  const handleMentionPress = useCallback(async (username: string) => {
    const normalized = username.trim().toLowerCase();
    let userId = mentionIdCache.get(normalized) ?? null;

    if (!userId) {
      const { data, error } = await supabase
        .from('users')
        .select('id, username')
        .ilike('username', normalized)
        .maybeSingle();

      if (error) {
        console.warn('[MentionText] mention press lookup failed:', error.message);
      }

      userId = data?.id ?? null;
      mentionIdCache.set(normalized, userId);
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
          const normalized = username.toLowerCase();
          if (!validMentions.has(normalized)) {
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
