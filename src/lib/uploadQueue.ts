/**
 * Bounded-concurrency runner for multi-file uploads ("zgjidh të gjitha → ngarko").
 *
 * Returns ONE promise per item, in input order, while at most `limit` run at once.
 * Callers that must keep order (chat: one message per photo, in the order picked)
 * await the promises one by one and act as soon as each is ready; callers that only
 * need the outcome use `settleLimited`. A rejected item never stops the others —
 * that is the point: one failed photo out of twenty must not lose the other nineteen.
 */
export function runLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R>[] {
  const max = Math.max(1, Math.floor(limit) || 1);
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => new Promise<void>((resolve) => {
    if (active < max) { active++; resolve(); } else waiting.push(() => { active++; resolve(); });
  });
  const release = () => { active--; waiting.shift()?.(); };

  return items.map(async (item, index) => {
    await acquire();
    try { return await fn(item, index); } finally { release(); }
  });
}

export async function settleLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  return Promise.allSettled(runLimited(items, limit, fn));
}

/** "Po ngarkohet 3/20" — null when nothing (or a single file) is in flight. */
export function batchLabel(batch: { done: number; total: number } | null | undefined): string | null {
  if (!batch || batch.total <= 1) return null;
  return `Po ngarkohet ${Math.min(batch.done + 1, batch.total)}/${batch.total}`;
}

const HEIC_EXT = /\.(heic|heif)$/i;
export function isHeic(file: { type?: string; name?: string }): boolean {
  const t = (file.type || '').toLowerCase();
  return t === 'image/heic' || t === 'image/heif' || HEIC_EXT.test(file.name || '');
}

/**
 * iPhone photos copied to a computer are HEIC, which only Safari can render. Where
 * the browser can decode it, re-encode as JPEG so every viewer sees the picture;
 * where it cannot (Chrome/Firefox) the original is returned untouched — the VPS
 * accepts HEIC, it is simply shown as a file instead of an inline image.
 */
export async function heicToJpegIfPossible(file: File): Promise<File> {
  if (!isHeic(file) || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(HEIC_EXT, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
