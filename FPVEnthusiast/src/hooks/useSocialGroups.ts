import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export type SocialGroupPrivacy = 'public' | 'private' | 'invite_only';
export type SocialGroupPermission = 'members' | 'mods';
export type SocialGroupRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface SocialGroup {
  id: string;
  name: string;
  description: string | null;
  privacy: SocialGroupPrivacy;
  avatar_url: string | null;
  cover_url: string | null;
  created_by: string;
  chat_room_id: string | null;
  can_post: SocialGroupPermission;
  can_chat: SocialGroupPermission;
  can_invite: SocialGroupPermission;
  created_at: string;
  updated_at: string;
  my_role?: SocialGroupRole | null;
  member_count?: number;
}

export interface SocialGroupMember {
  group_id: string;
  user_id: string;
  role: SocialGroupRole;
  invited_by?: string | null;
  joined_at: string;
  last_seen_at?: string | null;
  user?: {
    id?: string | null;
    username?: string | null;
    avatar_url?: string | null;
  } | null;
}

interface CreateSocialGroupParams {
  name: string;
  description?: string;
  privacy?: SocialGroupPrivacy;
  memberIds?: string[];
  canPost?: SocialGroupPermission;
  canChat?: SocialGroupPermission;
  canInvite?: SocialGroupPermission;
}

function normalizeGroup(raw: any, myRole?: SocialGroupRole | null, memberCount?: number): SocialGroup {
  const group = Array.isArray(raw) ? raw[0] : raw;
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? null,
    privacy: group.privacy,
    avatar_url: group.avatar_url ?? null,
    cover_url: group.cover_url ?? null,
    created_by: group.created_by,
    chat_room_id: group.chat_room_id ?? null,
    can_post: group.can_post,
    can_chat: group.can_chat,
    can_invite: group.can_invite,
    created_at: group.created_at,
    updated_at: group.updated_at,
    my_role: myRole ?? null,
    member_count: memberCount,
  };
}

export function useSocialGroups(currentUserId?: string) {
  const [groups, setGroups] = useState<SocialGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!currentUserId) {
      setGroups([]);
      return;
    }

    setLoading(true);

    const { data, error } = await supabase
      .from('social_group_members')
      .select(`
        role,
        group:group_id (
          id, name, description, privacy, avatar_url, cover_url,
          created_by, chat_room_id, can_post, can_chat, can_invite,
          created_at, updated_at
        )
      `)
      .eq('user_id', currentUserId)
      .order('joined_at', { ascending: false });

    if (error) {
      console.warn('[useSocialGroups] fetchGroups error:', error.message);
      setGroups([]);
      setLoading(false);
      return;
    }

    const groupRows = (data ?? []) as any[];
    const groupIds = groupRows
      .map(row => row.group?.id)
      .filter(Boolean) as string[];

    const counts: Record<string, number> = {};
    if (groupIds.length > 0) {
      const { data: countRows } = await supabase
        .from('social_group_members')
        .select('group_id')
        .in('group_id', groupIds);

      for (const row of countRows ?? []) {
        const gid = (row as any).group_id as string;
        counts[gid] = (counts[gid] ?? 0) + 1;
      }
    }

    setGroups(
      groupRows
        .filter(row => row.group?.id)
        .map(row => normalizeGroup(row.group, row.role as SocialGroupRole, counts[row.group.id] ?? 1))
    );
    setLoading(false);
  }, [currentUserId]);

  const refreshGroups = useCallback(async () => {
    setRefreshing(true);
    await fetchGroups();
    setRefreshing(false);
  }, [fetchGroups]);

  const createGroup = useCallback(async ({
    name,
    description,
    privacy = 'private',
    memberIds = [],
    canPost = 'members',
    canChat = 'members',
    canInvite = 'mods',
  }: CreateSocialGroupParams): Promise<string | null> => {
    const { data, error } = await supabase.rpc('create_social_group', {
      p_name: name,
      p_description: description?.trim() || null,
      p_privacy: privacy,
      p_member_ids: memberIds,
      p_can_post: canPost,
      p_can_chat: canChat,
      p_can_invite: canInvite,
    });

    if (error) {
      console.warn('[useSocialGroups] createGroup error:', error.message);
      return null;
    }

    await fetchGroups();
    return data as string;
  }, [fetchGroups]);

  const addMember = useCallback(async (
    groupId: string,
    userId: string,
    role: Exclude<SocialGroupRole, 'owner'> = 'member',
  ): Promise<boolean> => {
    const { error } = await supabase.rpc('add_social_group_member', {
      p_group_id: groupId,
      p_user_id: userId,
      p_role: role,
    });
    if (error) {
      console.warn('[useSocialGroups] addMember error:', error.message);
      return false;
    }
    await fetchGroups();
    return true;
  }, [fetchGroups]);

  const updateMemberRole = useCallback(async (
    groupId: string,
    userId: string,
    role: Exclude<SocialGroupRole, 'owner'>,
  ): Promise<boolean> => {
    const { error } = await supabase.rpc('update_social_group_member_role', {
      p_group_id: groupId,
      p_user_id: userId,
      p_role: role,
    });
    if (error) {
      console.warn('[useSocialGroups] updateMemberRole error:', error.message);
      return false;
    }
    return true;
  }, []);

  const removeMember = useCallback(async (
    groupId: string,
    userId: string,
  ): Promise<boolean> => {
    const { error } = await supabase.rpc('remove_social_group_member', {
      p_group_id: groupId,
      p_user_id: userId,
    });
    if (error) {
      console.warn('[useSocialGroups] removeMember error:', error.message);
      return false;
    }
    await fetchGroups();
    return true;
  }, [fetchGroups]);

  const updateGroupSettings = useCallback(async (
    groupId: string,
    updates: {
      description?: string | null;
      privacy?: SocialGroupPrivacy;
      canPost?: SocialGroupPermission;
      canChat?: SocialGroupPermission;
      canInvite?: SocialGroupPermission;
    }
  ): Promise<boolean> => {
    const { error } = await supabase.rpc('update_social_group_settings', {
      p_group_id: groupId,
      p_description: updates.description ?? null,
      p_privacy: updates.privacy ?? null,
      p_can_post: updates.canPost ?? null,
      p_can_chat: updates.canChat ?? null,
      p_can_invite: updates.canInvite ?? null,
    });

    if (error) {
      console.warn('[useSocialGroups] updateGroupSettings error:', error.message);
      return false;
    }

    await fetchGroups();
    return true;
  }, [fetchGroups]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  return {
    groups,
    loading,
    refreshing,
    fetchGroups,
    refreshGroups,
    createGroup,
    addMember,
    updateMemberRole,
    removeMember,
    updateGroupSettings,
  };
}
