import { NoteLinePhoto } from '../../types';

/**
 * Re-aligns visual side pictures to their lines when note text is edited,
 * new lines are inserted, or existing lines are deleted.
 * Never alters text content; aligns purely by prefix/suffix line matching.
 */
export function realignLinePhotosAfterEdit(
  oldLines: string[],
  newLines: string[],
  currentPhotos: NoteLinePhoto[]
): NoteLinePhoto[] {
  if (!currentPhotos || currentPhotos.length === 0) return [];
  if (oldLines.length === newLines.length) {
    // Same line count: filter out-of-range just in case and preserve 1-to-1 lineIndex
    return currentPhotos.filter(
      (p) => p.lineIndex >= 0 && p.lineIndex < newLines.length
    );
  }

  const oldLen = oldLines.length;
  const newLen = newLines.length;

  // 1. Common unchanged prefix length
  let prefix = 0;
  const minLen = Math.min(oldLen, newLen);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

  // 2. Common unchanged suffix length (not overlapping prefix)
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldLines[oldLen - 1 - suffix] === newLines[newLen - 1 - suffix]
  ) {
    suffix++;
  }

  const delta = newLen - oldLen;
  const oldMiddleEnd = oldLen - suffix;
  const newMiddleEnd = newLen - suffix;

  const remapped = new Map<number, NoteLinePhoto>();

  for (const item of currentPhotos) {
    const idx = item.lineIndex;
    if (idx < 0 || idx >= oldLen) continue;

    if (idx < prefix) {
      // Unchanged line before edit region
      remapped.set(idx, item);
    } else if (idx >= oldMiddleEnd) {
      // Unchanged line after edit region -> shift by delta
      const nextIdx = idx + delta;
      if (nextIdx >= 0 && nextIdx < newLen) {
        remapped.set(nextIdx, { ...item, lineIndex: nextIdx });
      }
    } else {
      // Inside edited/split/deleted middle region
      if (delta > 0) {
        // Line(s) inserted or split inside this region: keep photo anchored to its line offset if still in middle
        const candidateIdx = Math.min(newMiddleEnd - 1, idx);
        if (candidateIdx >= prefix && candidateIdx < newMiddleEnd && !remapped.has(candidateIdx)) {
          remapped.set(candidateIdx, { ...item, lineIndex: candidateIdx });
        }
      } else {
        // Lines removed inside middle region: keep only if the target line still exists in the middle band
        if (idx < newMiddleEnd && !remapped.has(idx)) {
          remapped.set(idx, { ...item, lineIndex: idx });
        }
      }
    }
  }

  return Array.from(remapped.values()).sort((a, b) => a.lineIndex - b.lineIndex);
}
