/**
 * Shared note formatting utilities for copying notes identically to how they appear
 * in the editor (preserving title, exact line order, visual numbering, and blank-line resets).
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

export function formatNoteForCopy(params: {
  title: string;
  body: string;
  numberingEnabled?: boolean;
  resetAfterBlankLine?: boolean;
}): string {
  const { title, body, numberingEnabled = false, resetAfterBlankLine = false } = params;
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
