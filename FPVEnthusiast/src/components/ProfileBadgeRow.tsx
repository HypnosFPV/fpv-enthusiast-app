import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ProfileBadgeDefinition } from '../constants/profileBadges';

interface ProfileBadgeRowProps {
  badges: ProfileBadgeDefinition[];
  accentColor?: string;
  borderColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  emptyText?: string | null;
  compact?: boolean;
  removable?: boolean;
  onRemoveBadge?: (badgeId: string) => void;
}

export default function ProfileBadgeRow({
  badges,
  accentColor = '#7c5cff',
  borderColor = '#2b3650',
  textColor = '#ffffff',
  mutedTextColor = '#9aa2c5',
  emptyText = null,
  compact = false,
  removable = false,
  onRemoveBadge,
}: ProfileBadgeRowProps) {
  if (!badges.length) {
    return emptyText ? <Text style={[styles.emptyText, { color: mutedTextColor }]}>{emptyText}</Text> : null;
  }

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {badges.map((badge) => (
        <View
          key={badge.id}
          style={[
            styles.badgePill,
            compact && styles.badgePillCompact,
            { borderColor: `${badge.accentColor}55`, backgroundColor: `${badge.accentColor}12` },
          ]}
        >
          <Ionicons name={badge.iconName as any} size={compact ? 12 : 13} color={badge.accentColor || accentColor} />
          <Text
            numberOfLines={1}
            style={[
              styles.badgeText,
              compact && styles.badgeTextCompact,
              { color: textColor },
            ]}
          >
            {badge.name}
          </Text>
          {badge.limited ? (
            <View style={[styles.tierPill, { borderColor: `${badge.accentColor}55` }]}>
              <Text style={[styles.tierText, { color: badge.accentColor || accentColor }]}>Limited</Text>
            </View>
          ) : null}
          {removable && onRemoveBadge ? (
            <TouchableOpacity
              accessibilityLabel={`Remove ${badge.name}`}
              hitSlop={8}
              style={[styles.removeBtn, { borderColor }]}
              onPress={() => onRemoveBadge(badge.id)}
            >
              <Ionicons name="close" size={12} color={mutedTextColor} />
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowCompact: {
    marginTop: 4,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
  },
  badgePillCompact: {
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 160,
  },
  badgeTextCompact: {
    fontSize: 11,
    maxWidth: 140,
  },
  tierPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tierText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  removeBtn: {
    marginLeft: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
