import { useMemo } from 'react';
import { useCollection } from './useFirestore';
import type { UserProfile, TeamMember } from '../types';

/**
 * Returns a helper function `getName(userId, fallback?)` that resolves a
 * Firebase UID to a human-readable display name using the following priority:
 *   1. userProfiles.displayName  (set by the user in their profile)
 *   2. teamMember.email          (stored when creating/accepting invite)
 *   3. fallback string provided by caller
 *   4. first 12 chars of the UID + "…"
 */
export function useUserNames(teamMembers?: TeamMember[]) {
  const { data: profiles } = useCollection<UserProfile>('userProfiles', {
    skipTeamFilter: true,
  });

  const profileMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profiles || []) {
      if (p.userId && p.displayName) {
        map.set(p.userId, p.displayName);
      }
    }
    return map;
  }, [profiles]);

  const memberEmailMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of teamMembers || []) {
      if (m.userId && m.email) {
        map.set(m.userId, m.email);
      }
    }
    return map;
  }, [teamMembers]);

  const getName = (userId: string | null | undefined, fallback?: string): string => {
    if (!userId) return fallback || 'Pa emër';
    return (
      profileMap.get(userId) ||
      memberEmailMap.get(userId) ||
      fallback ||
      `${userId.slice(0, 12)}…`
    );
  };

  const getInitials = (userId: string | null | undefined, fallback?: string): string => {
    const name = getName(userId, fallback);
    // If it's still a truncated UID, return first 2 chars
    if (name.endsWith('…')) return userId?.slice(0, 2).toUpperCase() || '??';
    const parts = name.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return { getName, getInitials };
}
