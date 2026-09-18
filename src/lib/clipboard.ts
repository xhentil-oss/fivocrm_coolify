/**
 * Copying to the clipboard, honestly.
 *
 * `navigator.clipboard.writeText()` returns a PROMISE and it rejects more often
 * than the call sites assumed: without a fresh user activation, in an insecure
 * context, and on several Android WebView builds. Call sites were firing a
 * "U kopjua" toast on the next line regardless, so the user was told the invite
 * link / portal link was on their clipboard when nothing had been copied — and
 * the rejection surfaced only as an unhandled promise warning in the console.
 *
 * `copyText()` awaits the write, falls back to the legacy `execCommand` path that
 * still works where the async API is unavailable, and returns whether it actually
 * worked so the caller can toast the truth.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }

  // Legacy fallback: a hidden textarea + execCommand('copy'). Deprecated, but it is
  // the only thing that works in a WebView without the async Clipboard API.
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Keep it off-screen but selectable — `display:none` cannot be selected, and an
    // element at the top of the page would scroll the view on focus.
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copy and report the outcome through the caller's toast function. Keeps the
 * "did it work?" branch in one place instead of at every call site.
 */
export async function copyWithToast(
  text: string,
  toast: (opts: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void,
  okTitle = 'U kopjua',
): Promise<boolean> {
  const ok = await copyText(text);
  toast(
    ok
      ? { title: okTitle }
      : {
          title: 'Nuk u kopjua dot',
          description: 'Shfletuesi e bllokoi kopjimin — zgjidhe tekstin dhe kopjoje me dorë.',
          variant: 'destructive',
        },
  );
  return ok;
}
