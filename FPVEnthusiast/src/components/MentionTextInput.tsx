import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { supabase } from '../services/supabase';

interface UserSuggestion {
  id: string;
  username: string;
  avatar_url?: string | null;
}

interface MentionRange {
  start: number;
  end: number;
  query: string;
}

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  multiline?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  currentUserId?: string | null;
  suggestionsAbove?: boolean;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
}

export default function MentionTextInput({
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  multiline,
  maxLength,
  autoFocus,
  autoCapitalize = 'none',
  currentUserId,
  suggestionsAbove = false,
  containerStyle,
  inputStyle,
}: Props) {
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const activeMentionRef = useRef<MentionRange | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  const getActiveMention = useCallback((text: string, cursor: number): MentionRange | null => {
    const safeCursor = Math.max(0, Math.min(cursor, text.length));
    const beforeCursor = text.slice(0, safeCursor);
    const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
    if (!match) return null;

    const query = match[2] ?? '';
    const start = safeCursor - query.length - 1;
    const trailingToken = text.slice(safeCursor).match(/^[a-zA-Z0-9_]*/)?.[0] ?? '';
    const end = safeCursor + trailingToken.length;

    return { start, end, query };
  }, []);

  const searchUsers = useCallback(async (query: string) => {
    const cleanedQuery = query.trim().replace(/^@+/, '');
    if (!cleanedQuery) {
      setSuggestions([]);
      return;
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .ilike('username', `%${cleanedQuery}%`)
      .order('username', { ascending: true })
      .limit(8);

    if (error) {
      console.warn('[MentionTextInput] search users failed:', error.message);
      setSuggestions([]);
      return;
    }

    setSuggestions(data ?? []);
  }, []);

  useEffect(() => {
    const activeMention = getActiveMention(value, selection.start);
    activeMentionRef.current = activeMention;

    if (!activeMention || !activeMention.query.trim()) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void searchUsers(activeMention.query);
    }, 180);
  }, [getActiveMention, searchUsers, selection.start, value]);

  const handleChange = useCallback((text: string) => {
    onChangeText(text);
  }, [onChangeText]);

  const handleSelect = useCallback((user: UserSuggestion) => {
    const activeMention = activeMentionRef.current;
    if (!activeMention) {
      setSuggestions([]);
      return;
    }

    const prefix = value.slice(0, activeMention.start);
    const suffix = value.slice(activeMention.end);
    const trimmedSuffix = suffix.startsWith(' ') ? suffix.slice(1) : suffix;
    const insertedMention = `@${user.username} `;
    const newText = `${prefix}${insertedMention}${trimmedSuffix}`;
    const nextCursor = prefix.length + insertedMention.length;

    onChangeText(newText);
    setSuggestions([]);
    setSelection({ start: nextCursor, end: nextCursor });

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps?.({
        selection: { start: nextCursor, end: nextCursor },
      });
    });
  }, [onChangeText, value]);

  const renderSuggestions = () => {
    if (!suggestions.length) return null;
    return (
      <View style={[
        styles.suggestionsContainer,
        suggestionsAbove ? styles.suggestionsContainerAbove : styles.suggestionsContainerBelow,
      ]}>
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={styles.suggestionsScroll}
          nestedScrollEnabled
        >
          {suggestions.map((user) => (
            <TouchableOpacity
              key={user.id}
              style={styles.suggestionRow}
              onPress={() => handleSelect(user)}
              activeOpacity={0.7}
            >
              {user.avatar_url ? (
                <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>
                    {(user.username || '?')[0].toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.username}>@{user.username}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {suggestionsAbove && renderSuggestions()}
      <TextInput
        ref={inputRef}
        style={[styles.input, inputStyle]}
        value={value}
        onChangeText={handleChange}
        onSelectionChange={(event: any) => {
          const next = event?.nativeEvent?.selection;
          if (!next) return;
          setSelection({ start: next.start ?? 0, end: next.end ?? next.start ?? 0 });
        }}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor ?? '#555'}
        multiline={multiline}
        maxLength={maxLength}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
      />
      {!suggestionsAbove && renderSuggestions()}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    position: 'relative',
    zIndex: 20,
  },
  input: {
    backgroundColor: '#1a1a35',
    color: '#ffffff',
    borderRadius: 18,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 14,
    paddingRight: 46,
    fontSize: 15,
    lineHeight: 20,
    borderWidth: 1,
    borderColor: '#252545',
    minHeight: 42,
    maxHeight: 120,
  },
  suggestionsContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#1a1a35',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a50',
    maxHeight: 200,
    overflow: 'hidden',
    zIndex: 50,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  suggestionsContainerAbove: {
    bottom: '100%',
    marginBottom: 6,
  },
  suggestionsContainerBelow: {
    top: '100%',
    marginTop: 6,
  },
  suggestionsScroll: {
    maxHeight: 200,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a50',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2a2a50',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarInitial: {
    color: '#4fc3f7',
    fontWeight: '700',
    fontSize: 14,
  },
  username: {
    color: '#e0e0ff',
    fontSize: 14,
    fontWeight: '600',
  },
});
