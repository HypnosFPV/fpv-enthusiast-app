import React, { useCallback, useMemo } from 'react';
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
