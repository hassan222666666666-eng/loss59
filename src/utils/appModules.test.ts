import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLaplacianVariance } from '../modules/camera/blurDetection';
import {
  calculateTargetDimensions,
  getVideoCaptureRotationDeg,
} from '../modules/camera/imageCompression';
import {
  LEFT_HALF_SLICE,
  RIGHT_HALF_SLICE,
  computeBoxOverlapRatio,
  mergeDuplicateShortages,
  remapHalfBoxToFullPhoto,
  rotateBox90CW,
  sortShortagesRTLTopToBottom,
} from '../modules/analysis/boxMerge';
import {
  descriptionSimilarity,
  rankCandidateProductsByDescription,
} from '../modules/analysis/productMatcher';
import {
  applyCalculatorKey,
  CalculatorState,
  computeNoteTotal,
  evaluateSafeMathExpression,
  getCalculatorLiveResult,
  parseNoteLineMath,
} from '../modules/notes/mathParser';
import { realignLinePhotosAfterEdit } from '../modules/notes/linePhotoAlignment';
import { formatNoteForCopy } from '../modules/notes/noteFormat';
import { KnownProduct } from '../types';
import {
  formatBytesArabic,
  getCutoffDateKey,
  isWithinLastDays,
  normalizeDigits,
  parsePositiveInt,
} from './arabicText';

test('normalizeDigits & parsePositiveInt handle Arabic-Indic and Latin digits', () => {
  assert.equal(normalizeDigits('١٢٣'), '123');
  assert.equal(parsePositiveInt('١٢'), 12);
  assert.equal(parsePositiveInt('6'), 6);
  assert.equal(parsePositiveInt('0'), null);
  assert.equal(parsePositiveInt('abc'), null);
});

test('getCutoffDateKey & isWithinLastDays compute retention cutoffs accurately', () => {
  const nov13 = new Date(2026, 10, 13, 12, 0, 0).getTime();
  assert.equal(getCutoffDateKey(1, nov13), '2026-11-13');
  assert.equal(getCutoffDateKey(3, nov13), '2026-11-11');
  assert.equal(getCutoffDateKey(7, nov13), '2026-11-07');

  assert.equal(isWithinLastDays('2026-11-13', 30, nov13), true);
  assert.equal(isWithinLastDays('2026-10-01', 30, nov13), false);
});

test('formatBytesArabic formats storage usage cleanly', () => {
  assert.equal(formatBytesArabic(0), '0 ك.ب');
  assert.equal(formatBytesArabic(2048), '2.0 ك.ب');
  assert.equal(formatBytesArabic(2 * 1024 * 1024), '2.00 م.ب');
});

test('calculateTargetDimensions caps longest side accurately for 2048px capture and 256px thumbnails', () => {
  assert.deepEqual(calculateTargetDimensions(4000, 3000, 2048), {
    width: 2048,
    height: 1536,
  });
  assert.deepEqual(calculateTargetDimensions(512, 512, 256), {
    width: 256,
    height: 256,
  });
});

test('computeLaplacianVariance distinguishes blurry flat region from sharp edge pattern', () => {
  const w = 10;
  const h = 10;
  const flat = new Uint8Array(w * h).fill(120);
  assert.equal(computeLaplacianVariance(flat, w, h), 0);

  const sharp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sharp[y * w + x] = (x + y) % 2 === 0 ? 20 : 230;
    }
  }
  assert.ok(computeLaplacianVariance(sharp, w, h) > 1000);
});

test('remapHalfBoxToFullPhoto and mergeDuplicateShortages deduplicate >40% overlapping boxes', () => {
  const leftGap = remapHalfBoxToFullPhoto(
    { x: 0.75, y: 0.2, w: 0.2, h: 0.25 },
    LEFT_HALF_SLICE
  );
  const rightGap = remapHalfBoxToFullPhoto(
    { x: 0.1, y: 0.21, w: 0.2, h: 0.24 },
    RIGHT_HALF_SLICE
  );
  assert.ok(computeBoxOverlapRatio(leftGap, rightGap) > 0.4);

  const merged = mergeDuplicateShortages([
    {
      productDescription: 'white and blue tall milk carton 1L',
      gapBox: leftGap,
      productBox: { x: 0.36, y: 0.2, w: 0.1, h: 0.25 },
      estimatedMissing: 2,
      confidence: 0.84,
    },
    {
      productDescription: 'white blue tall milk carton 1L',
      gapBox: rightGap,
      productBox: { x: 0.37, y: 0.21, w: 0.1, h: 0.24 },
      estimatedMissing: 3,
      confidence: 0.91,
    },
    {
      productDescription: 'orange juice metal can 240ml',
      gapBox: { x: 0.05, y: 0.2, w: 0.12, h: 0.25 },
      productBox: { x: 0.18, y: 0.2, w: 0.08, h: 0.25 },
      estimatedMissing: 1,
      confidence: 0.88,
    },
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].estimatedMissing, 3);
});

test('sortShortagesRTLTopToBottom orders right-to-left within each shelf row and top-to-bottom across rows', () => {
  const ordered = sortShortagesRTLTopToBottom([
    { id: 'bottom-left', gapBox: { x: 0.1, y: 0.65, w: 0.1, h: 0.2 } },
    { id: 'top-left', gapBox: { x: 0.15, y: 0.15, w: 0.1, h: 0.2 } },
    { id: 'top-right', gapBox: { x: 0.7, y: 0.17, w: 0.1, h: 0.2 } },
    { id: 'bottom-right', gapBox: { x: 0.72, y: 0.63, w: 0.1, h: 0.2 } },
  ]);

  assert.deepEqual(
    ordered.map((x) => x.id),
    ['top-right', 'top-left', 'bottom-right', 'bottom-left']
  );
});

test('rankCandidateProductsByDescription returns up to 6 most visually similar products', () => {
  const mkProd = (id: string, desc: string, updatedAt: number): KnownProduct => ({
    id,
    normalizedName: '',
    productName: '',
    productDescription: desc,
    thumbnailDataUrl: `data:image/jpeg;base64,${id}`,
    updatedAt,
  });

  const saved: KnownProduct[] = [
    mkProd('p1', 'green plastic olive oil bottle gold cap 500ml', 100),
    mkProd('p2', 'red aluminum soda can silver rim 330ml', 101),
    mkProd('p3', 'white plastic dairy milk bottle blue cap 1L', 102),
    mkProd('p4', 'yellow chip bag crispy snack pouch', 103),
    mkProd('p5', 'clear water plastic bottle blue cap 500ml', 104),
    mkProd('p6', 'brown glass coffee jar black lid', 105),
    mkProd('p7', 'red aluminum cola can white stripe 330ml', 106),
    mkProd('p8', 'purple shampoo bottle flip cap 400ml', 107),
  ];

  assert.ok(
    descriptionSimilarity(
      'red aluminum cola can 330ml',
      'red aluminum soda can silver rim 330ml'
    ) >
      descriptionSimilarity(
        'red aluminum cola can 330ml',
        'brown glass coffee jar black lid'
      )
  );

  const ranked = rankCandidateProductsByDescription(
    'red aluminum cola can silver top 330ml',
    saved,
    6
  );

  assert.equal(ranked.length, 6);
  const topIds = ranked.slice(0, 2).map((p) => p.id);
  assert.ok(topIds.includes('p2'));
  assert.ok(topIds.includes('p7'));
});

test('safe note mathParser evaluates arithmetic, Arabic numerals, labeled lines, and skips dates', () => {
  assert.equal(evaluateSafeMathExpression('2 + 3 * 4'), 14);
  assert.equal(evaluateSafeMathExpression('(2 + 3) * 4'), 20);
  assert.equal(evaluateSafeMathExpression('١٢ × ٢.٥ ÷ ٣'), 10);
  assert.equal(evaluateSafeMathExpression('10 / 0'), null);
  assert.equal(evaluateSafeMathExpression('2026-11-13'), null);
  assert.equal(evaluateSafeMathExpression('42'), null);

  const labeled = parseNoteLineMath('حليب 6 * 12');
  assert.equal(labeled.hasExpression, true);
  assert.equal(labeled.result, 72);

  const summary = computeNoteTotal('2026-11-13\nحليب 6 * 12\nعصير (4 + 2) × 3\nملاحظة عادية');
  assert.equal(summary.hasAnyCalculated, true);
  assert.equal(summary.total, 90);

  // Invalid or incomplete inline expressions are ignored
  assert.equal(evaluateSafeMathExpression('5 + + 2'), null);
  assert.equal(evaluateSafeMathExpression('5 * + 2'), null);
  assert.equal(evaluateSafeMathExpression('5 × -2'), -10);
  assert.equal(evaluateSafeMathExpression('005 + 1'), null);
  assert.equal(evaluateSafeMathExpression('(2 + 3'), null);
  assert.equal(parseNoteLineMath('حليب 5 + + 2').hasExpression, false);
});

test('interactive calculator enforces operator replacement, negative numbers, decimals, parens, leading zeros, and = continuation', () => {
  const press = (keys: string[], initial: CalculatorState = { expression: '', justEvaluated: false }) =>
    keys.reduce((s, k) => applyCalculatorKey(s, k), initial);

  // Disallow operator at start except minus
  assert.equal(press(['+', '×', '÷']).expression, '');
  assert.equal(press(['-', '5']).expression, '-5');

  // Operator replaces previous operator, EXCEPT '-' allowed after ×, ÷, '('
  assert.equal(press(['5', '+', '×', '÷', '2']).expression, '5÷2');
  assert.equal(press(['5', '×', '-', '2']).expression, '5×-2');
  assert.equal(press(['5', '×', '-', '+', '2']).expression, '5+2');
  assert.equal(press(['(', '+', '×', '-', '3', ')']).expression, '(-3)');

  // No two decimals in same number; leading '.' inserts '0.'
  assert.equal(press(['1', '.', '2', '.', '5']).expression, '1.25');
  assert.equal(press(['.', '5']).expression, '0.5');

  // No extra leading zeros
  assert.equal(press(['0', '0', '0']).expression, '0');
  assert.equal(press(['0', '5']).expression, '5');
  assert.equal(press(['0', '.', '0', '5']).expression, '0.05');

  // No ')' without matching '('
  assert.equal(press(['5', ')']).expression, '5');

  // Live result while typing, '=' converts to starting number, operator right after '=' continues
  const typing = press(['6', '×', '1', '2']);
  assert.equal(getCalculatorLiveResult(typing), 72);

  const eq = applyCalculatorKey(typing, '=');
  assert.deepEqual(eq, { expression: '72', justEvaluated: true });
  assert.equal(getCalculatorLiveResult(eq), null);

  const cont = applyCalculatorKey(eq, '+');
  assert.deepEqual(cont, { expression: '72+', justEvaluated: false });
  assert.equal(press(['8', '='], cont).expression, '80');
});

test('realignLinePhotosAfterEdit keeps side pictures aligned when lines are added, edited, or deleted', () => {
  const initial = [
    { lineIndex: 0, dataUrl: 'picA' },
    { lineIndex: 2, dataUrl: 'picC' },
  ];

  // Insert blank line after line 0 -> picA stays at 0, picC shifts 2 -> 3
  const afterInsert = realignLinePhotosAfterEdit(
    ['حليب', 'خبز', 'عصير'],
    ['حليب', '', 'خبز', 'عصير'],
    initial
  );
  assert.deepEqual(afterInsert, [
    { lineIndex: 0, dataUrl: 'picA' },
    { lineIndex: 3, dataUrl: 'picC' },
  ]);

  // Delete line 1 ('') -> picC shifts 3 -> 2
  const afterDelete = realignLinePhotosAfterEdit(
    ['حليب', '', 'خبز', 'عصير'],
    ['حليب', 'خبز', 'عصير'],
    afterInsert
  );
  assert.deepEqual(afterDelete, [
    { lineIndex: 0, dataUrl: 'picA' },
    { lineIndex: 2, dataUrl: 'picC' },
  ]);

  // Edit characters inside line 0 without line count change -> both stay anchored
  const afterEdit = realignLinePhotosAfterEdit(
    ['حليب', 'خبز', 'عصير'],
    ['حليب المراعي', 'خبز', 'عصير'],
    afterDelete
  );
  assert.deepEqual(afterEdit, [
    { lineIndex: 0, dataUrl: 'picA' },
    { lineIndex: 2, dataUrl: 'picC' },
  ]);
});

test('rotateBox90CW transforms normalized box coordinates clockwise and returns to origin after 4 turns', () => {
  const orig = { x: 0.2, y: 0.1, w: 0.3, h: 0.4 };
  const r1 = rotateBox90CW(orig);
  assert.deepEqual(r1, { x: 0.5, y: 0.2, w: 0.4, h: 0.3 });

  const r2 = rotateBox90CW(r1);
  const r3 = rotateBox90CW(r2);
  const r4 = rotateBox90CW(r3);
  assert.deepEqual(r4, orig);
});

test('getVideoCaptureRotationDeg detects portrait/landscape mismatches and flips accurately', () => {
  // Upright portrait preview with landscape sensor frame -> rotate 90 deg CW
  assert.equal(getVideoCaptureRotationDeg(1920, 1080, 390, 780, 0), 90);
  // Upright portrait preview already matching portrait sensor frame -> 0 deg
  assert.equal(getVideoCaptureRotationDeg(1080, 1920, 390, 780, 0), 0);
  // Upside-down portrait (180 deg screen angle) -> 180 or 270
  assert.equal(getVideoCaptureRotationDeg(1080, 1920, 390, 780, 180), 180);
  assert.equal(getVideoCaptureRotationDeg(1920, 1080, 390, 780, 180), 270);
  // Landscape preview with portrait frame -> 270 (or 90 if 270 screen angle)
  assert.equal(getVideoCaptureRotationDeg(1080, 1920, 780, 390, 90), 270);
  assert.equal(getVideoCaptureRotationDeg(1080, 1920, 780, 390, 270), 90);
});

test('formatNoteForCopy preserves exact order, numbering, and blank-line resets', () => {
  assert.equal(
    formatNoteForCopy({
      title: 'نقص المواد',
      body: 'كيك سوفلي\nستي كوز\n',
      numberingEnabled: true,
      resetAfterBlankLine: false,
    }),
    'نقص المواد\n1. كيك سوفلي\n2. ستي كوز'
  );

  assert.equal(
    formatNoteForCopy({
      title: 'مواد اليوم',
      body: 'حليب\nخبز\n\nعصير\nماء',
      numberingEnabled: true,
      resetAfterBlankLine: true,
    }),
    'مواد اليوم\n1. حليب\n2. خبز\n\n1. عصير\n2. ماء'
  );

  assert.equal(
    formatNoteForCopy({
      title: 'ملاحظة عادية',
      body: 'السطر الأول\nالسطر الثاني',
      numberingEnabled: false,
      resetAfterBlankLine: false,
    }),
    'ملاحظة عادية\nالسطر الأول\nالسطر الثاني'
  );
});

