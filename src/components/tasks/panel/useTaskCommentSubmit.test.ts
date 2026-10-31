import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../hooks/useFirestore', () => ({ useMutation: () => ({}), useCollection: () => ({ data: [] }) }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../../hooks/use-toast', () => ({ toast: () => undefined }));
vi.mock('../../../lib/notifyClient', () => ({ resolvePortalUserId: async () => null }));

import { validMentionUids } from './useTaskCommentSubmit';

/**
 * @mention uids come out of the comment TEXT, which anyone can type by hand —
 * only people the business knows may become followers / recipients.
 */
describe('validMentionUids', () => {
  const task = { assignedToUserId: 'assignee', createdByUserId: 'creator', collaboratorIds: ['follower'] };

  it('keeps members and the task\'s own people, drops a foreign uid', () => {
    const out = validMentionUids(['m1', 'stranger', 'assignee', 'creator', 'follower'], { memberUids: ['m1', 'm2'], task });
    expect(out).toEqual(['m1', 'assignee', 'creator', 'follower']);
  });

  it('dedupes and ignores non-strings', () => {
    expect(validMentionUids(['m1', 'm1', 42 as any], { memberUids: ['m1'], task })).toEqual(['m1']);
  });

  it('with no member list only the task\'s own people pass', () => {
    expect(validMentionUids(['x', 'assignee'], { memberUids: [], task: { assignedToUserId: 'assignee' } })).toEqual(['assignee']);
  });
});
