import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  arrayUnion: (v: unknown) => ({ __arrayUnion: v }),
  arrayRemove: (v: unknown) => ({ __arrayRemove: v }),
}));
vi.mock('./useFirestore', () => ({ useMutation: () => ({}) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('./use-toast', () => ({ toast: () => undefined }));

import { reactionTogglePatch } from './useTaskCommentHandlers';

/**
 * A reaction is ONE field-path write on `reactions.<emoji>`, never a rewrite
 * of the whole map — so two colleagues reacting at once both land.
 */
describe('reactionTogglePatch', () => {
  it('adds the uid with arrayUnion when not yet reacted', () => {
    expect(reactionTogglePatch({ reactions: { '👍': ['a'] } }, '👍', 'b')).toEqual({ 'reactions.👍': { __arrayUnion: 'b' } });
  });

  it('removes the uid with arrayRemove when already reacted', () => {
    expect(reactionTogglePatch({ reactions: { '👍': ['a', 'b'] } }, '👍', 'b')).toEqual({ 'reactions.👍': { __arrayRemove: 'b' } });
  });

  it('touches only the toggled emoji — the other keys are never in the write', () => {
    const patch = reactionTogglePatch({ reactions: { '👍': ['a'], '🎉': ['b'] } }, '🎉', 'c');
    expect(Object.keys(patch)).toEqual(['reactions.🎉']);
  });

  it('works on a comment with no reactions map at all', () => {
    expect(reactionTogglePatch({}, '❤️', 'a')).toEqual({ 'reactions.❤️': { __arrayUnion: 'a' } });
    expect(reactionTogglePatch(null, '❤️', 'a')).toEqual({ 'reactions.❤️': { __arrayUnion: 'a' } });
  });
});
