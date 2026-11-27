import { NoteLinePhoto, NoteLineQuantity } from '../../types';
import { normalizeDigitsKeepSpaces } from '../../utils/arabicText';
import { realignLinePhotosAfterEdit } from './linePhotoAlignment';
import {
  extractTrailingQuantity,
  realignLineQuantitiesAfterEdit,
  roundQuantityValue,
} from './quantityLogic';

export type DuplicateMatchReason = 'exact_words' | 'one_char_typo';

export interface DuplicateLineSuggestion {
  finishedLineIndex: number; // 0-based index of the line just finished
  finishedLineText: string;
  matchLineIndex: number; // 0-based index of the existing matching line
  matchLineNumber: number; // 1-based line number shown to user
  matchLineText: string;
  reason: DuplicateMatchReason;
  pairKey: string;
}

export interface DuplicateGroupItem {
  lineIndex: number;
  lineNumber: number;
  lineText: string;
  words: string[];
  normalizedName: string;
}

export interface DuplicateGroup {
  id: string;
  items: DuplicateGroupItem[];
  pairKeys: string[];
}

export interface NoteDuplicateScanResult {
  groups: DuplicateGroup[];
  duplicateBadgeLineIndices: Set<number>;
  totalExtraDuplicates: number;
}

export interface FinishedLineDebugInfo {
  finishedLineIndex: number;
  finishedLineNumber: number;
  rawLine: string;
  words: string[];
  normalizedName: string;
  skipReason: string | null;
  closestLineIndex: number | null;
  closestLineNumber: number | null;
  closestLineText: string | null;
  closestWords: string[];
  isMatch: boolean;
  reason: DuplicateMatchReason | null;
  detailText: string;
}

const HAS_LETTER_REGEX = /\p{L}/u;
const PURE_NUMBER_REGEX = /^\d+(?:\.\d+)?$/;
const HAS_DIGIT_REGEX = /\d/;

// Weight, volume, length, and packaging units that join with a preceding number (e.g. "200 غ" -> "200غ")
const ADJACENT_UNITS = new Set([
  'غ',
  'غم',
  'جم',
  'غرام',
  'جرام',
  'كغ',
  'كغم',
  'كجم',
  'كيلو',
  'كيلوغرام',
  'كيلوجرام',
  'كلغ',
  'مل',
  'ملل',
  'ملم',
  'ملي',
  'ملليلتر',
  'ل',
  'لتر',
  'ليتر',
  'سم',
  'م',
  'متر',
  'حبه',
  'حبات',
  'قطعه',
  'قطع',
  'كرتون',
  'كراتين',
  'علبه',
  'علب',
  'باكيت',
  'باكت',
  'كيس',
  'اكياس',
  'قنينه',
  'زجاجه',
  'درزن',
  'شده',
  'طرد',
  'g',
  'gm',
  'gr',
  'gram',
  'grams',
  'kg',
  'kilo',
  'mg',
  'ml',
  'l',
  'lt',
  'ltr',
  'liter',
  'cl',
  'oz',
  'lb',
  'lbs',
  'cm',
  'mm',
  'm',
  'pc',
  'pcs',
  'pack',
  'pk',
  'box',
  'ctn',
]);

export function makeDuplicatePairKey(
  idxA: number,
  idxB: number,
  normA: string,
  normB: string
): string {
  if (idxA <= idxB) {
    return `${idxA}:${idxB}:${normA}::${normB}`;
  }
  return `${idxB}:${idxA}:${normB}::${normA}`;
}

/**
 * Normalizes a note line into an ordered array of normalized word tokens:
 * - Arabic-Indic digits -> Western digits
 * - Removes numbering prefix at start (e.g. "1. ", "2) ", "3- ", "4: ")
 * - Strips diacritics (tashkeel) and tatweel
 * - Unifies alef forms (أ إ آ ٱ -> ا), ya/alef maqsura (ى -> ي), ta marbuta/ha (ة -> ه)
 * - Lowercases Latin letters and collapses spaces
 * - Joins adjacent number + unit tokens (e.g. "200 غ" -> "200غ")
 * - Returns [] if the line has no letters (digits/operators only or blank)
 */
export function normalizeNoteLineWords(
  rawLine: string,
  options?: { ignoreTrailingQuantity?: boolean }
): string[] {
  const digitsNormalized = normalizeDigitsKeepSpaces(rawLine || '').toLowerCase();

  // Strip optional leading numbering prefix (must be followed by separator + text or ) / - / :, never decimals like 1.5)
  let withoutNumbering = digitsNormalized.replace(
    /^\s*\d+\s*(?:[.)\-:]+(?=\s|$)|[)\-:])\s*/,
    ''
  );

  if (options?.ignoreTrailingQuantity) {
    const extracted = extractTrailingQuantity(withoutNumbering);
    if (extracted) {
      withoutNumbering = extracted.cleanName;
    }
  }

  if (!HAS_LETTER_REGEX.test(withoutNumbering)) {
    return [];
  }

  const normalizedChars = withoutNumbering
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

  const rawTokens = normalizedChars
    .split(/[^\p{L}\p{N}.]+/u)
    .map((t) => t.replace(/^\.+|\.+$/g, '').trim())
    .filter(Boolean);

  if (rawTokens.length === 0) return [];

  const words: string[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const cur = rawTokens[i];
    const next = rawTokens[i + 1];
    if (
      next &&
      PURE_NUMBER_REGEX.test(cur) &&
      ADJACENT_UNITS.has(next)
    ) {
      words.push(`${cur}${next}`);
      i++;
    } else {
      words.push(cur);
    }
  }

  if (!words.some((w) => HAS_LETTER_REGEX.test(w))) {
    return [];
  }

  return words;
}

export function normalizeNoteLineProductName(
  rawLine: string,
  options?: { ignoreTrailingQuantity?: boolean }
): string {
  return normalizeNoteLineWords(rawLine, options).join(' ');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const chA = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cost = chA === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

/**
 * Strict word-by-word duplicate comparison:
 * 1) Exact same set of words after normalization (word order ignored).
 * 2) OR at most a single 1-character typo inside a single word of >= 5 letters,
 *    with every other word identical and no differing number/weight.
 */
export function compareNormalizedLineWords(
  wordsA: string[],
  wordsB: string[]
): {
  isMatch: boolean;
  reason: DuplicateMatchReason | null;
  sharedWords: number;
  diffA: string[];
  diffB: string[];
} {
  if (wordsA.length === 0 || wordsB.length === 0) {
    return {
      isMatch: false,
      reason: null,
      sharedWords: 0,
      diffA: wordsA,
      diffB: wordsB,
    };
  }

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  let sharedWords = 0;
  const diffA: string[] = [];
  for (const w of setA) {
    if (setB.has(w)) {
      sharedWords++;
    } else {
      diffA.push(w);
    }
  }
  const diffB: string[] = [];
  for (const w of setB) {
    if (!setA.has(w)) {
      diffB.push(w);
    }
  }

  if (diffA.length === 0 && diffB.length === 0) {
    return {
      isMatch: true,
      reason: 'exact_words',
      sharedWords,
      diffA,
      diffB,
    };
  }

  // Must have the exact same word count (no word added or missing)
  if (setA.size === setB.size && diffA.length === 1 && diffB.length === 1) {
    const wA = diffA[0];
    const wB = diffB[0];
    const noDigitsInDiff =
      !HAS_DIGIT_REGEX.test(wA) && !HAS_DIGIT_REGEX.test(wB);
    if (
      noDigitsInDiff &&
      wA.length >= 5 &&
      wB.length >= 5 &&
      levenshteinDistance(wA, wB) === 1
    ) {
      return {
        isMatch: true,
        reason: 'one_char_typo',
        sharedWords,
        diffA,
        diffB,
      };
    }
  }

  return {
    isMatch: false,
    reason: null,
    sharedWords,
    diffA,
    diffB,
  };
}

/**
 * Checks whether `finishedLineIndex` duplicates any other line in `lines`.
 * Runs ONLY after a line is finished, never while typing.
 */
export function findDuplicateForFinishedLine(params: {
  lines: string[];
  finishedLineIndex: number;
  visualLineNumbers?: Array<number | null>;
  ignoredPairKeys?: Set<string>;
  ignoreTrailingQuantity?: boolean;
}): DuplicateLineSuggestion | null {
  const {
    lines,
    finishedLineIndex,
    visualLineNumbers,
    ignoredPairKeys,
    ignoreTrailingQuantity = false,
  } = params;
  if (finishedLineIndex < 0 || finishedLineIndex >= lines.length) return null;

  const finishedText = lines[finishedLineIndex];
  const wordsFinished = normalizeNoteLineWords(finishedText, {
    ignoreTrailingQuantity,
  });
  if (wordsFinished.length === 0) return null;
  const normFinished = wordsFinished.join(' ');

  let best: DuplicateLineSuggestion | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (i === finishedLineIndex) continue;
    const candidateText = lines[i];
    const wordsCand = normalizeNoteLineWords(candidateText, {
      ignoreTrailingQuantity,
    });
    if (wordsCand.length === 0) continue;

    const cmp = compareNormalizedLineWords(wordsCand, wordsFinished);
    if (!cmp.isMatch || !cmp.reason) continue;

    const normCand = wordsCand.join(' ');
    const pairKey = makeDuplicatePairKey(
      i,
      finishedLineIndex,
      normCand,
      normFinished
    );
    if (ignoredPairKeys?.has(pairKey)) continue;

    const matchLineNumber =
      visualLineNumbers && visualLineNumbers[i] != null
        ? (visualLineNumbers[i] as number)
        : i + 1;

    const suggestion: DuplicateLineSuggestion = {
      finishedLineIndex,
      finishedLineText: finishedText.trim(),
      matchLineIndex: i,
      matchLineNumber,
      matchLineText: candidateText.trim(),
      reason: cmp.reason,
      pairKey,
    };

    if (!best) {
      best = suggestion;
    } else if (
      suggestion.reason === 'exact_words' &&
      best.reason !== 'exact_words'
    ) {
      best = suggestion;
    }
  }

  return best;
}

/**
 * Scans the entire note and groups all unresolved duplicate lines together.
 */
export function scanNoteDuplicates(params: {
  lines: string[];
  visualLineNumbers?: Array<number | null>;
  keptPairKeys?: Set<string>;
  excludeLineIndex?: number | null;
  ignoreTrailingQuantity?: boolean;
}): NoteDuplicateScanResult {
  const {
    lines,
    visualLineNumbers,
    keptPairKeys,
    excludeLineIndex,
    ignoreTrailingQuantity = false,
  } = params;

  const activeItems: DuplicateGroupItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (
      excludeLineIndex !== undefined &&
      excludeLineIndex !== null &&
      i === excludeLineIndex
    ) {
      continue;
    }
    const words = normalizeNoteLineWords(lines[i], {
      ignoreTrailingQuantity,
    });
    if (words.length === 0) continue;
    const lineNumber =
      visualLineNumbers && visualLineNumbers[i] != null
        ? (visualLineNumbers[i] as number)
        : i + 1;
    activeItems.push({
      lineIndex: i,
      lineNumber,
      lineText: lines[i].trim(),
      words,
      normalizedName: words.join(' '),
    });
  }

  const n = activeItems.length;
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const itemA = activeItems[a];
      const itemB = activeItems[b];
      const pairKey = makeDuplicatePairKey(
        itemA.lineIndex,
        itemB.lineIndex,
        itemA.normalizedName,
        itemB.normalizedName
      );
      if (keptPairKeys?.has(pairKey)) continue;

      const cmp = compareNormalizedLineWords(itemA.words, itemB.words);
      if (cmp.isMatch) {
        adj[a].push(b);
        adj[b].push(a);
      }
    }
  }

  const visited = new Array<boolean>(n).fill(false);
  const groups: DuplicateGroup[] = [];
  const duplicateBadgeLineIndices = new Set<number>();

  for (let i = 0; i < n; i++) {
    if (visited[i] || adj[i].length === 0) continue;

    const compIndices: number[] = [];
    const queue = [i];
    visited[i] = true;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      compIndices.push(cur);
      for (const nxt of adj[cur]) {
        if (!visited[nxt]) {
          visited[nxt] = true;
          queue.push(nxt);
        }
      }
    }

    if (compIndices.length < 2) continue;
    compIndices.sort(
      (x, y) => activeItems[x].lineIndex - activeItems[y].lineIndex
    );

    const groupItems = compIndices.map((ci) => activeItems[ci]);
    const pairKeys: string[] = [];

    for (let x = 0; x < compIndices.length; x++) {
      const itemX = activeItems[compIndices[x]];
      duplicateBadgeLineIndices.add(itemX.lineIndex);
      for (let y = x + 1; y < compIndices.length; y++) {
        const itemY = activeItems[compIndices[y]];
        pairKeys.push(
          makeDuplicatePairKey(
            itemX.lineIndex,
            itemY.lineIndex,
            itemX.normalizedName,
            itemY.normalizedName
          )
        );
      }
    }

    groups.push({
      id: groupItems.map((it) => it.lineIndex).join('-'),
      items: groupItems,
      pairKeys,
    });
  }

  const totalExtraDuplicates = groups.reduce(
    (sum, g) => sum + Math.max(0, g.items.length - 1),
    0
  );

  return {
    groups,
    duplicateBadgeLineIndices,
    totalExtraDuplicates,
  };
}

/**
 * Debug diagnostics for "تشخيص التكرار": shows the exact normalized words compared.
 */
export function analyzeFinishedLineDebug(params: {
  lines: string[];
  finishedLineIndex: number;
  visualLineNumbers?: Array<number | null>;
  ignoreTrailingQuantity?: boolean;
}): FinishedLineDebugInfo | null {
  const {
    lines,
    finishedLineIndex,
    visualLineNumbers,
    ignoreTrailingQuantity = false,
  } = params;
  if (finishedLineIndex < 0 || finishedLineIndex >= lines.length) return null;

  const rawLine = lines[finishedLineIndex];
  const finishedLineNumber =
    visualLineNumbers && visualLineNumbers[finishedLineIndex] != null
      ? (visualLineNumbers[finishedLineIndex] as number)
      : finishedLineIndex + 1;
  const words = normalizeNoteLineWords(rawLine, { ignoreTrailingQuantity });

  if (words.length === 0) {
    return {
      finishedLineIndex,
      finishedLineNumber,
      rawLine: rawLine.trim(),
      words: [],
      normalizedName: '',
      skipReason: rawLine.trim()
        ? 'سطر أرقام/رموز فقط بدون حروف'
        : 'سطر فارغ',
      closestLineIndex: null,
      closestLineNumber: null,
      closestLineText: null,
      closestWords: [],
      isMatch: false,
      reason: null,
      detailText: 'مستثنى من المقارنة',
    };
  }

  let bestIdx: number | null = null;
  let bestRank = -1;
  let bestWords: string[] = [];
  let bestCmp: ReturnType<typeof compareNormalizedLineWords> | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (i === finishedLineIndex) continue;
    const candWords = normalizeNoteLineWords(lines[i], {
      ignoreTrailingQuantity,
    });
    if (candWords.length === 0) continue;

    const cmp = compareNormalizedLineWords(words, candWords);
    const rank = cmp.isMatch
      ? cmp.reason === 'exact_words'
        ? 1000
        : 900
      : cmp.sharedWords * 10 - Math.abs(candWords.length - words.length);

    if (rank > bestRank) {
      bestRank = rank;
      bestIdx = i;
      bestWords = candWords;
      bestCmp = cmp;
    }
  }

  if (bestIdx === null || !bestCmp) {
    return {
      finishedLineIndex,
      finishedLineNumber,
      rawLine: rawLine.trim(),
      words,
      normalizedName: words.join(' '),
      skipReason: null,
      closestLineIndex: null,
      closestLineNumber: null,
      closestLineText: null,
      closestWords: [],
      isMatch: false,
      reason: null,
      detailText: 'لا يوجد سطر آخر للمقارنة',
    };
  }

  const closestLineNumber =
    visualLineNumbers && visualLineNumbers[bestIdx] != null
      ? (visualLineNumbers[bestIdx] as number)
      : bestIdx + 1;

  let detailText: string;
  if (bestCmp.isMatch) {
    detailText =
      bestCmp.reason === 'exact_words'
        ? 'مكرر (تطابق كامل في الكلمات)'
        : `مكرر (خطأ بحرف واحد: ${bestCmp.diffA[0]} ↔ ${bestCmp.diffB[0]})`;
  } else if (new Set(words).size !== new Set(bestWords).size) {
    detailText = 'غير مكرر (عدد الكلمات مختلف)';
  } else {
    detailText = `غير مكرر (اختلاف في الكلمات: ${bestCmp.diffA.join('، ')} ≠ ${bestCmp.diffB.join('، ')})`;
  }

  return {
    finishedLineIndex,
    finishedLineNumber,
    rawLine: rawLine.trim(),
    words,
    normalizedName: words.join(' '),
    skipReason: null,
    closestLineIndex: bestIdx,
    closestLineNumber,
    closestLineText: lines[bestIdx].trim(),
    closestWords: bestWords,
    isMatch: bestCmp.isMatch,
    reason: bestCmp.reason,
    detailText,
  };
}

export function deleteDuplicateLine(params: {
  body: string;
  linePhotos: NoteLinePhoto[];
  lineQuantities?: NoteLineQuantity[];
  deleteIndex: number;
}): {
  body: string;
  linePhotos: NoteLinePhoto[];
  lineQuantities: NoteLineQuantity[];
} {
  const oldLines = params.body.split('\n');
  if (params.deleteIndex < 0 || params.deleteIndex >= oldLines.length) {
    return {
      body: params.body,
      linePhotos: params.linePhotos,
      lineQuantities: params.lineQuantities || [],
    };
  }

  const nextLines = [
    ...oldLines.slice(0, params.deleteIndex),
    ...oldLines.slice(params.deleteIndex + 1),
  ];
  if (nextLines.length === 0) {
    nextLines.push('');
  }

  const alignedPhotos = realignLinePhotosAfterEdit(
    oldLines,
    nextLines,
    params.linePhotos
  );
  const alignedQuantities = realignLineQuantitiesAfterEdit(
    oldLines,
    nextLines,
    params.lineQuantities || []
  );

  return {
    body: nextLines.join('\n'),
    linePhotos: alignedPhotos,
    lineQuantities: alignedQuantities,
  };
}

export function deleteDuplicateLinesBulk(params: {
  body: string;
  linePhotos: NoteLinePhoto[];
  lineQuantities?: NoteLineQuantity[];
  deleteIndices: number[];
}): {
  body: string;
  linePhotos: NoteLinePhoto[];
  lineQuantities: NoteLineQuantity[];
} {
  const oldLines = params.body.split('\n');
  const toDelete = new Set(
    params.deleteIndices.filter((i) => i >= 0 && i < oldLines.length)
  );
  if (toDelete.size === 0) {
    return {
      body: params.body,
      linePhotos: params.linePhotos,
      lineQuantities: params.lineQuantities || [],
    };
  }

  const nextLines = oldLines.filter((_, idx) => !toDelete.has(idx));
  if (nextLines.length === 0) {
    nextLines.push('');
  }

  const alignedPhotos = realignLinePhotosAfterEdit(
    oldLines,
    nextLines,
    params.linePhotos
  );
  const alignedQuantities = realignLineQuantitiesAfterEdit(
    oldLines,
    nextLines,
    params.lineQuantities || []
  );

  return {
    body: nextLines.join('\n'),
    linePhotos: alignedPhotos,
    lineQuantities: alignedQuantities,
  };
}

/**
 * Merges duplicate lines into `keepIndex`:
 * - Adds any box quantities across `keepIndex` and `removeIndices`.
 * - Preserves `keepIndex`'s side photo (or adopts the first removed line's photo if `keepIndex` had none).
 * - Removes `removeIndices` and shifts remaining line photos & quantities accurately.
 */
export function mergeDuplicateLines(params: {
  body: string;
  linePhotos: NoteLinePhoto[];
  lineQuantities: NoteLineQuantity[];
  keepIndex: number;
  removeIndices: number[];
}): {
  body: string;
  linePhotos: NoteLinePhoto[];
  lineQuantities: NoteLineQuantity[];
  mergedQuantity: number | null;
  unitMismatch?: boolean;
} {
  const oldLines = params.body.split('\n');
  const { keepIndex } = params;
  if (keepIndex < 0 || keepIndex >= oldLines.length) {
    return {
      body: params.body,
      linePhotos: params.linePhotos,
      lineQuantities: params.lineQuantities,
      mergedQuantity: null,
      unitMismatch: false,
    };
  }

  const removeSet = new Set(
    params.removeIndices.filter(
      (idx) => idx >= 0 && idx < oldLines.length && idx !== keepIndex
    )
  );
  if (removeSet.size === 0) {
    const existingQty =
      params.lineQuantities.find((q) => q.lineIndex === keepIndex)?.quantity ??
      null;
    return {
      body: params.body,
      linePhotos: params.linePhotos,
      lineQuantities: params.lineQuantities,
      mergedQuantity: existingQty,
      unitMismatch: false,
    };
  }

  const groupIndices = [keepIndex, ...Array.from(removeSet)];
  const qtyByLine = new Map<number, { quantity: number; unit?: NoteLineQuantity['unit'] }>();
  for (const q of params.lineQuantities) {
    if (Number.isFinite(q.quantity) && q.quantity > 0) {
      qtyByLine.set(q.lineIndex, {
        quantity: roundQuantityValue(q.quantity),
        ...(q.unit ? { unit: q.unit } : {}),
      });
    }
  }

  const explicitUnits = new Set<NonNullable<NoteLineQuantity['unit']>>();
  for (const idx of groupIndices) {
    const entry = qtyByLine.get(idx);
    if (entry && entry.quantity > 0 && entry.unit) {
      explicitUnits.add(entry.unit);
    }
  }
  if (explicitUnits.size > 1) {
    return {
      body: params.body,
      linePhotos: params.linePhotos,
      lineQuantities: params.lineQuantities,
      mergedQuantity: null,
      unitMismatch: true,
    };
  }

  let hasAnyQty = false;
  let summedQty = 0;
  let mergedUnit: NoteLineQuantity['unit'] | undefined = qtyByLine.get(keepIndex)?.unit;
  for (const idx of groupIndices) {
    const entry = qtyByLine.get(idx);
    if (entry && entry.quantity > 0) {
      hasAnyQty = true;
      summedQty = roundQuantityValue(summedQty + entry.quantity);
      if (!mergedUnit && entry.unit) {
        mergedUnit = entry.unit;
      }
    }
  }

  const photoByLine = new Map<number, string>();
  for (const p of params.linePhotos) {
    photoByLine.set(p.lineIndex, p.dataUrl);
  }
  const keepPhoto =
    photoByLine.get(keepIndex) ??
    groupIndices
      .map((idx) => photoByLine.get(idx))
      .find((url): url is string => Boolean(url));

  const indexMap = new Map<number, number>();
  const nextLines: string[] = [];
  for (let i = 0; i < oldLines.length; i++) {
    if (removeSet.has(i)) continue;
    indexMap.set(i, nextLines.length);
    nextLines.push(oldLines[i]);
  }
  if (nextLines.length === 0) {
    nextLines.push('');
  }

  const newKeepIndex = indexMap.get(keepIndex) ?? 0;

  const nextPhotosMap = new Map<number, string>();
  for (const p of params.linePhotos) {
    const mapped = indexMap.get(p.lineIndex);
    if (mapped !== undefined) {
      nextPhotosMap.set(mapped, p.dataUrl);
    }
  }
  if (keepPhoto) {
    nextPhotosMap.set(newKeepIndex, keepPhoto);
  }
  const nextPhotos: NoteLinePhoto[] = Array.from(nextPhotosMap.entries())
    .map(([lineIndex, dataUrl]) => ({ lineIndex, dataUrl }))
    .sort((a, b) => a.lineIndex - b.lineIndex);

  const nextQuantitiesMap = new Map<
    number,
    { quantity: number; unit?: NoteLineQuantity['unit'] }
  >();
  for (const q of params.lineQuantities) {
    if (!Number.isFinite(q.quantity) || q.quantity <= 0) continue;
    const mapped = indexMap.get(q.lineIndex);
    if (mapped !== undefined) {
      nextQuantitiesMap.set(mapped, {
        quantity: roundQuantityValue(q.quantity),
        ...(q.unit ? { unit: q.unit } : {}),
      });
    }
  }
  const mergedQuantity = hasAnyQty && summedQty > 0 ? summedQty : null;
  if (mergedQuantity !== null) {
    nextQuantitiesMap.set(newKeepIndex, {
      quantity: mergedQuantity,
      ...(mergedUnit ? { unit: mergedUnit } : {}),
    });
  } else {
    nextQuantitiesMap.delete(newKeepIndex);
  }
  const nextQuantities: NoteLineQuantity[] = Array.from(
    nextQuantitiesMap.entries()
  )
    .map(([lineIndex, entry]) => ({
      lineIndex,
      quantity: entry.quantity,
      ...(entry.unit ? { unit: entry.unit } : {}),
    }))
    .sort((a, b) => a.lineIndex - b.lineIndex);

  return {
    body: nextLines.join('\n'),
    linePhotos: nextPhotos,
    lineQuantities: nextQuantities,
    mergedQuantity,
    unitMismatch: false,
  };
}
