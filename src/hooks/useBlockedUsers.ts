import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { blockedUserIdsOf } from '../lib/chat/moderation';

/**
 * The signed-in user's block list (`userPreferences/{uid}.blockedUserIds`) — the
 * "Blloko" half of App Store guideline 1.2. Live, so blocking in one place hides the
 * person everywhere at once. Writes are `merge` + arrayUnion/arrayRemove so they can
 * never clobber the notification preferences stored in the same document.
 */
export function useBlockedUsers() {
  const { user } = useAuth();
  const uid = user?.uid;
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (!uid) { setIds([]); return; }
    return onSnapshot(
      doc(db, 'userPreferences', uid),
      (snap) => setIds(blockedUserIdsOf(snap.data())),
      () => setIds([]), // a read failure must not hide anyone
    );
  }, [uid]);

  const blocked = useMemo(() => new Set(ids), [ids]);

  const blockUser = useCallback(async (targetUid: string) => {
    if (!uid || !targetUid || targetUid === uid) return;
    await setDoc(doc(db, 'userPreferences', uid), { blockedUserIds: arrayUnion(targetUid) }, { merge: true });
  }, [uid]);

  const unblockUser = useCallback(async (targetUid: string) => {
    if (!uid || !targetUid) return;
    await setDoc(doc(db, 'userPreferences', uid), { blockedUserIds: arrayRemove(targetUid) }, { merge: true });
  }, [uid]);

  return { blocked, blockedIds: ids, blockUser, unblockUser };
}
