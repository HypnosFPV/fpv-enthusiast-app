import React from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';
import { useRouter } from 'expo-router';

interface Props {
  text: string;
  style?: StyleProp<TextStyle>;
}

export default function MentionText({ text, style }: Props) {
  const router = useRouter();

  const parts = text.split(/(@[a-zA-Z0-9_]+)/g);

  return (
    <Text style={style}>
      {parts.map((part, index) => {
        if (/^@[a-zA-Z0-9_]+$/.test(part)) {
          const username = part.slice(1);
          return (
            <Text
              key={index}
              style={{ color: '#f97316', fontWeight: '600' }}
              onPress={() => router.push(`/profile/${username}` as any)}
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
