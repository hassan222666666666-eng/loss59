import { NoteCopyDigitStyle, NoteLineQuantity, NoteQuantityUnit } from '../../types';
import { normalizeDigitsKeepSpaces } from '../../utils/arabicText';
import { parseNoteLineMath } from './mathParser';

const HAS_LETTER_REGEX = /\p{L}/u;
const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * Units that prevent a trailing or preceding number from being treated as a box quantity
 * when the unit follows the number (e.g. "850 غ", "1.5 لتر", "350 مل", "12 pcs").
 */
export const QUANTITY_EXCLUDED_UNITS = new Set([
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
  'ملي',
  'ملليلتر',
  'ملم',
  'ل',
  'لتر',
  'ليتر',
  'سم',
  'g',
  'kg',
  'ml',
  'l',
  'cm',
  'pcs',
]);

export function roundQuantityValue(val: number): number {
  return Math.round(val * 10000) / 10000;
}

/**
 * Parses a positive number from Arabic-Indic, Eastern Arabic-Indic, or Western digits.
 * Returns null for empty, zero, negative, or invalid input.
 */
export function parseQuantityNumberInput(raw: string): number | null {
  if (!raw) return null;
  const normalized = normalizeDigitsKeepSpaces(raw)
    .replace(/[٫,]/g, '.')
    .trim();
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return roundQuantityValue(num);
}

export function formatQuantityNumber(value: number): string {
  const rounded = roundQuantityValue(value);
  if (!Number.isFinite(rounded) || rounded <= 0) return '';
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function toArabicIndicDigits(text: string): string {
  return text.replace(/\d/g, (d) => ARABIC_INDIC_DIGITS[Number(d)] ?? d);
}

export function formatQuantityDigits(
  value: number,
  digitStyle: NoteCopyDigitStyle = 'western'
): string {
  const base = formatQuantityNumber(value);
  if (!base) return '';
  return digitStyle === 'arabic' ? toArabicIndicDigits(base) : base;
}

export function formatQuantityUnitLabel(unit?: NoteQuantityUnit): string {
  if (unit === 'carton') return 'كارتون';
  if (unit === 'piece') return 'قطع';
  return '';
}

/**
 * Wraps quantity digits in Unicode BiDi marks so parentheses and digits
 * stay visually ordered identically inside RTL Arabic lines (including WhatsApp):
 * U+200F (RLM) before "(" and after ")", and U+200E (LRM) around the digits.
 */
export function wrapQuantityBidi(qtyText: string): string {
  return `\u200F(\u200E${qtyText}\u200E)\u200F`;
}

/**
 * Extracts a standalone trailing quantity number from the end of a finished line.
 *
 * Rules:
 * - Never matches lines without letters (digits/operators/calculator-only lines).
 * - Never matches lines containing an evaluated math expression (e.g. "حليب 6 * 12").
 * - Number must be standalone at the end of the line (separated by whitespace from text before it),
 *   NOT followed by or attached to a unit (e.g. "200غ", "850 غ", "1.5 لتر", "٣٥٠ مل").
 * - If a line has both a weight and a final number ("قوطية 200غ 5"), the final number is extracted.
 */
export function extractTrailingQuantity(
  rawLine: string
): { cleanName: string; quantity: number } | null {
  if (!rawLine || !rawLine.trim()) return null;
  if (!HAS_LETTER_REGEX.test(rawLine)) return null;
  if (parseNoteLineMath(rawLine).hasExpression) return null;

  // Match whitespace + standalone number at very end of line (accepts Western, Arabic-Indic, Eastern Arabic digits)
  const match = rawLine.match(
    /^(.+?)\s+([0-9\u0660-\u0669\u06F0-\u06F9]+(?:[.\u066B,][0-9\u0660-\u0669\u06F0-\u06F9]+)?)\s*$/u
  );
  if (!match) return null;

  const before = match[1].trimEnd();
  if (!before || !HAS_LETTER_REGEX.test(before)) return null;

  // Do not split if preceded by a math operator or opening delimiter (e.g. "حليب * 5", "شاي - 2", "صنف (2")
  const lastCharBefore = before[before.length - 1];
  if (/[+\-*×/÷=([{]/.test(lastCharBefore)) {
    return null;
  }

  const quantity = parseQuantityNumberInput(match[2]);
  if (quantity === null) return null;

  return {
    cleanName: before,
    quantity,
  };
}

/**
 * Re-aligns per-line quantities after insertions, splits, merges, or deletions
 * using the exact prefix/suffix matching strategy used for line photos.
 */
export function realignLineQuantitiesAfterEdit(
  oldLines: string[],
  newLines: string[],
  currentQuantities: NoteLineQuantity[]
): NoteLineQuantity[] {
  if (!currentQuantities || currentQuantities.length === 0) return [];
  const valid = currentQuantities.filter(
    (q) => Number.isFinite(q.quantity) && q.quantity > 0
  );
  if (valid.length === 0) return [];

  if (oldLines.length === newLines.length) {
    return valid
      .filter((q) => q.lineIndex >= 0 && q.lineIndex < newLines.length)
      .sort((a, b) => a.lineIndex - b.lineIndex);
  }

  const oldLen = oldLines.length;
  const newLen = newLines.length;

  let prefix = 0;
  const minLen = Math.min(oldLen, newLen);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

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

  const remapped = new Map<number, NoteLineQuantity>();

  for (const item of valid) {
    const idx = item.lineIndex;
    if (idx < 0 || idx >= oldLen) continue;

    if (idx < prefix) {
      remapped.set(idx, item);
    } else if (idx >= oldMiddleEnd) {
      const nextIdx = idx + delta;
      if (nextIdx >= 0 && nextIdx < newLen) {
        remapped.set(nextIdx, {
          lineIndex: nextIdx,
          quantity: item.quantity,
          ...(item.unit ? { unit: item.unit } : {}),
        });
      }
    } else if (delta > 0) {
      const candidateIdx = Math.min(newMiddleEnd - 1, idx);
      if (
        candidateIdx >= prefix &&
        candidateIdx < newMiddleEnd &&
        !remapped.has(candidateIdx)
      ) {
        remapped.set(candidateIdx, {
          lineIndex: candidateIdx,
          quantity: item.quantity,
          ...(item.unit ? { unit: item.unit } : {}),
        });
      }
    } else if (idx < newMiddleEnd && !remapped.has(idx)) {
      remapped.set(idx, item);
    }
  }

  return Array.from(remapped.values()).sort(
    (a, b) => a.lineIndex - b.lineIndex
  );
}

/**
 * Converts existing trailing standalone numbers across all lines of a note body
 * into lineQuantities (never runs automatically on toggle; invoked explicitly via button).
 */
export function convertExistingNoteLinesToQuantities(
  body: string,
  currentQuantities: NoteLineQuantity[]
): {
  body: string;
  lineQuantities: NoteLineQuantity[];
  convertedCount: number;
} {
  const lines = body.split('\n');
  const qtyMap = new Map<number, { quantity: number; unit?: NoteQuantityUnit }>();
  for (const q of currentQuantities) {
    if (q.lineIndex >= 0 && q.lineIndex < lines.length && q.quantity > 0) {
      qtyMap.set(q.lineIndex, {
        quantity: roundQuantityValue(q.quantity),
        ...(q.unit ? { unit: q.unit } : {}),
      });
    }
  }

  let convertedCount = 0;
  const nextLines = lines.map((line, idx) => {
    const extracted = extractTrailingQuantity(line);
    if (!extracted) return line;
    convertedCount++;
    const prevUnit = qtyMap.get(idx)?.unit;
    qtyMap.set(idx, {
      quantity: extracted.quantity,
      ...(prevUnit ? { unit: prevUnit } : {}),
    });
    return extracted.cleanName;
  });

  const lineQuantities = Array.from(qtyMap.entries())
    .map(([lineIndex, entry]) => ({
      lineIndex,
      quantity: entry.quantity,
      ...(entry.unit ? { unit: entry.unit } : {}),
    }))
    .sort((a, b) => a.lineIndex - b.lineIndex);

  return {
    body: nextLines.join('\n'),
    lineQuantities,
    convertedCount,
  };
}

export function countConvertibleTrailingLines(lines: string[]): number {
  let count = 0;
  for (const line of lines) {
    if (extractTrailingQuantity(line) !== null) count++;
  }
  return count;
}

/**
 * Computes summary metrics for the top chip ("N مادة · المجموع M").
 * Shown only when at least one quantity exists (`quantifiedCount > 0`).
 */
export function computeNoteQuantitiesSummary(
  lines: string[],
  lineQuantities: NoteLineQuantity[]
): {
  itemCount: number;
  quantifiedCount: number;
  totalQuantity: number;
} {
  const qtyMap = new Map<number, number>();
  for (const q of lineQuantities) {
    if (q.lineIndex >= 0 && q.lineIndex < lines.length && q.quantity > 0) {
      qtyMap.set(q.lineIndex, roundQuantityValue(q.quantity));
    }
  }

  let itemCount = 0;
  let quantifiedCount = 0;
  let totalQuantity = 0;

  for (let i = 0; i < lines.length; i++) {
    const qty = qtyMap.get(i);
    const hasLetter = HAS_LETTER_REGEX.test(lines[i]);
    if (hasLetter || (qty !== undefined && qty > 0)) {
      itemCount++;
    }
    if (qty !== undefined && qty > 0) {
      quantifiedCount++;
      totalQuantity += qty;
    }
  }

  return {
    itemCount,
    quantifiedCount,
    totalQuantity: roundQuantityValue(totalQuantity),
  };
}

/**
 * Computes how many primary action buttons fit in one single row alongside the "⋯" overflow button,
 * ensuring equal widths, same height, and zero wrapping or horizontal overflow on narrow screens.
 */
export function computeToolbarVisibleCount(
  containerWidth: number,
  totalPrimaryButtons: number,
  minButtonWidth: number = 58,
  gapPx: number = 4
): number {
  if (totalPrimaryButtons <= 0) return 0;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return totalPrimaryButtons;
  }
  const maxSlots = Math.max(
    2,
    Math.floor((containerWidth + gapPx) / (minButtonWidth + gapPx))
  );
  // Reserve 1 slot for the always-present "⋯" menu button
  return Math.max(1, Math.min(totalPrimaryButtons, maxSlots - 1));
}
