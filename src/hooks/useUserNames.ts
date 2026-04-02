import { useMemo } from 'react';
import { useCollection } from './useFirestore';
import type { UserProfile, TeamMember } from '../types';

/**
 * Returns a helper function `getName(userId, fallback?)` that resolves a
 * Firebase UID to a human-readable display name using the following priority:
 *   1. userProfiles.displayName  (set by the user in their profile page)
 *   2. teamMember.displayName    (saved on invite-accept / team-create)
 *   3. teamMember.email          (stripped to local part before @)
 *   4. fallback string provided by caller
 *   5. first 12 chars of the UID + "…"
 */
export function useUserNames(teamMembers?: TeamMember[]) {
  const { data: profiles } = useCollection<UserProfile>('userProfiles', {
    skipTeamFilter: true,
  });

  const profileMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profiles || []) {
      if (p.userId) {
        const name = p.displayName || ((p as any).email ? (p as any).email.split('@')[0] : null);
        if (name) map.set(p.userId, name);
      }
    }
    return map;
  }, [profiles]);

  // Map userId → best available name from TeamMember record
  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of teamMembers || []) {
      if (!m.userId) continue;
      const name =
        m.displayName ||
        (m.email ? m.email.split('@')[0] : null);
      if (name) map.set(m.userId, name);
    }
    return map;
  }, [teamMembers]);

  const getName = (userId: string | null | undefined, fallback?: string): string => {
    if (!userId) return fallback || 'Pa emër';
    return (
      profileMap.get(userId) ||
      memberNameMap.get(userId) ||
      fallback ||
      `${userId.slice(0, 12)}…`
    );
  };

  const getInitials = (userId: string | null | undefined, fallback?: string): string => {
    const name = getName(userId, fallback);
    // Still a truncated UID — use first 2 chars of UID
    if (name.endsWith('…')) return userId?.slice(0, 2).toUpperCase() || '??';
    const parts = name.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return { getName, getInitials };
}
