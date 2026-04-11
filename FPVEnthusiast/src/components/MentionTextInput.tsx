import React, { useState, useRef, useCallback } from 'react';
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const searchUsers = useCallback(async (query: string) => {
    const cleanedQuery = query.trim().replace(/^@+/, '');
    if (!cleanedQuery) { setSuggestions([]); return; }
    let req = supabase
      .from('users')
      .select('id, username, avatar_url')
      .ilike('username', `${cleanedQuery}%`)
      .order('username', { ascending: true })
      .limit(6);
    if (currentUserId) req = req.neq('id', currentUserId);
    const { data } = await req;
    setSuggestions(data ?? []);
  }, [currentUserId]);

  const handleChange = useCallback((text: string) => {
    onChangeText(text);
    // Find the @ token at the current cursor position
    const atIndex = text.lastIndexOf('@');
    if (atIndex === -1) {
      setMentionQuery(null);
      setSuggestions([]);
      return;
    }
    const afterAt = text.slice(atIndex + 1);
    // Only trigger if the text after @ has no spaces (still typing the username)
    if (/\s/.test(afterAt)) {
      setMentionQuery(null);
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchUsers(afterAt), 180);
  }, [onChangeText, searchUsers]);

  const handleSelect = useCallback((user: UserSuggestion) => {
    const atIndex = value.lastIndexOf('@');
    const newText = value.slice(0, atIndex) + '@' + user.username + ' ';
    onChangeText(newText);
    setSuggestions([]);
    inputRef.current?.focus();
  }, [value, onChangeText]);

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
