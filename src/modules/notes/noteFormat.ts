import {
  NoteCopyDigitStyle,
  NoteCopySortOrder,
  NoteLineQuantity,
  NoteQuantityUnit,
} from '../../types';
import {
  formatQuantityDigits,
  formatQuantityUnitLabel,
  roundQuantityValue,
  wrapQuantityBidi,
} from './quantityLogic';

/**
 * Shared note formatting utilities for copying notes identically to how they appear
 * in the editor (preserving title, exact line order, visual numbering, blank-line resets,
 * and optional quantity boxes with RTL BiDi protection).
 */

export function computeVisualLineNumbers(
  lines: string[],
  numberingEnabled: boolean,
  resetAfterBlankLine: boolean
): Array<number | null> {
  if (!numberingEnabled) return lines.map(() => null);
  let counter = 1;
  return lines.map((line) => {
    if (resetAfterBlankLine && line.trim() === '') {
      counter = 1;
      return null;
    }
    const val = counter;
    counter++;
    return val;
  });
}

interface FormattedLineEntry {
  text: string;
  sectionCounter: number;
  quantity?: number;
  unit?: NoteQuantityUnit;
}

function buildQuantityModeLines(params: {
  body: string;
  numberingEnabled: boolean;
  resetAfterBlankLine: boolean;
  lineQuantities: NoteLineQuantity[];
  sortOrder: NoteCopySortOrder;
  digitStyle: NoteCopyDigitStyle;
}): {
  lines: string[];
  totalQuantity: number;
  hasAnyQuantity: boolean;
} {
  const {
    body,
    numberingEnabled,
    resetAfterBlankLine,
    lineQuantities,
    sortOrder,
    digitStyle,
  } = params;

  const rawLines = body.split('\n');
  const qtyMap = new Map<number, { quantity: number; unit?: NoteQuantityUnit }>();
  for (const q of lineQuantities) {
    if (
      q.lineIndex >= 0 &&
      q.lineIndex < rawLines.length &&
      Number.isFinite(q.quantity) &&
      q.quantity > 0
    ) {
      qtyMap.set(q.lineIndex, {
        quantity: roundQuantityValue(q.quantity),
        ...(q.unit ? { unit: q.unit } : {}),
      });
    }
  }

  const entries: FormattedLineEntry[] = [];
  let counter = 1;
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (!trimmed) {
      if (resetAfterBlankLine) {
        counter = 1;
      }
      continue;
    }
    const qtyInfo = qtyMap.get(i);
    entries.push({
      text: trimmed,
      sectionCounter: counter,
      quantity: qtyInfo?.quantity,
      unit: qtyInfo?.unit,
    });
    counter++;
  }

  const ordered =
    sortOrder === 'alphabetical'
      ? [...entries].sort((a, b) =>
          a.text.localeCompare(b.text, 'ar', { sensitivity: 'base' })
        )
      : entries;

  let totalQuantity = 0;
  let hasAnyQuantity = false;

  const formattedLines = ordered.map((entry, idx) => {
    const num =
      numberingEnabled
        ? sortOrder === 'alphabetical'
          ? idx + 1
          : entry.sectionCounter
        : null;
    const base = num !== null ? `${num}. ${entry.text}` : entry.text;
    if (entry.quantity !== undefined && entry.quantity > 0) {
      hasAnyQuantity = true;
      totalQuantity = roundQuantityValue(totalQuantity + entry.quantity);
      const qtyDigits = formatQuantityDigits(entry.quantity, digitStyle);
      const unitLabel = formatQuantityUnitLabel(entry.unit);
      const inner = unitLabel ? `\u200E${qtyDigits}\u200E ${unitLabel}` : qtyDigits;
      return `${base} ${wrapQuantityBidi(inner)}`;
    }
    return base;
  });

  return {
    lines: formattedLines,
    totalQuantity,
    hasAnyQuantity,
  };
}

export function formatNoteForCopy(params: {
  title: string;
  body: string;
  numberingEnabled?: boolean;
  resetAfterBlankLine?: boolean;
  quantitiesEnabled?: boolean;
  lineQuantities?: NoteLineQuantity[];
  sortOrder?: NoteCopySortOrder;
  digitStyle?: NoteCopyDigitStyle;
  includeTotalQuantities?: boolean;
}): string {
  const {
    title,
    body,
    numberingEnabled = false,
    resetAfterBlankLine = false,
    quantitiesEnabled = false,
    lineQuantities = [],
    sortOrder = 'as-written',
    digitStyle = 'western',
    includeTotalQuantities = false,
  } = params;

  if (!quantitiesEnabled) {
    const rawLines = body.split('\n');
    const lineNumbers = computeVisualLineNumbers(
      rawLines,
      numberingEnabled,
      resetAfterBlankLine
    );

    const formattedBody = numberingEnabled
      ? rawLines
          .map((line, i) => {
            const num = lineNumbers[i];
            const trimmed = line.trim();
            if (!trimmed) return '';
            return num !== null ? `${num}. ${trimmed}` : trimmed;
          })
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : body.trim();

    return [title.trim(), formattedBody].filter(Boolean).join('\n');
  }

  const built = buildQuantityModeLines({
    body,
    numberingEnabled,
    resetAfterBlankLine,
    lineQuantities,
    sortOrder,
    digitStyle,
  });

  const resultLines: string[] = [];
  if (title.trim()) {
    resultLines.push(title.trim());
  }
  resultLines.push(...built.lines);

  if (includeTotalQuantities && built.hasAnyQuantity) {
    const totalDigits = formatQuantityDigits(built.totalQuantity, digitStyle);
    resultLines.push(`المجموع: ${totalDigits}`);
  }

  return resultLines.join('\n');
}

export function formatNoteForWhatsApp(params: {
  title?: string;
  body: string;
  numberingEnabled?: boolean;
  resetAfterBlankLine?: boolean;
  totalText?: string | null;
  includeTotal?: boolean;
  quantitiesEnabled?: boolean;
  lineQuantities?: NoteLineQuantity[];
  sortOrder?: NoteCopySortOrder;
  digitStyle?: NoteCopyDigitStyle;
  includeTotalQuantities?: boolean;
}): string {
  const {
    title = '',
    body,
    numberingEnabled = false,
    resetAfterBlankLine = false,
    totalText = null,
    includeTotal = false,
    quantitiesEnabled = false,
    lineQuantities = [],
    sortOrder = 'as-written',
    digitStyle = 'western',
    includeTotalQuantities = false,
  } = params;

  if (!quantitiesEnabled) {
    const rawLines = body.split('\n');
    const nonEmptyLines: string[] = [];
    let counter = 1;
    for (let i = 0; i < rawLines.length; i++) {
      const trimmed = rawLines[i].trim();
      if (!trimmed) {
        if (resetAfterBlankLine) {
          counter = 1;
        }
        continue;
      }
      if (numberingEnabled) {
        nonEmptyLines.push(`${counter}. ${trimmed}`);
        counter++;
      } else {
        nonEmptyLines.push(trimmed);
      }
    }

    const lines: string[] = [];
    const trimmedTitle = title.trim();
    if (trimmedTitle) {
      lines.push(trimmedTitle);
    }
    lines.push(...nonEmptyLines);

    if (includeTotal && totalText && totalText.trim()) {
      lines.push(`المجموع: ${totalText.trim()}`);
    }

    return lines.join('\n');
  }

  const built = buildQuantityModeLines({
    body,
    numberingEnabled,
    resetAfterBlankLine,
    lineQuantities,
    sortOrder,
    digitStyle,
  });

  const lines: string[] = [];
  const trimmedTitle = title.trim();
  if (trimmedTitle) {
    lines.push(trimmedTitle);
  }
  lines.push(...built.lines);

  const appendedQtyTotal = includeTotalQuantities && built.hasAnyQuantity;
  if (appendedQtyTotal) {
    const totalDigits = formatQuantityDigits(built.totalQuantity, digitStyle);
    lines.push(`المجموع: ${totalDigits}`);
  }

  if (includeTotal && totalText && totalText.trim()) {
    const calcLine =
      appendedQtyTotal
        ? `مجموع الحسابات: ${totalText.trim()}`
        : `المجموع: ${totalText.trim()}`;
    lines.push(calcLine);
  }

  return lines.join('\n');
}

export function formatNoteWithDetails(params: {
  title: string;
  body: string;
  dateLabel?: string;
  numberingEnabled?: boolean;
  resetAfterBlankLine?: boolean;
  quantitiesEnabled?: boolean;
  lineQuantities?: NoteLineQuantity[];
  sortOrder?: NoteCopySortOrder;
  digitStyle?: NoteCopyDigitStyle;
  includeTotalQuantities?: boolean;
  calcTotalText?: string | null;
}): string {
  const {
    title,
    body,
    numberingEnabled = false,
    resetAfterBlankLine = false,
    quantitiesEnabled = false,
    lineQuantities = [],
    sortOrder = 'as-written',
    digitStyle = 'western',
    calcTotalText = null,
  } = params;

  const base = formatNoteForCopy({
    title,
    body,
    numberingEnabled,
    resetAfterBlankLine,
    quantitiesEnabled,
    lineQuantities,
    sortOrder,
    digitStyle,
    includeTotalQuantities: false,
  });

  const metaLines: string[] = [];
  if (calcTotalText && calcTotalText.trim()) {
    metaLines.push(`المجموع الحسابي: ${calcTotalText.trim()}`);
  }

  return [base, metaLines.join('\n')].filter(Boolean).join('\n\n');
}
