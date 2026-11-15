import { AnalyzedShortageRaw, NormalizedBox } from '../../types';
import { descriptionSimilarity } from './productMatcher';

export interface HalfSlice {
  offsetX: number; // 0..1 start X in full photo
  spanX: number;  // 0..1 width fraction in full photo (0.6 for 20% overlap)
}

export const LEFT_HALF_SLICE: HalfSlice = { offsetX: 0, spanX: 0.6 };
export const RIGHT_HALF_SLICE: HalfSlice = { offsetX: 0.4, spanX: 0.6 };

export function remapHalfBoxToFullPhoto(
  box: NormalizedBox,
  slice: HalfSlice
): NormalizedBox {
  const x = Math.max(0, Math.min(0.98, slice.offsetX + box.x * slice.spanX));
  const y = Math.max(0, Math.min(0.98, box.y));
  const w = Math.max(0.02, Math.min(1 - x, box.w * slice.spanX));
  const h = Math.max(0.02, Math.min(1 - y, box.h));
  return {
    x: Math.round(x * 10000) / 10000,
    y: Math.round(y * 10000) / 10000,
    w: Math.round(w * 10000) / 10000,
    h: Math.round(h * 10000) / 10000,
  };
}

export function computeBoxOverlapRatio(
  a: NormalizedBox,
  b: NormalizedBox
): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;

  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  if (ix2 <= ix1 || iy2 <= iy1) return 0;

  const interArea = (ix2 - ix1) * (iy2 - iy1);
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  if (minArea <= 0) return 0;
  return interArea / minArea;
}

function areLikelyDuplicateShortages(
  a: AnalyzedShortageRaw,
  b: AnalyzedShortageRaw
): boolean {
  if (computeBoxOverlapRatio(a.gapBox, b.gapBox) > 0.4) {
    return true;
  }
  const aCx = a.gapBox.x + a.gapBox.w / 2;
  const aCy = a.gapBox.y + a.gapBox.h / 2;
  const bCx = b.gapBox.x + b.gapBox.w / 2;
  const bCy = b.gapBox.y + b.gapBox.h / 2;

  if (
    descriptionSimilarity(a.productDescription, b.productDescription) >= 0.45 &&
    Math.abs(aCx - bCx) < 0.14 &&
    Math.abs(aCy - bCy) < 0.12
  ) {
    return true;
  }
  return false;
}

/**
 * Merges duplicate shortage detections across overlapping 20% split halves.
 */
export function mergeDuplicateShortages(
  candidates: AnalyzedShortageRaw[]
): AnalyzedShortageRaw[] {
  const merged: AnalyzedShortageRaw[] = [];

  for (const cand of candidates) {
    const existingIdx = merged.findIndex((m) =>
      areLikelyDuplicateShortages(m, cand)
    );
    if (existingIdx === -1) {
      merged.push({ ...cand });
    } else {
      const existing = merged[existingIdx];
      const winner = cand.confidence > existing.confidence ? cand : existing;
      merged[existingIdx] = {
        productDescription:
          winner.productDescription ||
          existing.productDescription ||
          cand.productDescription,
        gapBox: winner.gapBox,
        productBox: winner.productBox,
        estimatedMissing: Math.max(
          existing.estimatedMissing,
          cand.estimatedMissing
        ),
        confidence: Math.max(existing.confidence, cand.confidence),
      };
    }
  }

  return sortShortagesRTLTopToBottom(merged);
}

/**
 * Orders shortages right-to-left then top-to-bottom (grouping shelf rows by vertical proximity).
 */
export function sortShortagesRTLTopToBottom<T extends { gapBox: NormalizedBox }>(
  items: T[]
): T[] {
  if (items.length <= 1) return [...items];

  const withCenters = items.map((item) => ({
    item,
    cx: item.gapBox.x + item.gapBox.w / 2,
    cy: item.gapBox.y + item.gapBox.h / 2,
  }));

  // Group into horizontal shelf rows (items within 0.13 vertically belong to the same shelf row)
  withCenters.sort((a, b) => a.cy - b.cy);
  const rows: Array<typeof withCenters> = [];
  for (const entry of withCenters) {
    const lastRow = rows[rows.length - 1];
    if (!lastRow) {
      rows.push([entry]);
    } else {
      const avgY =
        lastRow.reduce((sum, r) => sum + r.cy, 0) / lastRow.length;
      if (Math.abs(entry.cy - avgY) <= 0.13) {
        lastRow.push(entry);
      } else {
        rows.push([entry]);
      }
    }
  }

  const ordered: T[] = [];
  for (const row of rows) {
    // Right-to-left: larger X center comes first (1, 2, 3...)
    row.sort((a, b) => b.cx - a.cx);
    for (const r of row) {
      ordered.push(r.item);
    }
  }

  return ordered;
}

/**
 * Rotates a normalized [0..1] bounding box 90 degrees clockwise.
 */
export function rotateBox90CW(box: NormalizedBox): NormalizedBox {
  const x = Math.max(0, Math.min(0.98, 1 - (box.y + box.h)));
  const y = Math.max(0, Math.min(0.98, box.x));
  const w = Math.max(0.02, Math.min(1 - x, box.h));
  const h = Math.max(0.02, Math.min(1 - y, box.w));
  return {
    x: Math.round(x * 10000) / 10000,
    y: Math.round(y * 10000) / 10000,
    w: Math.round(w * 10000) / 10000,
    h: Math.round(h * 10000) / 10000,
  };
}
