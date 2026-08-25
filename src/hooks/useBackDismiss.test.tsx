import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { useBackDismiss } from './useBackDismiss';

const Overlay: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  const [open, setOpen] = useState(true);
  useBackDismiss(open, () => { setOpen(false); onDismiss(); });
  return <button onClick={() => setOpen(false)}>{open ? 'open' : 'closed'}</button>;
};

describe('useBackDismiss', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/app/projects/p1');
  });

  it('closes the overlay on Back instead of leaving the page', async () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(<Overlay onDismiss={onDismiss} />);

    // The overlay pushed a sentinel entry, so Back has something to pop.
    window.history.back();

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(getByRole('button').textContent).toBe('closed');
    expect(window.location.pathname).toBe('/app/projects/p1');
  });

  it('consumes its own entry when closed from the UI, so Back is not swallowed', async () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(<Overlay onDismiss={onDismiss} />);
    const depth = window.history.length;

    getByRole('button').click();

    await waitFor(() => expect(getByRole('button').textContent).toBe('closed'));
    // Closing from the UI must not fire the Back path...
    expect(onDismiss).not.toHaveBeenCalled();
    // ...and must not leave the sentinel behind.
    await waitFor(() => expect(window.history.length).toBeLessThanOrEqual(depth));
  });
});
