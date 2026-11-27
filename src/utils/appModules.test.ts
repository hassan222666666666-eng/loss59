import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  IFRAME_INSTALL_WARNING_TEXT,
  buildPwaDiagnosticsRows,
  formatPwaDiagnosticsClipboardText,
  shouldRegisterServiceWorker,
  validateManifestPayload,
} from '../pwa/pwaDiagnostics';
import { computeLaplacianVariance } from '../modules/camera/blurDetection';
import {
  calculateTargetDimensions,
  getVideoCaptureRotationDeg,
} from '../modules/camera/imageCompression';
import { computeStorageBreakdown } from '../modules/db/storageStats';
import {
  AUTO_FLASH_DEFAULTS,
  computeBrightnessMetricsFromRgba,
  createInitialAutoFlashState,
  isSceneDimForTorch,
  stepAutoFlashState,
} from '../modules/camera/autoFlashDecision';
import {
  applyCalculatorKey,
  CalculatorState,
  computeNoteTotal,
  evaluateSafeMathExpression,
  getCalculatorLiveResult,
  parseNoteLineMath,
} from '../modules/notes/mathParser';
import { realignLinePhotosAfterEdit } from '../modules/notes/linePhotoAlignment';
import {
  formatNoteForCopy,
  formatNoteForWhatsApp,
  formatNoteWithDetails,
} from '../modules/notes/noteFormat';
import {
  computeNoteQuantitiesSummary,
  computeToolbarVisibleCount,
  convertExistingNoteLinesToQuantities,
  countConvertibleTrailingLines,
  extractAutoTakeQuantityAndUnit,
  extractTrailingQuantity,
  formatQuantityUnitLabel,
  realignLineQuantitiesAfterEdit,
} from '../modules/notes/quantityLogic';
import {
  SimpleStorageLike,
  clearProductUnitMemory,
  forgetUnitForProduct,
  loadProductUnitMemory,
  normalizeProductNameForUnitMemory,
  rememberUnitForProduct,
  resolveQuantityUnit,
} from '../modules/notes/unitMemory';
import {
  buildWhatsAppSchemeUrl,
  buildWhatsAppUrl,
  isValidWhatsAppPhone,
  normalizePhoneNumberForWhatsApp,
  sortRecipientsMostRecentFirst,
  splitPhoneForEdit,
} from '../modules/notes/whatsapp';
import {
  analyzeFinishedLineDebug,
  compareNormalizedLineWords,
  deleteDuplicateLine,
  deleteDuplicateLinesBulk,
  findDuplicateForFinishedLine,
  makeDuplicatePairKey,
  mergeDuplicateLines,
  normalizeNoteLineProductName,
  normalizeNoteLineWords,
  scanNoteDuplicates,
} from '../modules/notes/duplicateDetector';
import { WhatsAppRecipient } from '../types';
import {
  LEGACY_AI_CLEANUP_STORAGE_KEY,
  hasLegacyPhotoAiFields,
  hasLegacySettingsAiFields,
  isLegacyAiCleanupDone,
  markLegacyAiCleanupDone,
  normalizeImportedBackup,
  sanitizePhotoRecord,
  sanitizeSettingsRecord,
} from '../modules/db/backupSanitizer';
import {
  formatBytesArabic,
  getCutoffDateKey,
  isWithinLastDays,
  normalizeDigits,
  parsePositiveInt,
} from './arabicText';
import {
  CAMERA_RETRY_DELAYS_MS,
  CAMERA_TAKE_PHOTO_TIMEOUT_MS,
  CAMERA_ZOOM_FOCUS_SETTLE_MS,
  acquireStreamWithTimeout,
  buildCameraConstraintAttempts,
  buildTakePhotoSettings,
  computeFocusSettleWaitMs,
  extractContinuousConstraints,
  extractMaxPhotoDimensions,
  isCameraBusyOrOverconstrainedError,
  isCameraPermissionDeniedError,
  isCameraStartTimeoutError,
  startCameraWithRetryLadder,
} from '../modules/camera/cameraStartup';
import {
  buildCameraDiagnosticsRows,
  formatCameraDiagnosticsClipboardText,
} from '../modules/camera/cameraDiagnostics';
import {
  ADAPTIVE_FPS_LOW_THRESHOLD,
  ADAPTIVE_FPS_SUSTAIN_MS,
  PERF_TEST_DURATION_MS,
  buildCameraPerfReport,
  computeVideoFrameStats,
  createAdaptivePreviewState,
  formatPerfReportText,
  getTargetPreviewDims,
  resolvePreviewResolutionSetting,
  stepAdaptivePreviewState,
  summarizeLongTasks,
} from '../modules/camera/cameraPerf';
import {
  ENHANCEMENT_IDLE_PAUSE_MS,
  SHUTTER_BACKGROUND_PAUSE_MS,
  __configureBackgroundQueueForTest,
  enqueueBatchedPhotoWrite,
  flushPendingPhotoWritesNow,
  getRemainingEnhancementIdleMs,
  getRemainingShutterPauseMs,
  isBatterySaverQueuePaused,
  notifyCameraActivity,
  notifyShutterPressed,
  runExclusiveWorkerTask,
  setBatterySaverActive,
  setCaptureTabActive,
  setPageHidden,
  waitForBackgroundSlot,
  waitForEnhancementSlot,
} from '../modules/camera/backgroundCameraQueue';
import {
  __resetSessionPowerTrackerForTest,
  buildBatteryMeasurementRows,
  evaluateBatterySaverActive,
  formatBatteryMeasurementClipboardText,
  formatSessionDurationArabic,
  getEffectiveCameraPowerProfile,
  getSessionCameraActiveMs,
  getSessionCaptureCount,
  incrementSessionCaptureCount,
  markCameraSessionStarted,
  markCameraSessionStopped,
  resolveBatterySaverMode,
  resolveCameraIdleTimeoutSec,
  resolvePreviewFrameRateSetting,
} from '../modules/power/batterySaver';
import {
  ENHANCE_TIMEOUT_MS,
  accumulateTileStats,
  applyToneAndColorInPlace,
  computeEnhancementPlan,
  createEmptyAnalyzeAccumulator,
  enhanceRgbaBuffer,
  finalizeImageStats,
  formatEnhanceLevelLabel,
  resolveEnhanceLevel,
} from '../modules/camera/photoEnhancement';
import {
  applyUnifiedTrackConstraints,
  buildUnifiedAdvancedConstraints,
  createDefaultCameraConstraintState,
  formatConstraintsError,
} from '../modules/camera/cameraConstraints';
import {
  areVideoDeviceLabelsEmpty,
  clampHardwareZoom,
  extractZoomRangeFromCapabilities,
  pickBestTorchCandidate,
  resolveAvailableZoomPresets,
  selectBackCameraCandidates,
} from '../modules/camera/cameraSelection';
import {
  FREEZE_OVERLAY_MAX_MS,
  MAX_CAPTURE_QUEUE_PENDING,
  MAX_SAVED_PHOTO_LONG_SIDE,
  SAVED_PHOTO_JPEG_QUALITY,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_LONG_SIDE,
  canAcceptCapture,
  completePendingCapture,
  computeFreezeDismissDelayMs,
  enqueuePendingCapture,
  formatCaptureModeLabel,
  resolveCaptureMode,
} from '../modules/camera/captureQueue';
import {
  DEFAULT_MUSIC_MAX_STORAGE_MB,
  MISSING_FILE_LABEL,
  MUSIC_FAB_COLOR_PRESETS,
  MUSIC_IDLE_FADE_DELAY_MS,
  MUSIC_IDLE_OPACITY,
  SLEEP_TIMER_PRESETS_MIN,
  buildMusicBackupTracks,
  canAddAudioBytes,
  clampFloatingButtonY,
  computeAudioContentHash,
  computeSleepTimerRemainingSec,
  deriveShortTrackName,
  filterPlaylistTracks,
  filterTracksByTabAndQuery,
  findMatchingMissingTrack,
  formatAudioTime,
  formatMusicImportSummary,
  formatSleepTimerBadge,
  getDefaultFloatingButtonY,
  getRecentPlayedTracks,
  isBrowserStorageLow,
  isDuplicateAudioFile,
  isDuplicateAudioTitleAndDuration,
  isDuplicateRadioStation,
  isSupportedAudioFile,
  isValidRadioUrl,
  makeAudioDuplicateKey,
  mergeImportedMusicTracks,
  normalizeAudioTitleForDuplicate,
  normalizeRadioStreamUrl,
  pickNextTrackIndex,
  reorderTrackList,
  resolveMusicFabColorPreset,
  stripAudioFileExtension,
} from '../modules/music/musicLogic';
import {
  AUDIO_PICKER_ACCEPT,
  supportsDirectorySelection,
} from '../modules/music/MusicAudioImporter';
import {
  TRACK_TILE_COLORS,
  extractEmbeddedCoverArtBytes,
  getTrackInitialLetter,
  hashTitleToColorIndex,
  resolveTrackTileColor,
} from '../modules/music/coverArt';
import {
  formatMediaErrorReason,
  formatPlaybackDiagnosticsText,
  resolveAudioMimeType,
  resolveInitialVolumeReset,
  resolvePlayVolumeState,
} from '../modules/music/musicPlaybackHelpers';
import {
  isMusicPlayingActive,
  setMusicPlayingActive,
} from '../modules/music/musicPlaybackFlag';
import { MusicTrackRecord } from '../modules/music/types';

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

test('calculateTargetDimensions caps longest side accurately and preserves full resolution when maxDim <= 0', () => {
  assert.deepEqual(calculateTargetDimensions(4000, 3000, 2048), {
    width: 2048,
    height: 1536,
  });
  assert.deepEqual(calculateTargetDimensions(512, 512, 256), {
    width: 256,
    height: 256,
  });
  assert.deepEqual(calculateTargetDimensions(4000, 3000, 0), {
    width: 4000,
    height: 3000,
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

test('autoFlashDecision detects dim auto-exposed scenes, turns on cleanly, and resists reflection flicker', () => {
  // Build 16x16 dark RGBA buffer (luma ~55)
  const darkPixels = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < darkPixels.length; i += 4) {
    darkPixels[i] = 55;
    darkPixels[i + 1] = 55;
    darkPixels[i + 2] = 55;
    darkPixels[i + 3] = 255;
  }
  const darkMetrics = computeBrightnessMetricsFromRgba(darkPixels);
  assert.equal(isSceneDimForTorch(darkMetrics), true);

  // Auto-exposed dim shelf (avg ~114 with >25% shadows and muted highlights) -> triggers dim assist
  assert.equal(
    isSceneDimForTorch({ avgLuma: 114, p90Luma: 140, darkRatio: 0.3 }),
    true
  );
  // Well-lit aisle -> stays off
  assert.equal(
    isSceneDimForTorch({ avgLuma: 155, p90Luma: 210, darkRatio: 0.04 }),
    false
  );

  // Step state: turns ON after hold time
  let state = createInitialAutoFlashState(false);
  let res = stepAutoFlashState(state, darkMetrics, 1000);
  assert.equal(res.desiredTorch, null);
  res = stepAutoFlashState(res.nextState, darkMetrics, 1250);
  assert.equal(res.desiredTorch, true);
  state = res.nextState;

  // Torch stays ON during 1400ms exposure settle even if reflection spikes bright
  const brightMetrics = { avgLuma: 180, p90Luma: 220, darkRatio: 0.02 };
  res = stepAutoFlashState(state, brightMetrics, 2000);
  assert.equal(res.desiredTorch, null);

  // After settle + 1000ms sustained bright scene, turns OFF cleanly
  res = stepAutoFlashState(res.nextState, brightMetrics, 2800);
  assert.equal(res.desiredTorch, null);
  res = stepAutoFlashState(res.nextState, brightMetrics, 3900);
  assert.equal(res.desiredTorch, false);
});

test('formatNoteForWhatsApp removes blank lines, preserves numbering/reset, and optionally appends total', () => {
  assert.equal(
    formatNoteForWhatsApp({
      title: 'طلبية اليوم',
      body: 'حليب\n\nخبز\n\nعصير\n',
      numberingEnabled: true,
      resetAfterBlankLine: true,
      totalText: '150',
      includeTotal: false,
    }),
    'طلبية اليوم\n1. حليب\n1. خبز\n1. عصير'
  );

  assert.equal(
    formatNoteForWhatsApp({
      body: 'حليب 6 * 12\n\nعصير 3 * 10\n',
      numberingEnabled: true,
      resetAfterBlankLine: false,
      totalText: '102',
      includeTotal: true,
    }),
    '1. حليب 6 * 12\n2. عصير 3 * 10\nالمجموع: 102'
  );
});

test('WhatsApp phone normalization defaults +964, removes leading 0, builds wa.me URLs, and sorts recipients by recent use', () => {
  assert.equal(normalizePhoneNumberForWhatsApp('0770 123 4567'), '9647701234567');
  assert.equal(normalizePhoneNumberForWhatsApp('7701234567'), '9647701234567');
  assert.equal(normalizePhoneNumberForWhatsApp('+964 0770-123-4567'), '9647701234567');
  assert.equal(normalizePhoneNumberForWhatsApp('00964 7701234567'), '9647701234567');
  assert.equal(normalizePhoneNumberForWhatsApp('٠٧٧٠١٢٣٤٥٦٧'), '9647701234567');
  assert.equal(normalizePhoneNumberForWhatsApp('0501234567', '+966'), '966501234567');

  assert.equal(isValidWhatsAppPhone('9647701234567'), true);
  assert.equal(isValidWhatsAppPhone('12345'), false);

  assert.deepEqual(splitPhoneForEdit('9647701234567'), {
    countryCode: '+964',
    localNumber: '7701234567',
  });

  assert.equal(
    buildWhatsAppUrl('مرحبا\n1. حليب', '9647701234567'),
    'https://wa.me/9647701234567?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%0A1.%20%D8%AD%D9%84%D9%8A%D8%A8'
  );
  assert.equal(buildWhatsAppUrl('مرحبا'), 'https://wa.me/?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7');
  assert.equal(
    buildWhatsAppSchemeUrl('مرحبا'),
    'whatsapp://send?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7'
  );

  const list: WhatsAppRecipient[] = [
    { id: 'a', name: 'أحمد', phone: '9647700000001', lastUsedAt: 1000, createdAt: 500, updatedAt: 1000 },
    { id: 'b', name: 'سعد', phone: '9647700000002', lastUsedAt: 5000, createdAt: 600, updatedAt: 5000 },
    { id: 'c', name: 'خالد', phone: '9647700000003', createdAt: 2000, updatedAt: 2000 },
  ];
  assert.deepEqual(
    sortRecipientsMostRecentFirst(list).map((r) => r.id),
    ['b', 'a', 'c']
  );
});

test('duplicateDetector strictly compares word by word, keeps numbers/weights, joins number+unit, and skips digit-only lines', () => {
  // Normalization: diacritics, tatweel, alef/ya/ta marbuta, Arabic digits, numbering prefix, joined units
  assert.deepEqual(normalizeNoteLineWords('1. قوطية لحم دجاج ٢٠٠ غ'), [
    'قوطيه',
    'لحم',
    'دجاج',
    '200غ',
  ]);
  assert.deepEqual(normalizeNoteLineWords('2) حليب المراعي ١.٥ لتر'), [
    'حليب',
    'المراعي',
    '1.5لتر',
  ]);
  assert.equal(normalizeNoteLineProductName('عمبة باردة'), 'عمبه بارده');
  assert.equal(normalizeNoteLineProductName('عمبه باردة'), 'عمبه بارده');

  // Lines with NO letters (digits & operators only) normalize to [] and are never compared
  assert.deepEqual(normalizeNoteLineWords('6 * 12'), []);
  assert.deepEqual(normalizeNoteLineWords('100 + 25'), []);
  assert.deepEqual(normalizeNoteLineWords('٤٢'), []);

  // "200غ" and "200 غ" count as the same; "200غ" and "850 غ" are different
  assert.equal(
    compareNormalizedLineWords(
      normalizeNoteLineWords('قوطية لحم دجاج 200غ'),
      normalizeNoteLineWords('قوطية لحم دجاج ٢٠٠ غ')
    ).isMatch,
    true
  );
  assert.equal(
    compareNormalizedLineWords(
      normalizeNoteLineWords('قوطية لحم دجاج 200غ'),
      normalizeNoteLineWords('قوطية لحم دجاج 850 غ')
    ).isMatch,
    false
  );

  // Strict word rule: any different, added, or missing word is NOT a duplicate
  assert.equal(
    compareNormalizedLineWords(
      normalizeNoteLineWords('قوطية لحم دجاج 200غ'),
      normalizeNoteLineWords('قوطية لحم بقري 200غ')
    ).isMatch,
    false
  );
  assert.equal(
    compareNormalizedLineWords(
      normalizeNoteLineWords('دبس رمان زير'),
      normalizeNoteLineWords('دبس رمان جوكر')
    ).isMatch,
    false
  );
  assert.equal(
    compareNormalizedLineWords(
      normalizeNoteLineWords('شاي ليبتون'),
      normalizeNoteLineWords('شاي ليبتون احمر')
    ).isMatch,
    false
  );

  // Same set of words with Arabic variants or different word order -> duplicate
  assert.equal(
    compareNormalizedLineWords(
      normalizeNoteLineWords('عمبة باردة'),
      normalizeNoteLineWords('عمبه باردة')
    ).isMatch,
    true
  );
  assert.equal(
    compareNormalizedLineWords(
      normalizeNoteLineWords('دجاج لحم قوطية 200غ'),
      normalizeNoteLineWords('قوطية لحم دجاج 200 غ')
    ).isMatch,
    true
  );

  // 1-char typo allowed ONLY inside a single word of >= 5 letters and no differing number/weight
  const typoMatch = compareNormalizedLineWords(
    normalizeNoteLineWords('شامبو صانسيلك'),
    normalizeNoteLineWords('شامبو سانسيلك')
  );
  assert.equal(typoMatch.isMatch, true);
  assert.equal(typoMatch.reason, 'one_char_typo');

  // Short word (< 5 letters) with 1-char difference is NOT allowed ("زير" vs "زيت")
  assert.equal(
    compareNormalizedLineWords(
      normalizeNoteLineWords('دبس رمان زير'),
      normalizeNoteLineWords('دبس رمان زيت')
    ).isMatch,
    false
  );

  // Digit-only lines never match each other
  const mathOnly = findDuplicateForFinishedLine({
    lines: ['6 * 12', '6 * 12'],
    finishedLineIndex: 1,
  });
  assert.equal(mathOnly, null);
});

test('duplicateDetector finds finished-line duplicates, deletes with aligned photos, respects kept/ignored pairs, and reports words in debug', () => {
  const matchRes = findDuplicateForFinishedLine({
    lines: ['عمبة باردة', 'خبز أبيض', 'عَمْبَه بَارِدَةٌ'],
    finishedLineIndex: 2,
  });
  assert.ok(matchRes);
  assert.equal(matchRes.reason, 'exact_words');
  assert.equal(matchRes.matchLineIndex, 0);
  assert.equal(matchRes.matchLineNumber, 1);

  const deleted = deleteDuplicateLine({
    body: 'عمبة باردة\nخبز أبيض\nعمبه باردة',
    linePhotos: [
      { lineIndex: 0, dataUrl: 'p0' },
      { lineIndex: 1, dataUrl: 'p1' },
    ],
    deleteIndex: 2,
  });
  assert.equal(deleted.body, 'عمبة باردة\nخبز أبيض');
  assert.deepEqual(deleted.linePhotos, [
    { lineIndex: 0, dataUrl: 'p0' },
    { lineIndex: 1, dataUrl: 'p1' },
  ]);

  const suppressed = findDuplicateForFinishedLine({
    lines: ['عمبة باردة', 'خبز أبيض', 'عمبه باردة'],
    finishedLineIndex: 2,
    ignoredPairKeys: new Set<string>([matchRes.pairKey]),
  });
  assert.equal(suppressed, null);
});

test('scanNoteDuplicates groups strict duplicates cleanly, excludes kept & active line, deletes bulk, and shows compared words in debug', () => {
  const lines = [
    'قوطية لحم دجاج 200غ',
    'قوطية لحم بقري 200غ', // different word ("بقري" vs "دجاج") -> NOT duplicate
    'قوطية لحم دجاج ٢٠٠ غ', // exact duplicate with 0
    'دبس رمان زير',
    'دبس رمان جوكر', // different brand ("جوكر" vs "زير") -> NOT duplicate
    '6 * 12',
    'عمبة باردة',
    'عمبه باردة', // duplicate with 6
  ];

  // Symmetric pairKey regardless of argument order
  assert.equal(
    makeDuplicatePairKey(0, 2, 'قوطيه لحم دجاج 200غ', 'قوطيه لحم دجاج 200غ'),
    makeDuplicatePairKey(2, 0, 'قوطيه لحم دجاج 200غ', 'قوطيه لحم دجاج 200غ')
  );

  // Full scan groups [0, 2] and [6, 7]; ignores non-duplicates 1, 3, 4 and math line 5
  const scan = scanNoteDuplicates({ lines });
  assert.equal(scan.groups.length, 2);
  assert.equal(scan.totalExtraDuplicates, 2);
  assert.deepEqual(
    scan.groups[0].items.map((it) => it.lineIndex),
    [0, 2]
  );
  assert.deepEqual(
    scan.groups[1].items.map((it) => it.lineIndex),
    [6, 7]
  );
  assert.equal(scan.duplicateBadgeLineIndices.has(1), false);
  assert.equal(scan.duplicateBadgeLineIndices.has(3), false);
  assert.equal(scan.duplicateBadgeLineIndices.has(4), false);
  assert.equal(scan.duplicateBadgeLineIndices.has(5), false);

  // Keeping group 2 pairs removes group 2 from scan & clears its badges
  const kept = new Set<string>(scan.groups[1].pairKeys);
  const afterKeep = scanNoteDuplicates({ lines, keptPairKeys: kept });
  assert.equal(afterKeep.groups.length, 1);
  assert.equal(afterKeep.duplicateBadgeLineIndices.has(6), false);
  assert.equal(afterKeep.duplicateBadgeLineIndices.has(7), false);

  // Excluding active typing line 7 keeps it unflagged mid-typing
  const whileTypingLine7 = scanNoteDuplicates({ lines, excludeLineIndex: 7 });
  assert.equal(whileTypingLine7.groups.length, 1);

  // Bulk deleting extra duplicate lines keeps line photos aligned
  const bulkDel = deleteDuplicateLinesBulk({
    body: lines.join('\n'),
    linePhotos: [
      { lineIndex: 0, dataUrl: 'pic0' },
      { lineIndex: 6, dataUrl: 'pic6' },
    ],
    deleteIndices: [2],
  });
  assert.equal(bulkDel.body.split('\n').length, 7);
  assert.deepEqual(bulkDel.linePhotos, [
    { lineIndex: 0, dataUrl: 'pic0' },
    { lineIndex: 5, dataUrl: 'pic6' },
  ]);

  // Debug diagnostics report compared words and rejection reason
  const debugMismatch = analyzeFinishedLineDebug({
    lines,
    finishedLineIndex: 1,
  });
  assert.ok(debugMismatch);
  assert.deepEqual(debugMismatch.words, ['قوطيه', 'لحم', 'بقري', '200غ']);
  assert.equal(debugMismatch.closestLineIndex, 0);
  assert.deepEqual(debugMismatch.closestWords, ['قوطيه', 'لحم', 'دجاج', '200غ']);
  assert.equal(debugMismatch.isMatch, false);

  const debugMathSkip = analyzeFinishedLineDebug({
    lines,
    finishedLineIndex: 5,
  });
  assert.ok(debugMathSkip);
  assert.deepEqual(debugMathSkip.words, []);
  assert.ok(debugMathSkip.skipReason);
});

test('cameraStartup constraint ladder, error classifiers, late timeout cleanup, and retry delays behave reliably', async () => {
  assert.deepEqual([...CAMERA_RETRY_DELAYS_MS], [500, 1000, 2000]);
  const hqLadder = buildCameraConstraintAttempts(true);
  assert.equal(hqLadder.length, 4);
  assert.deepEqual(hqLadder[0], {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { min: 1280, ideal: 1920 },
      height: { min: 720, ideal: 1080 },
      frameRate: { ideal: 30 },
    },
  });
  assert.deepEqual(hqLadder[3], { audio: false, video: true });

  const stdLadder = buildCameraConstraintAttempts(false);
  assert.deepEqual(stdLadder[0], {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });

  // Photo capabilities max dimensions, takePhoto settings, continuous modes, and zoom settle delay
  assert.deepEqual(
    extractMaxPhotoDimensions({
      imageWidth: { min: 640, max: 4032 },
      imageHeight: { min: 480, max: 3024 },
    }),
    { imageWidth: 4032, imageHeight: 3024 }
  );
  assert.deepEqual(
    extractMaxPhotoDimensions({
      photoWidth: { min: 640, max: 3840 },
      photoHeight: { min: 480, max: 2160 },
    }),
    { imageWidth: 3840, imageHeight: 2160 }
  );
  assert.deepEqual(
    buildTakePhotoSettings({
      fillLightMode: 'flash',
      maxPhotoDims: { imageWidth: 4032, imageHeight: 3024 },
    }),
    { fillLightMode: 'flash', imageWidth: 4032, imageHeight: 3024 }
  );
  assert.deepEqual(
    buildTakePhotoSettings({
      fillLightMode: 'flash',
      torchActive: true,
      maxPhotoDims: { imageWidth: 4032, imageHeight: 3024 },
    }),
    { imageWidth: 4032, imageHeight: 3024 }
  );
  assert.equal(buildTakePhotoSettings({}), undefined);

  const cont = extractContinuousConstraints({
    focusMode: ['manual', 'continuous'],
    exposureMode: ['continuous'],
    whiteBalanceMode: ['auto'],
  });
  assert.deepEqual(cont.combined, {
    focusMode: 'continuous',
    exposureMode: 'continuous',
  });
  assert.equal(cont.individual.length, 2);

  assert.equal(CAMERA_ZOOM_FOCUS_SETTLE_MS, 300);
  assert.equal(computeFocusSettleWaitMs(1000, 1120), 180);
  assert.equal(computeFocusSettleWaitMs(1000, 1350), 0);
  assert.equal(computeFocusSettleWaitMs(0, 1120), 0);

  assert.equal(isCameraPermissionDeniedError({ name: 'NotAllowedError' }), true);
  assert.equal(isCameraPermissionDeniedError({ name: 'NotReadableError' }), false);
  assert.equal(isCameraBusyOrOverconstrainedError({ name: 'NotReadableError' }), true);
  assert.equal(isCameraBusyOrOverconstrainedError({ name: 'OverconstrainedError' }), true);

  // Late-resolving stream after timeout must automatically stop its tracks
  let lateStopped = false;
  const lateStream = {
    getTracks: () => [
      {
        stop: () => {
          lateStopped = true;
        },
      },
    ],
  } as unknown as MediaStream;

  await assert.rejects(
    acquireStreamWithTimeout(
      () =>
        new Promise<MediaStream>((resolve) => {
          setTimeout(() => resolve(lateStream), 30);
        }),
      { video: true },
      5
    ),
    (err) => isCameraStartTimeoutError(err)
  );
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(lateStopped, true);

  // Retry ladder recovers on 3rd attempt using 500ms, 1000ms waits
  const mockStream = {
    getTracks: () => [{ stop: () => {} }],
  } as unknown as MediaStream;
  const retryWaits: number[] = [];
  let attemptCount = 0;
  const stream = await startCameraWithRetryLadder({
    getUserMedia: async () => {
      attemptCount++;
      if (attemptCount === 1) throw { name: 'OverconstrainedError' };
      if (attemptCount === 2) throw { name: 'NotReadableError' };
      return mockStream;
    },
    sleep: async (ms) => {
      retryWaits.push(ms);
    },
  });
  assert.equal(stream, mockStream);
  assert.equal(attemptCount, 3);
  assert.deepEqual(retryWaits, [500, 1000]);
});

test('cameraConstraints builds single combined advanced payload and preserves torch across zoom/focus updates', async () => {
  const fullCaps = {
    torch: true,
    zoom: { min: 1, max: 4, step: 0.1 },
    focusMode: ['manual', 'continuous'],
    exposureMode: ['continuous'],
    whiteBalanceMode: ['auto'], // continuous not supported here
  };

  const state = createDefaultCameraConstraintState();
  state.torch = true;
  state.zoom = 2.5;

  const built = buildUnifiedAdvancedConstraints(state, fullCaps);
  assert.deepEqual(built, {
    advanced: [
      {
        torch: true,
        zoom: 2.5,
        focusMode: 'continuous',
        exposureMode: 'continuous',
      },
    ],
  });

  // Unsupported capabilities -> returns null without crashing
  assert.equal(buildUnifiedAdvancedConstraints(state, { whiteBalanceMode: ['manual'] }), null);

  // Mock track verifying single applyConstraints call preserves all fields & reads back settings
  const sentConstraints: MediaTrackConstraints[] = [];
  let currentSettings: Record<string, unknown> = {
    torch: false,
    zoom: 1,
    focusMode: 'continuous',
    exposureMode: 'continuous',
  };
  const fakeTrack = {
    readyState: 'live' as const,
    getCapabilities: () => fullCaps,
    getSettings: () => ({ ...currentSettings }),
    applyConstraints: async (c?: MediaTrackConstraints) => {
      if (c) sentConstraints.push(c);
      const adv = (c?.advanced?.[0] ?? {}) as Record<string, unknown>;
      currentSettings = { ...adv };
    },
  };

  const resOn = await applyUnifiedTrackConstraints(fakeTrack, state);
  assert.equal(sentConstraints.length, 1);
  assert.equal(resOn.applied, true);
  assert.equal(resOn.torchSupported, true);
  assert.equal(resOn.requestedTorch, true);
  assert.equal(resOn.actualTorch, true);
  assert.equal(resOn.errorMessage, null);

  // Changing zoom must still include torch: true in that single call
  state.zoom = 3;
  const resZoom = await applyUnifiedTrackConstraints(fakeTrack, state);
  assert.equal(sentConstraints.length, 2);
  assert.equal(resZoom.actualTorch, true);
  assert.deepEqual(sentConstraints[1], {
    advanced: [
      {
        torch: true,
        zoom: 3,
        focusMode: 'continuous',
        exposureMode: 'continuous',
      },
    ],
  });

  // Rejected applyConstraints surfaces clean errorMessage and reports real getSettings().torch
  const rejectingTrack = {
    readyState: 'live' as const,
    getCapabilities: () => fullCaps,
    getSettings: () => ({ torch: false, zoom: 1 }),
    applyConstraints: async () => {
      const err = new Error('Torch rejected by driver');
      err.name = 'OverconstrainedError';
      throw err;
    },
  };
  const resErr = await applyUnifiedTrackConstraints(rejectingTrack, state);
  assert.equal(resErr.applied, false);
  assert.equal(resErr.requestedTorch, true);
  assert.equal(resErr.actualTorch, false);
  assert.ok(resErr.errorMessage?.includes('Torch rejected'));
});

test('cameraDiagnostics formats mode, timestamp, stage timings, saved photo size, takePhoto, torch states, error, constraints, and clipboard text cleanly', () => {
  const info = {
    previewWidth: 1920,
    previewHeight: 1080,
    frameRate: 30,
    takePhotoSupported: true,
    maxPhotoWidth: 4032,
    maxPhotoHeight: 3024,
    focusMode: 'continuous',
    exposureMode: 'continuous',
    lastCaptureMode: 'high-quality' as const,
    lastCaptureTimestamp: 1700000000000,
    lastCaptureMs: 240,
    lastProcessingMs: 85,
    lastSavingMs: 14,
    lastSavedPhotoWidth: 4032,
    lastSavedPhotoHeight: 3024,
    lastSavedPhotoBytes: 2 * 1024 * 1024,
    lastSavedPhotoMethod: 'takePhoto' as const,
    torchSupported: true,
    requestedTorch: true,
    actualTorch: false,
    lastApplyConstraintsError: 'OverconstrainedError: busy',
    lastAppliedConstraints: {
      advanced: [{ torch: true, zoom: 2, focusMode: 'continuous' }],
    },
  };
  const rows = buildCameraDiagnosticsRows(info);
  assert.equal(rows.length, 12);
  assert.equal(rows[0].label, 'نمط الالتقاط');
  assert.equal(rows[0].value, 'جودة عالية');
  assert.equal(rows[1].label, 'وقت آخر التقاط');
  assert.notEqual(rows[1].value, 'لم يُلتقط بعد');
  assert.ok(rows[2].value.includes('التقاط: 240 م.ث'));
  assert.ok(rows[2].value.includes('معالجة: 85 م.ث'));
  assert.ok(rows[2].value.includes('حفظ: 14 م.ث'));
  assert.ok(rows[3].value.includes('4032 × 3024'));
  assert.ok(rows[3].value.includes('2.00 م.ب'));
  assert.ok(rows[4].value.includes('1920 × 1080'));
  assert.ok(rows[5].value.includes('مدعوم'));
  assert.ok(rows[6].value.includes('continuous'));
  assert.equal(rows[7].value, 'نعم');
  assert.ok(rows[8].value.includes('ON'));
  assert.ok(rows[9].value.includes('OFF'));
  assert.ok(rows[10].value.includes('OverconstrainedError: busy'));
  assert.ok(rows[11].value.includes('"torch":true'));

  const text = formatCameraDiagnosticsClipboardText(info);
  assert.ok(text.includes('معلومات الكاميرا:'));
  assert.ok(text.includes('4032 × 3024'));
  assert.ok(text.includes('2.00 م.ب'));
  assert.ok(text.includes('دعم الفلاش'));
  assert.ok(text.includes('OverconstrainedError: busy'));
});

test('cameraSelection prefers main back camera, caps candidates at 4, picks torch winner, and detects empty labels', () => {
  assert.equal(
    areVideoDeviceLabelsEmpty([
      { kind: 'videoinput', deviceId: '1', label: '' },
      { kind: 'videoinput', deviceId: '2', label: '   ' },
    ]),
    true
  );
  assert.equal(
    areVideoDeviceLabelsEmpty([
      { kind: 'videoinput', deviceId: '1', label: '' },
      { kind: 'videoinput', deviceId: '2', label: 'camera2 0, facing back' },
    ]),
    false
  );

  const devices = [
    { kind: 'videoinput', deviceId: 'front-1', label: 'camera2 1, facing front' },
    { kind: 'videoinput', deviceId: 'back-wide', label: 'camera2 2, facing back ultra wide' },
    { kind: 'videoinput', deviceId: 'back-macro', label: 'camera2 3, facing back macro' },
    { kind: 'videoinput', deviceId: 'back-main', label: 'camera2 0, facing back' },
    { kind: 'videoinput', deviceId: 'back-tele', label: 'camera2 4, facing back tele' },
    { kind: 'videoinput', deviceId: 'back-depth', label: 'camera2 5, facing back depth' },
  ];

  const selected = selectBackCameraCandidates(devices, 4);
  assert.equal(selected.length, 4);
  assert.equal(selected[0].deviceId, 'back-main');
  assert.equal(selected[0].isPreferredMainBack, true);
  assert.equal(selected.some((c) => c.deviceId === 'front-1'), false);

  const probed = [
    { ...selected[0], torchSupported: false, probed: true },
    { ...selected[1], torchSupported: true, probed: true },
    { ...selected[2], torchSupported: true, probed: true },
    { ...selected[3], torchSupported: false, probed: true },
  ];
  assert.equal(pickBestTorchCandidate(probed)?.deviceId, selected[1].deviceId);

  // If main back supports torch, it always wins even if another lens also supports torch
  const mainTorch = [
    { ...selected[1], torchSupported: true, probed: true },
    { ...selected[0], torchSupported: true, probed: true },
  ];
  assert.equal(pickBestTorchCandidate(mainTorch)?.deviceId, 'back-main');
  assert.equal(
    pickBestTorchCandidate([
      { ...selected[0], torchSupported: false, probed: true },
    ]),
    null
  );

  assert.deepEqual(
    extractZoomRangeFromCapabilities({ zoom: { min: 1, max: 8, step: 0.1 } }),
    { min: 1, max: 8, step: 0.1 }
  );
  assert.equal(extractZoomRangeFromCapabilities({ zoom: { min: 1, max: 1 } }), undefined);
});

test('cameraStartup locks targetDeviceId across all retries and formatConstraintsError preserves exact error details', () => {
  const lockedAttempts = buildCameraConstraintAttempts(true, 'back-main-id');
  assert.equal(lockedAttempts.length, 4);
  for (const attempt of lockedAttempts) {
    const video = attempt.video as MediaTrackConstraints;
    assert.deepEqual(video.deviceId, { exact: 'back-main-id' });
    assert.equal('facingMode' in video, false);
  }
  assert.deepEqual(
    (lockedAttempts[0].video as MediaTrackConstraints).width,
    { ideal: 1920 }
  );
  assert.deepEqual(lockedAttempts[3], {
    audio: false,
    video: { deviceId: { exact: 'back-main-id' } },
  });

  const overErr = {
    name: 'OverconstrainedError',
    constraint: 'torch',
    message: 'Torch not supported on this lens',
  };
  assert.equal(
    formatConstraintsError(overErr),
    'OverconstrainedError (torch): Torch not supported on this lens'
  );
  const notSupErr = new Error('Flash hardware busy');
  notSupErr.name = 'NotSupportedError';
  assert.equal(
    formatConstraintsError(notSupErr),
    'NotSupportedError: Flash hardware busy'
  );
});

test('cameraDiagnostics lists candidate cameras with torch/zoom/active marker in rows and clipboard text', () => {
  const info = {
    torchSupported: true,
    activeCameraDeviceId: 'cam-main',
    candidates: [
      {
        deviceId: 'cam-main',
        label: 'camera2 0, facing back',
        index: 0,
        isPreferredMainBack: true,
        torchSupported: true,
        zoomMin: 1,
        zoomMax: 8,
        zoomStep: 0.1,
        probed: true,
      },
      {
        deviceId: 'cam-wide',
        label: 'camera2 2, facing back wide',
        index: 1,
        isPreferredMainBack: false,
        torchSupported: false,
        zoomMin: 0.6,
        zoomMax: 1,
        zoomStep: 0.1,
        probed: true,
        probeError: 'NotSupportedError: no torch',
      },
    ],
  };

  const rows = buildCameraDiagnosticsRows(info);
  assert.equal(rows.length, 14);
  assert.equal(rows[12].label, 'كاميرا 1 (المستخدمة)');
  assert.ok(rows[12].value.includes('camera2 0, facing back'));
  assert.ok(rows[12].value.includes('فلاش: نعم'));
  assert.ok(rows[12].value.includes('تقريب: 1–8x'));
  assert.equal(rows[13].label, 'كاميرا 2');
  assert.ok(rows[13].value.includes('فلاش: لا'));
  assert.ok(rows[13].value.includes('NotSupportedError: no torch'));

  const clipboard = formatCameraDiagnosticsClipboardText(info);
  assert.ok(clipboard.includes('كاميرا 1 (المستخدمة)'));
  assert.ok(clipboard.includes('فلاش: نعم'));
  assert.ok(clipboard.includes('فلاش: لا'));
});

test('musicLogic handles filenames, time formatting, storage limits, and low-storage checks', () => {
  assert.equal(stripAudioFileExtension('track-01.mp3'), 'track-01');
  assert.equal(stripAudioFileExtension('أنشودة. الصباح.wav'), 'أنشودة. الصباح');
  assert.equal(formatAudioTime(0), '00:00');
  assert.equal(formatAudioTime(75), '01:15');
  assert.equal(formatAudioTime(3661), '1:01:01');
  assert.equal(formatAudioTime(Number.NaN), '00:00');

  assert.equal(DEFAULT_MUSIC_MAX_STORAGE_MB, 500);
  const underCap = canAddAudioBytes(100 * 1024 * 1024, 50 * 1024 * 1024, 500);
  assert.equal(underCap.ok, true);
  const overCap = canAddAudioBytes(490 * 1024 * 1024, 20 * 1024 * 1024, 500);
  assert.equal(overCap.ok, false);

  assert.equal(isBrowserStorageLow(900, 1000), true);
  assert.equal(isBrowserStorageLow(100 * 1024 * 1024, 1000 * 1024 * 1024), false);
  assert.equal(isValidRadioUrl('https://stream.example.com/live.mp3'), true);
  assert.equal(isValidRadioUrl('http://radio.local:8000/stream'), true);
  assert.equal(isValidRadioUrl('ftp://invalid.com/a.mp3'), false);
  assert.equal(isValidRadioUrl('not-a-url'), false);
});

test('musicLogic handles playlist navigation, repeat, shuffle, failed-track loop prevention, reorder & search', () => {
  const makeTrack = (
    id: string,
    title: string,
    order: number,
    overrides: Partial<MusicTrackRecord> = {}
  ): MusicTrackRecord => ({
    id,
    kind: 'file',
    title,
    duration: 120,
    size: 1024,
    order,
    createdAt: 1000 + order,
    updatedAt: 1000 + order,
    ...overrides,
  });

  const tracks: MusicTrackRecord[] = [
    makeTrack('t1', 'مقطع أول', 0),
    makeTrack('t2', 'مفقود', 1, { missingFile: true }),
    makeTrack('t3', 'إذاعة مباشرة', 2, {
      kind: 'radio',
      streamUrl: 'https://radio.example/stream',
    }),
    makeTrack('t4', 'مقطع رابع', 3),
  ];

  // Skips missingFile track (index 1) cleanly
  assert.equal(pickNextTrackIndex(tracks, 0, false, 'off', 'next'), 2);
  // Stops at end when repeat === 'off'
  assert.equal(pickNextTrackIndex(tracks, 3, false, 'off', 'next'), -1);
  // Wraps around when repeat === 'all'
  assert.equal(pickNextTrackIndex(tracks, 3, false, 'all', 'next'), 0);
  // Stays on same track when repeat === 'one'
  assert.equal(pickNextTrackIndex(tracks, 2, false, 'one', 'next'), 2);
  // Shuffle avoids repeating current index when other tracks exist
  assert.notEqual(pickNextTrackIndex(tracks, 0, true, 'all', 'next', undefined, () => 0.1), 0);
  // Prevents infinite loop when all playable tracks failed
  const allFailed = new Set(['t1', 't3', 't4']);
  assert.equal(pickNextTrackIndex(tracks, 0, false, 'all', 'next', allFailed), -1);

  // Reorder up / down
  const movedUp = reorderTrackList(tracks, 't3', 'up');
  assert.deepEqual(
    movedUp.map((t) => t.id),
    ['t1', 't3', 't2', 't4']
  );
  // Search filter
  assert.equal(filterPlaylistTracks(tracks, 'إذاعة').length, 1);
  assert.equal(filterPlaylistTracks(tracks, 'رابع')[0]?.id, 't4');
});

test('musicLogic builds backup without blobs and flags missing files upon restore', () => {
  const original: MusicTrackRecord[] = [
    {
      id: 'f1',
      kind: 'file',
      title: 'ملف محلي',
      fileName: 'local-song.mp3',
      duration: 180,
      size: 500000,
      order: 0,
      createdAt: 100,
      updatedAt: 100,
    },
    {
      id: 'r1',
      kind: 'radio',
      title: 'راديو الصباح',
      streamUrl: 'https://example.com/live',
      duration: 0,
      size: 0,
      order: 1,
      createdAt: 200,
      updatedAt: 200,
    },
  ];

  const backup = buildMusicBackupTracks(original);
  assert.equal(backup.length, 2);
  assert.equal('blob' in (backup[0] as unknown as Record<string, unknown>), false);

  // Restore on a clean device with zero local blobs
  const restored = mergeImportedMusicTracks([], new Set(), backup);
  assert.equal(restored.length, 2);
  assert.equal(restored[0].missingFile, true);
  assert.equal(restored[1].missingFile, false);
  assert.equal(restored[1].streamUrl, 'https://example.com/live');
  assert.equal(MISSING_FILE_LABEL, 'الملف غير موجود، أعد إضافته');

  // Re-adding a file matching filename matches missing track automatically
  const matched = findMatchingMissingTrack(restored, 'local-song.mp3', 500000);
  assert.equal(matched?.id, 'f1');
});

test('musicPlaybackFlag tracks active playback state synchronously for shutter mute', () => {
  setMusicPlayingActive(false);
  assert.equal(isMusicPlayingActive(), false);
  setMusicPlayingActive(true);
  assert.equal(isMusicPlayingActive(), true);
  setMusicPlayingActive(false);
  assert.equal(isMusicPlayingActive(), false);
});

test('musicLogic computes sleep timer remaining seconds, badge formatting, and floating button bounds', () => {
  assert.deepEqual([...SLEEP_TIMER_PRESETS_MIN], [15, 30, 60]);
  assert.equal(computeSleepTimerRemainingSec(null, 1000), 0);
  assert.equal(computeSleepTimerRemainingSec(10000, 10000), 0);
  assert.equal(computeSleepTimerRemainingSec(10000, 12000), 0);
  assert.equal(computeSleepTimerRemainingSec(100000, 10000), 90);
  assert.equal(formatSleepTimerBadge(0), '');
  assert.equal(formatSleepTimerBadge(90), '01:30');
  assert.equal(formatSleepTimerBadge(900), '15:00');

  assert.equal(clampFloatingButtonY(-50, 844), 56);
  assert.equal(clampFloatingButtonY(9999, 844), 844 - 44 - 92);
  assert.equal(clampFloatingButtonY(320, 844), 320);
  assert.equal(getDefaultFloatingButtonY(844, 44), 400);
});

test('musicLogic handles FAB color presets, idle timing, supported audio extensions, duplicates by (name+size), and import summary', () => {
  assert.equal(MUSIC_IDLE_FADE_DELAY_MS, 4000);
  assert.equal(MUSIC_IDLE_OPACITY, 0.35);
  assert.equal(MUSIC_FAB_COLOR_PRESETS.length, 6);
  assert.equal(resolveMusicFabColorPreset(undefined).id, 'violet-pink');
  assert.equal(resolveMusicFabColorPreset('unknown').id, 'violet-pink');
  assert.equal(resolveMusicFabColorPreset('indigo-cyan').id, 'indigo-cyan');

  // Audio filter accepts MIME audio/* and listed extensions case-insensitively, rejects images/0-byte
  assert.equal(isSupportedAudioFile({ name: 'song.MP3', type: '', size: 100 }), true);
  assert.equal(isSupportedAudioFile({ name: 'voice.M4A', type: '', size: 100 }), true);
  assert.equal(isSupportedAudioFile({ name: 'clip.opus', type: '', size: 100 }), true);
  assert.equal(isSupportedAudioFile({ name: 'track.flac', type: '', size: 100 }), true);
  assert.equal(isSupportedAudioFile({ name: 'custom.bin', type: 'audio/ogg', size: 100 }), true);
  assert.equal(isSupportedAudioFile({ name: 'cover.jpg', type: 'image/jpeg', size: 100 }), false);
  assert.equal(isSupportedAudioFile({ name: 'empty.mp3', type: 'audio/mp3', size: 0 }), false);

  // Duplicate detection checks (fileName + size) ignoring missing placeholders
  const existing: MusicTrackRecord[] = [
    {
      id: 't1',
      kind: 'file',
      title: 'أول',
      fileName: 'Song.mp3',
      duration: 60,
      size: 2048,
      order: 0,
      missingFile: false,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 't2',
      kind: 'file',
      title: 'مفقود',
      fileName: 'Lost.mp3',
      duration: 60,
      size: 4096,
      order: 1,
      missingFile: true,
      createdAt: 2,
      updatedAt: 2,
    },
  ];
  const seen = new Set<string>([makeAudioDuplicateKey('Batch.wav', 1024)]);
  assert.equal(isDuplicateAudioFile(existing, seen, 'song.mp3', 2048), true);
  assert.equal(isDuplicateAudioFile(existing, seen, 'song.mp3', 2049), false);
  assert.equal(isDuplicateAudioFile(existing, seen, 'batch.wav', 1024), true);
  assert.equal(isDuplicateAudioFile(existing, seen, 'Lost.mp3', 4096), false);

  assert.equal(
    formatMusicImportSummary({ addedCount: 5, skippedDuplicatesCount: 2, failedCount: 1 }),
    'أضيف 5 ملف · تم تخطي 2 مكرر · فشل 1'
  );
});

test('quantityLogic extracts standalone trailing numbers accurately while protecting weights, units, and calculator lines', () => {
  // Valid standalone trailing quantities (English, Arabic-Indic, decimals)
  assert.deepEqual(extractTrailingQuantity('حليب 5'), {
    cleanName: 'حليب',
    quantity: 5,
  });
  assert.deepEqual(extractTrailingQuantity('عصير برتقال ١٢'), {
    cleanName: 'عصير برتقال',
    quantity: 12,
  });
  assert.deepEqual(extractTrailingQuantity('زيت زيتون 1.5'), {
    cleanName: 'زيت زيتون',
    quantity: 1.5,
  });

  // Weight + final standalone quantity -> keeps weight, extracts final number
  assert.deepEqual(extractTrailingQuantity('قوطية 200غ 5'), {
    cleanName: 'قوطية 200غ',
    quantity: 5,
  });
  assert.deepEqual(extractTrailingQuantity('شامبو 400 مل 3'), {
    cleanName: 'شامبو 400 مل',
    quantity: 3,
  });

  // Weights/units attached or trailing -> NEVER extracted
  assert.equal(extractTrailingQuantity('جبن 200غ'), null);
  assert.equal(extractTrailingQuantity('عسل 850 غ'), null);
  assert.equal(extractTrailingQuantity('ماء 1.5 لتر'), null);
  assert.equal(extractTrailingQuantity('عصير ٣٥٠ مل'), null);
  assert.equal(extractTrailingQuantity('شاي 12 pcs'), null);
  assert.equal(extractTrailingQuantity('علب 500gm'), null);

  // Calculator lines / pure digits / math expressions -> NEVER extracted
  assert.equal(extractTrailingQuantity('42'), null);
  assert.equal(extractTrailingQuantity('6 * 12'), null);
  assert.equal(extractTrailingQuantity('حليب 6 * 12'), null);
  assert.equal(extractTrailingQuantity('شاي 2 + 3'), null);
  assert.equal(extractTrailingQuantity('2026-11-19'), null);
});

test('quantityLogic converts existing note lines, realigns on line edits, summarizes totals, and computes toolbar overflow count', () => {
  const existingBody = 'حليب 5\nجبن 200غ\nقوطية 200غ 3\n6 * 12\nخبز';
  assert.equal(countConvertibleTrailingLines(existingBody.split('\n')), 2);

  const converted = convertExistingNoteLinesToQuantities(existingBody, []);
  assert.equal(converted.convertedCount, 2);
  assert.equal(converted.body, 'حليب\nجبن 200غ\nقوطية 200غ\n6 * 12\nخبز');
  assert.deepEqual(converted.lineQuantities, [
    { lineIndex: 0, quantity: 5 },
    { lineIndex: 2, quantity: 3 },
  ]);

  const summary = computeNoteQuantitiesSummary(
    converted.body.split('\n'),
    converted.lineQuantities
  );
  assert.equal(summary.itemCount, 4); // 4 letter lines (calculator line '6 * 12' excluded)
  assert.equal(summary.quantifiedCount, 2);
  assert.equal(summary.totalQuantity, 8);

  // Insert a blank line after line 0 -> quantity and unit at index 2 shift to index 3
  const shifted = realignLineQuantitiesAfterEdit(
    ['حليب', 'جبن 200غ', 'قوطية 200غ'],
    ['حليب', '', 'جبن 200غ', 'قوطية 200غ'],
    [
      { lineIndex: 0, quantity: 5, unit: 'carton' },
      { lineIndex: 2, quantity: 3, unit: 'piece' },
    ]
  );
  assert.deepEqual(shifted, [
    { lineIndex: 0, quantity: 5, unit: 'carton' },
    { lineIndex: 3, quantity: 3, unit: 'piece' },
  ]);

  // Toolbar overflow calculation reserves 1 slot for "⋯" and prevents wrapping on narrow screens
  assert.equal(computeToolbarVisibleCount(600, 6, 62, 4), 6);
  assert.equal(computeToolbarVisibleCount(300, 6, 62, 4), 3); // 3 primary + ⋯ = 4 slots on narrow screen
});

test('noteFormat formats notes with BiDi quantity marks, units (كارتون/قطع), alphabetical sort, Arabic digits, and excludes date/item count on copy', () => {
  const body = 'كعك\nحليب\n\nماء';
  const quantities = [
    { lineIndex: 0, quantity: 2 },
    { lineIndex: 1, quantity: 5 },
  ];

  // Legacy OFF mode stays 100% identical (no parens, keeps blank line)
  assert.equal(
    formatNoteForCopy({
      title: 'مقاضي',
      body,
      numberingEnabled: true,
      quantitiesEnabled: false,
      lineQuantities: quantities,
    }),
    'مقاضي\n1. كعك\n2. حليب\n\n4. ماء'
  );

  // ON + units (كارتون / قطع) + as-written + western digits + numbered
  assert.equal(
    formatNoteForCopy({
      title: 'مقاضي',
      body,
      numberingEnabled: true,
      quantitiesEnabled: true,
      lineQuantities: [
        { lineIndex: 0, quantity: 2, unit: 'carton' },
        { lineIndex: 1, quantity: 5, unit: 'piece' },
      ],
      sortOrder: 'as-written',
      digitStyle: 'western',
      includeTotalQuantities: false,
    }),
    'مقاضي\n1. كعك \u200F(\u200E\u200E2\u200E كارتون\u200E)\u200F\n2. حليب \u200F(\u200E\u200E5\u200E قطع\u200E)\u200F\n3. ماء'
  );

  // ON + alphabetical + arabic digits + unnumbered
  assert.equal(
    formatNoteForCopy({
      title: '',
      body: 'موز\nبرتقال\nتفاح',
      numberingEnabled: false,
      quantitiesEnabled: true,
      lineQuantities: [
        { lineIndex: 0, quantity: 3 },
        { lineIndex: 2, quantity: 12 },
      ],
      sortOrder: 'alphabetical',
      digitStyle: 'arabic',
      includeTotalQuantities: true,
    }),
    'برتقال\nتفاح \u200F(\u200E١٢\u200E)\u200F\nموز \u200F(\u200E٣\u200E)\u200F\nالمجموع: ١٥'
  );

  // WhatsApp with quantities + optional total
  const waText = formatNoteForWhatsApp({
    title: 'طلب',
    body: 'حليب\nعصير',
    numberingEnabled: true,
    quantitiesEnabled: true,
    lineQuantities: [{ lineIndex: 0, quantity: 4, unit: 'carton' }],
    digitStyle: 'western',
    includeTotalQuantities: true,
  });
  assert.equal(
    waText,
    'طلب\n1. حليب \u200F(\u200E\u200E4\u200E كارتون\u200E)\u200F\n2. عصير\nالمجموع: 4'
  );

  // formatNoteWithDetails must NOT write today's date or total item count ("عدد المواد")
  const details = formatNoteWithDetails({
    title: 'طلب',
    body: 'حليب\nعصير',
    dateLabel: 'اليوم',
    numberingEnabled: true,
    quantitiesEnabled: true,
    lineQuantities: [{ lineIndex: 0, quantity: 4, unit: 'piece' }],
  });
  assert.equal(details.includes('التاريخ:'), false);
  assert.equal(details.includes('عدد المواد:'), false);
  assert.equal(details.includes('اليوم'), false);
  assert.ok(details.includes('1. حليب'));
  assert.ok(details.includes('قطع'));
});

test('duplicateDetector ignores trailing quantities when enabled and merges duplicate lines by adding box quantities and preserving unit', () => {
  // With ignoreTrailingQuantity: true, "حليب 3" matches "حليب 5" and "حليب"
  assert.deepEqual(
    normalizeNoteLineWords('حليب 3', { ignoreTrailingQuantity: true }),
    ['حليب']
  );
  // Weights stay part of identity even when ignoreTrailingQuantity is true
  assert.deepEqual(
    normalizeNoteLineWords('جبن 200غ', { ignoreTrailingQuantity: true }),
    ['جبن', '200غ']
  );

  const dup = findDuplicateForFinishedLine({
    lines: ['حليب 3', 'عصير', 'حليب 7'],
    finishedLineIndex: 2,
    ignoreTrailingQuantity: true,
  });
  assert.ok(dup);
  assert.equal(dup?.matchLineIndex, 0);

  // Merging two duplicate lines adds their box quantities (3 + 4 = 7) and aligns remaining lines
  const merged = mergeDuplicateLines({
    body: 'حليب\nخبز\nحليب\nعصير',
    linePhotos: [{ lineIndex: 2, dataUrl: 'pic_milk' }, { lineIndex: 3, dataUrl: 'pic_juice' }],
    lineQuantities: [
      { lineIndex: 0, quantity: 3, unit: 'carton' },
      { lineIndex: 2, quantity: 4 },
      { lineIndex: 3, quantity: 2, unit: 'piece' },
    ],
    keepIndex: 0,
    removeIndices: [2],
  });
  assert.equal(merged.body, 'حليب\nخبز\nعصير');
  assert.equal(merged.mergedQuantity, 7);
  assert.deepEqual(merged.lineQuantities, [
    { lineIndex: 0, quantity: 7, unit: 'carton' },
    { lineIndex: 2, quantity: 2, unit: 'piece' },
  ]);
  assert.deepEqual(merged.linePhotos, [
    { lineIndex: 0, dataUrl: 'pic_milk' },
    { lineIndex: 2, dataUrl: 'pic_juice' },
  ]);
});

test('backupSanitizer strips legacy AI fields and ignores AI sections when importing legacy backups', () => {
  const rawLegacyPhoto = {
    id: 'ph_1',
    sessionId: 'sess_1',
    timestamp: 1700000000000,
    dateKey: '2026-11-20',
    dataUrl: 'data:image/jpeg;base64,AQID',
    width: 1080,
    height: 1920,
    done: true,
    shelfId: 'shelf_1',
    shelfLabel: 'ممر 2',
    status: 'done',
    photoQuality: 'good',
    errorMessage: 'old err',
    analyzedAt: 1700000005000,
  };
  assert.equal(hasLegacyPhotoAiFields(rawLegacyPhoto), true);

  const cleanPhoto = sanitizePhotoRecord(rawLegacyPhoto);
  assert.ok(cleanPhoto);
  assert.equal(cleanPhoto.id, 'ph_1');
  assert.equal(cleanPhoto.done, true);
  assert.equal(cleanPhoto.dataUrl, 'data:image/jpeg;base64,AQID');
  assert.equal(hasLegacyPhotoAiFields(cleanPhoto), false);
  assert.equal('shelfId' in cleanPhoto, false);
  assert.equal('status' in cleanPhoto, false);
  assert.equal('analyzedAt' in cleanPhoto, false);

  const rawLegacySettings = {
    cameraHighQuality: false,
    defaultNoteQuantities: true,
    aiAnalysisEnabled: true,
    activeShelfLabel: 'ممر الشامبو',
    unifiedFraming: true,
  };
  assert.equal(hasLegacySettingsAiFields(rawLegacySettings), true);
  const cleanSettings = sanitizeSettingsRecord(rawLegacySettings);
  assert.equal(cleanSettings.cameraHighQuality, false);
  assert.equal(cleanSettings.defaultNoteQuantities, true);
  assert.equal(hasLegacySettingsAiFields(cleanSettings), false);
  assert.equal('aiAnalysisEnabled' in cleanSettings, false);
  assert.equal('activeShelfLabel' in cleanSettings, false);

  const legacyBackupJson = JSON.stringify({
    app: 'naqs-shelf-app',
    version: 14,
    exportedAt: '2026-11-20T10:00:00.000Z',
    settings: rawLegacySettings,
    photos: [rawLegacyPhoto],
    notes: [
      {
        id: 'n_1',
        title: 'ملاحظة محفوظة',
        body: 'حليب',
        photos: [],
        numberingEnabled: true,
        resetAfterBlankLine: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    whatsappRecipients: [
      { id: 'w1', name: 'أحمد', phone: '9647701234567', createdAt: 1, updatedAt: 1 },
    ],
    shortages: [{ id: 's1', productName: 'نقص قديم' }],
    products: [{ id: 'pr1', name: 'منتج قديم' }],
    shelves: [{ id: 'sh1', name: 'رف قديم' }],
    manualMarks: [{ id: 'm1' }],
    pullHistory: [{ id: 'pu1' }],
    aiModule: {
      ai_photos: [{ id: 'ap1' }],
      ai_gaps: [{ id: 'ag1' }],
      ai_products: [{ id: 'apr1' }],
    },
    musicModule: {
      tracks: [
        {
          id: 't1',
          title: 'مقطع صوتي',
          fileName: 'track.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 1024,
          durationSec: 60,
          createdAt: 1,
          orderIndex: 0,
        },
      ],
    },
  });

  const imported = normalizeImportedBackup(legacyBackupJson);
  assert.equal(imported.photos.length, 1);
  assert.equal(hasLegacyPhotoAiFields(imported.photos[0]), false);
  assert.equal(imported.notes.length, 1);
  assert.equal(imported.notes[0].title, 'ملاحظة محفوظة');
  assert.equal(imported.whatsappRecipients?.length, 1);
  assert.equal(imported.musicModule?.tracks.length, 1);
  assert.ok(imported.settings);
  assert.equal(hasLegacySettingsAiFields(imported.settings), false);
  assert.equal('aiModule' in imported, false);
  assert.equal('shortages' in imported, false);
  assert.equal('products' in imported, false);

  // One-time cleanup flag helper
  const mem = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
  };
  assert.equal(isLegacyAiCleanupDone(mockStorage), false);
  markLegacyAiCleanupDone(mockStorage);
  assert.equal(mem.get(LEGACY_AI_CLEANUP_STORAGE_KEY), '1');
  assert.equal(isLegacyAiCleanupDone(mockStorage), true);
});

test('coverArt extracts ID3 APIC and MP4 covr embedded art, computes 8-color deterministic tiles and initials', () => {
  assert.equal(TRACK_TILE_COLORS.length, 8);
  assert.equal(hashTitleToColorIndex('أنشودة الصباح'), hashTitleToColorIndex('أنشودة الصباح'));
  assert.equal(resolveTrackTileColor('أنشودة', 'crimson').id, 'crimson');
  assert.equal(getTrackInitialLetter('أغنية جديدة'), 'أ');
  assert.equal(getTrackInitialLetter('01_صباح_الخير'), 'ص');
  assert.equal(getTrackInitialLetter('2026'), '2');
  assert.equal(getTrackInitialLetter('  track 01 '), 'T');
  assert.equal(getTrackInitialLetter('---'), '♪');

  // Construct minimal valid ID3v2.3 tag with APIC frame containing JPEG magic bytes
  const fakeJpeg = new Uint8Array(24);
  fakeJpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46], 0);
  const mimeBytes = Array.from('image/jpeg', (c) => c.charCodeAt(0));
  const apicPayload = new Uint8Array([
    0x00, // encoding
    ...mimeBytes,
    0x00, // null after mime
    0x03, // front cover type
    0x00, // empty description null
    ...fakeJpeg,
  ]);
  const frameHeader = new Uint8Array([
    0x41, 0x50, 0x49, 0x43, // APIC
    0x00, 0x00, 0x00, apicPayload.length,
    0x00, 0x00,
  ]);
  const totalTagSize = frameHeader.length + apicPayload.length;
  const id3Tag = new Uint8Array([
    0x49, 0x44, 0x33, // ID3
    0x03, 0x00, // v2.3
    0x00,
    0x00, 0x00, (totalTagSize >> 7) & 0x7f, totalTagSize & 0x7f,
    ...frameHeader,
    ...apicPayload,
  ]);
  const extractedId3 = extractEmbeddedCoverArtBytes(id3Tag);
  assert.ok(extractedId3);
  assert.equal(extractedId3.mimeType, 'image/jpeg');
  assert.equal(extractedId3.bytes.length, fakeJpeg.length);

  // Construct minimal MP4 moov -> udta -> meta -> ilst -> covr -> data containing PNG magic bytes
  const makeAtom = (name: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(8 + body.length);
    const len = out.length;
    out[0] = (len >>> 24) & 0xff;
    out[1] = (len >>> 16) & 0xff;
    out[2] = (len >>> 8) & 0xff;
    out[3] = len & 0xff;
    for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
    out.set(body, 8);
    return out;
  };
  const fakePng = new Uint8Array(24);
  fakePng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const dataPayload = new Uint8Array(8 + fakePng.length);
  dataPayload[3] = 14; // PNG type indicator
  dataPayload.set(fakePng, 8);
  const ilstAtom = makeAtom('ilst', makeAtom('covr', makeAtom('data', dataPayload)));
  const metaBody = new Uint8Array(4 + ilstAtom.length); // 4-byte FullBox flags
  metaBody.set(ilstAtom, 4);
  const moovAtom = makeAtom('moov', makeAtom('udta', makeAtom('meta', metaBody)));

  const extractedMp4 = extractEmbeddedCoverArtBytes(moovAtom);
  assert.ok(extractedMp4);
  assert.equal(extractedMp4.mimeType, 'image/png');
  assert.equal(extractedMp4.bytes.length, fakePng.length);
});

test('musicPlaybackHelpers resolves MIME types (including mp4/webm), formats MediaErrors, handles volume/mute safety, and formats diagnostics', () => {
  assert.equal(resolveAudioMimeType('', 'song.mp3'), 'audio/mpeg');
  assert.equal(resolveAudioMimeType('video/mp4', 'clip.mp4'), 'audio/mp4');
  assert.equal(resolveAudioMimeType('video/webm', 'clip.webm'), 'audio/webm');
  assert.equal(resolveAudioMimeType('application/octet-stream', 'voice.m4a'), 'audio/mp4');
  assert.equal(resolveAudioMimeType('', 'track.opus'), 'audio/opus');

  // Supported file filter also accepts mp4 and webm
  assert.equal(isSupportedAudioFile({ name: 'audio_clip.mp4', type: 'video/mp4', size: 1024 }), true);
  assert.equal(isSupportedAudioFile({ name: 'voice.webm', type: 'video/webm', size: 1024 }), true);

  // MediaError code messages & decode/source flag
  const decodeErr = formatMediaErrorReason({
    mediaErrorCode: 3,
    mimeType: 'audio/mp4',
    sizeBytes: 2048,
    fileName: 'song.m4a',
  });
  assert.equal(decodeErr.isDecodeOrSourceError, true);
  assert.ok(decodeErr.message.includes('تعذر التشغيل:'));
  assert.ok(decodeErr.message.includes('audio/mp4'));
  assert.ok(decodeErr.message.includes('2.0 ك.ب'));

  const abortErr = formatMediaErrorReason({
    playError: { name: 'AbortError', message: 'aborted' },
  });
  assert.equal(abortErr.isAbort, true);

  // One-time launch reset when saved state was muted or 0
  const launchReset = resolveInitialVolumeReset({
    volume: 0,
    muted: true,
    lastNonZeroVolume: 0.6,
    alreadyReset: false,
  });
  assert.equal(launchReset.didReset, true);
  assert.equal(launchReset.volume, 1);
  assert.equal(launchReset.muted, false);
  assert.equal(launchReset.toastText, 'تم رفع الصوت');

  // Subsequent launches do not re-reset user mute unless pressed Play
  const secondLaunch = resolveInitialVolumeReset({
    volume: 0.7,
    muted: true,
    lastNonZeroVolume: 0.7,
    alreadyReset: true,
  });
  assert.equal(secondLaunch.didReset, false);
  assert.equal(secondLaunch.muted, true);

  // Pressing Play while muted restores lastNonZeroVolume (or 80% fallback) and shows toast
  const playUnmute = resolvePlayVolumeState({
    volume: 0.65,
    muted: true,
    lastNonZeroVolume: 0.65,
  });
  assert.equal(playUnmute.didAutoUnmute, true);
  assert.equal(playUnmute.muted, false);
  assert.equal(playUnmute.volume, 0.65);
  assert.equal(playUnmute.toastText, 'كان الصوت مكتوماً — تم تشغيله');

  const playZeroFallback = resolvePlayVolumeState({
    volume: 0,
    muted: false,
    lastNonZeroVolume: 0,
  });
  assert.equal(playZeroFallback.didAutoUnmute, true);
  assert.equal(playZeroFallback.volume, 0.8);

  // Diagnostics clipboard formatting
  const diagText = formatPlaybackDiagnosticsText({
    trackTitle: 'اختبار',
    fileName: 'test_track.mp4',
    mimeType: 'video/mp4',
    resolvedMimeType: 'audio/mp4',
    sizeBytes: 1024 * 1024,
    durationSec: 125,
    readyState: 4,
    networkState: 1,
    volume: 0.85,
    muted: false,
    paused: false,
    ended: false,
    lastError: null,
  });
  assert.ok(diagText.includes('test_track.mp4'));
  assert.ok(diagText.includes('audio/mp4'));
  assert.ok(diagText.includes('85%'));
  assert.ok(diagText.includes('صوت الوسائط'));
});

test('musicLogic derives short names cleanly, filters tabs/recent/lists, and preserves metadata without covers/blobs in backup', () => {
  assert.equal(deriveShortTrackName('01_صباح__الخير.mp3'), '01 صباح الخير');
  assert.equal(deriveShortTrackName('   .mp3'), 'مقطع صوتي');

  const tracks: MusicTrackRecord[] = [
    {
      id: 'a',
      kind: 'file',
      title: 'نشيد الفجر',
      fileName: 'fajr_nasheed.mp3',
      duration: 90,
      size: 1000,
      order: 0,
      favorite: true,
      lastPlayedAt: 200,
      tileColor: 'cobalt',
      coverDataUrl: 'data:image/jpeg;base64,abc',
      listIds: ['l1', 'l2'],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'b',
      kind: 'file',
      title: 'مقطع هادئ',
      fileName: 'calm.m4a',
      duration: 120,
      size: 2000,
      order: 1,
      favorite: false,
      lastPlayedAt: 500,
      listIds: ['l2'],
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: 'c',
      kind: 'radio',
      title: 'إذاعة القرآن',
      streamUrl: 'https://example.com/live',
      duration: 0,
      size: 0,
      order: 2,
      favorite: true,
      createdAt: 3,
      updatedAt: 3,
    },
  ];

  assert.deepEqual(
    getRecentPlayedTracks(tracks, 8).map((t) => t.id),
    ['b', 'a']
  );
  assert.deepEqual(
    filterTracksByTabAndQuery(tracks, { tab: 'favorites', query: '' }).map((t) => t.id),
    ['a', 'c']
  );
  assert.deepEqual(
    filterTracksByTabAndQuery(tracks, { tab: 'recent', query: '' }).map((t) => t.id),
    ['b', 'a']
  );
  assert.deepEqual(
    filterTracksByTabAndQuery(tracks, { tab: 'list:l2', query: 'هادئ' }).map((t) => t.id),
    ['b']
  );

  // Backup keeps title/favorite/tileColor/listIds but excludes coverDataUrl and blobs
  const backupTracks = buildMusicBackupTracks(tracks);
  assert.equal(backupTracks[0].favorite, true);
  assert.equal(backupTracks[0].tileColor, 'cobalt');
  assert.deepEqual(backupTracks[0].listIds, ['l1', 'l2']);
  assert.equal('coverDataUrl' in (backupTracks[0] as unknown as Record<string, unknown>), false);

  const restored = mergeImportedMusicTracks([], new Set(['a']), backupTracks);
  assert.equal(restored[0].favorite, true);
  assert.equal(restored[0].tileColor, 'cobalt');
  assert.deepEqual(restored[0].listIds, ['l1', 'l2']);
  assert.equal(restored[0].missingFile, false);
  assert.equal(restored[1].missingFile, true);
});

test('captureQueue enforces max 5 pending queue, 1.2s overlay cap, 4096px/0.92 JPEG settings, and hardware zoom preset selection', () => {
  assert.equal(MAX_CAPTURE_QUEUE_PENDING, 5);
  assert.equal(FREEZE_OVERLAY_MAX_MS, 1200);
  assert.equal(MAX_SAVED_PHOTO_LONG_SIDE, 4096);
  assert.equal(SAVED_PHOTO_JPEG_QUALITY, 0.92);
  assert.equal(THUMBNAIL_MAX_LONG_SIDE, 480);
  assert.equal(THUMBNAIL_JPEG_QUALITY, 0.8);
  assert.equal(CAMERA_TAKE_PHOTO_TIMEOUT_MS, 2000);

  assert.equal(resolveCaptureMode(undefined), 'fast');
  assert.equal(resolveCaptureMode('high-quality'), 'high-quality');
  assert.equal(resolveCaptureMode('fast'), 'fast');
  assert.equal(formatCaptureModeLabel('high-quality'), 'جودة عالية');
  assert.equal(formatCaptureModeLabel('fast'), 'سريع');

  // Queue accepts up to 5 pending items, rejects the 6th, and frees slots on completion
  let queueState = { pendingCount: 0, maxPending: MAX_CAPTURE_QUEUE_PENDING };
  for (let i = 0; i < 5; i++) {
    assert.equal(canAcceptCapture(queueState), true);
    const step = enqueuePendingCapture(queueState);
    assert.equal(step.accepted, true);
    queueState = step.next;
  }
  assert.equal(queueState.pendingCount, 5);
  assert.equal(canAcceptCapture(queueState), false);
  const rejected = enqueuePendingCapture(queueState);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.next.pendingCount, 5);

  queueState = completePendingCapture(queueState);
  assert.equal(queueState.pendingCount, 4);
  assert.equal(canAcceptCapture(queueState), true);
  assert.equal(
    completePendingCapture({ pendingCount: 0, maxPending: 5 }).pendingCount,
    0
  );

  // Freeze-frame overlay max duration helper
  assert.equal(computeFreezeDismissDelayMs(1000, 1000), 1200);
  assert.equal(computeFreezeDismissDelayMs(1000, 1500), 700);
  assert.equal(computeFreezeDismissDelayMs(1000, 2500), 0);

  // Hardware zoom presets are hidden when track lacks zoom, and clamped cleanly when present
  assert.deepEqual(resolveAvailableZoomPresets(null), []);
  assert.deepEqual(resolveAvailableZoomPresets({ min: 1, max: 1.2 }), []);
  assert.deepEqual(resolveAvailableZoomPresets({ min: 1, max: 2.2 }), [1, 2]);
  assert.deepEqual(resolveAvailableZoomPresets({ min: 1, max: 5 }), [1, 2, 3]);
  assert.equal(clampHardwareZoom(2.54, { min: 1, max: 4 }), 2.5);
  assert.equal(clampHardwareZoom(9, { min: 1, max: 4 }), 4);
  assert.equal(clampHardwareZoom(0.5, null), 1);

  // Backup sanitizer preserves captureMode & thumbnailDataUrl and defaults captureMode to fast
  const settingsClean = sanitizeSettingsRecord({ captureMode: 'high-quality' });
  assert.equal(settingsClean.captureMode, 'high-quality');
  const settingsDefault = sanitizeSettingsRecord({});
  assert.equal(settingsDefault.captureMode, 'fast');
  assert.equal(settingsDefault.previewResolution, 'auto');
  const photoClean = sanitizePhotoRecord({
    id: 'p_thumb',
    sessionId: 's1',
    timestamp: 1000,
    dateKey: '2026-11-22',
    dataUrl: 'data:image/jpeg;base64,FULL',
    thumbnailDataUrl: 'data:image/jpeg;base64,THUMB',
    width: 4000,
    height: 3000,
  });
  assert.equal(photoClean?.thumbnailDataUrl, 'data:image/jpeg;base64,THUMB');
});

test('extractAutoTakeQuantityAndUnit parses trailing/attached numbers, separators, and unit words while restricting decimals to kg/gram and protecting weights/7up/calculator lines', () => {
  // Arabic unit words (spaced & attached)
  assert.deepEqual(extractAutoTakeQuantityAndUnit('عصير 5 قطع'), {
    cleanName: 'عصير',
    quantity: 5,
    unit: 'piece',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('عصير5قطع'), {
    cleanName: 'عصير',
    quantity: 5,
    unit: 'piece',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('مياه 4 قطعة'), {
    cleanName: 'مياه',
    quantity: 4,
    unit: 'piece',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('شاي 2 كارتون'), {
    cleanName: 'شاي',
    quantity: 2,
    unit: 'carton',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('بيبسي 3 علبة'), {
    cleanName: 'بيبسي',
    quantity: 3,
    unit: 'box',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('لحم 1.5 كيلو'), {
    cleanName: 'لحم',
    quantity: 1.5,
    unit: 'kg',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('لحم1.5كيلو'), {
    cleanName: 'لحم',
    quantity: 1.5,
    unit: 'kg',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('زعفران 0.5 غرام'), {
    cleanName: 'زعفران',
    quantity: 0.5,
    unit: 'gram',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('زعفران 500غرام'), {
    cleanName: 'زعفران',
    quantity: 500,
    unit: 'gram',
  });

  // Attached bare digits & Arabic-Indic digits & trailing separators (x, ×, *, :, =)
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح2'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح 2'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح٢'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح x2'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح ×2'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح *2'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح:2'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح=2'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('تفاح x 2'), {
    cleanName: 'تفاح',
    quantity: 2,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('cola x3'), {
    cleanName: 'cola',
    quantity: 3,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('box2'), {
    cleanName: 'box',
    quantity: 2,
  });

  // Decimals rejected unless unit is كيلو or غرام
  assert.equal(extractAutoTakeQuantityAndUnit('تفاح 1.5'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('تفاح1.5'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('عصير 2.5 قطع'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('بيبسي 1.5 علبة'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('شاي 1.5 كارتون'), null);

  // English unit words
  assert.deepEqual(extractAutoTakeQuantityAndUnit('coffee 2 carton'), {
    cleanName: 'coffee',
    quantity: 2,
    unit: 'carton',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('biscuit 3 box'), {
    cleanName: 'biscuit',
    quantity: 3,
    unit: 'box',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('tea 12 pcs'), {
    cleanName: 'tea',
    quantity: 12,
    unit: 'piece',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('rice 5 kg'), {
    cleanName: 'rice',
    quantity: 5,
    unit: 'kg',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('spices 250 g'), {
    cleanName: 'spices',
    quantity: 250,
    unit: 'gram',
  });

  // Weight stays in name, final number (+ optional unit) is extracted
  assert.deepEqual(extractAutoTakeQuantityAndUnit('قوطية 200غ 5'), {
    cleanName: 'قوطية 200غ',
    quantity: 5,
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('قوطية 200غ 5 علبة'), {
    cleanName: 'قوطية 200غ',
    quantity: 5,
    unit: 'box',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('200غ حليب 3 كارتون'), {
    cleanName: '200غ حليب',
    quantity: 3,
    unit: 'carton',
  });
  assert.deepEqual(extractAutoTakeQuantityAndUnit('7up 6'), {
    cleanName: '7up',
    quantity: 6,
  });

  // Letters/abbreviations after number or numbers before name -> NEVER extracted
  assert.equal(extractAutoTakeQuantityAndUnit('جبن 200غ'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('ماء 1.5ل'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('عصير 350مل'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('7up'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('شاي 500غم'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('200غ حليب'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('5 حليب'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('3 كارتون حليب'), null);

  // Calculator lines -> NEVER extracted
  assert.equal(extractAutoTakeQuantityAndUnit('42'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('6 * 12'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('حليب 6 * 12'), null);
  assert.equal(extractAutoTakeQuantityAndUnit('حليب 6 * 12 قطع'), null);
});

test('unitMemory stores normalized product units, resolves in priority order, supports fixed mode, and clears cleanly', () => {
  const store = new Map<string, string>();
  const mockStorage: SimpleStorageLike = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };

  assert.equal(normalizeProductNameForUnitMemory('  أرز  بَسمتي 2 '), 'ارز بسمتي');

  rememberUnitForProduct('أرز بسمتي', 'kg', mockStorage);
  rememberUnitForProduct('عصير', 'piece', mockStorage);
  const loaded = loadProductUnitMemory(mockStorage);
  assert.equal(loaded['ارز بسمتي'], 'kg');
  assert.equal(loaded['عصير'], 'piece');

  // Resolution order: (1) explicit -> (2) remembered (in per-product mode) -> (3) default -> undefined
  assert.equal(
    resolveQuantityUnit({
      explicitUnit: 'box',
      productName: 'أرز بسمتي',
      unitMode: 'per-product',
      defaultUnit: 'carton',
      memory: loaded,
    }),
    'box'
  );
  assert.equal(
    resolveQuantityUnit({
      productName: 'ارز بسمتي',
      unitMode: 'per-product',
      defaultUnit: 'carton',
      memory: loaded,
    }),
    'kg'
  );
  assert.equal(
    resolveQuantityUnit({
      productName: 'سكر',
      unitMode: 'per-product',
      defaultUnit: 'carton',
      memory: loaded,
    }),
    'carton'
  );
  assert.equal(
    resolveQuantityUnit({
      productName: 'سكر',
      unitMode: 'per-product',
      defaultUnit: 'none',
      memory: loaded,
    }),
    undefined
  );

  // Fixed mode skips per-product memory and falls back directly to default unit
  assert.equal(
    resolveQuantityUnit({
      productName: 'ارز بسمتي',
      unitMode: 'fixed',
      defaultUnit: 'box',
      memory: loaded,
    }),
    'box'
  );

  forgetUnitForProduct('عصير', mockStorage);
  assert.equal(loadProductUnitMemory(mockStorage)['عصير'], undefined);

  clearProductUnitMemory(mockStorage);
  assert.deepEqual(loadProductUnitMemory(mockStorage), {});
});

test('all 5 quantity units format cleanly, copy/WhatsApp honor them, duplicate merge guards differing units, and backupSanitizer handles new settings', () => {
  assert.equal(formatQuantityUnitLabel('carton'), 'كارتون');
  assert.equal(formatQuantityUnitLabel('box'), 'علبة');
  assert.equal(formatQuantityUnitLabel('piece'), 'قطع');
  assert.equal(formatQuantityUnitLabel('kg'), 'كيلو');
  assert.equal(formatQuantityUnitLabel('gram'), 'غرام');
  assert.equal(formatQuantityUnitLabel(undefined), '');

  const copied = formatNoteForCopy({
    title: 'طلب',
    body: 'زعفران\nبيبسي\nسكر',
    numberingEnabled: false,
    quantitiesEnabled: true,
    lineQuantities: [
      { lineIndex: 0, quantity: 500, unit: 'gram' },
      { lineIndex: 1, quantity: 3, unit: 'box' },
      { lineIndex: 2, quantity: 2, unit: 'kg' },
    ],
  });
  assert.ok(copied.includes('500\u200E غرام'));
  assert.ok(copied.includes('3\u200E علبة'));
  assert.ok(copied.includes('2\u200E كيلو'));

  const wa = formatNoteForWhatsApp({
    title: 'طلب',
    body: 'عصير',
    quantitiesEnabled: true,
    lineQuantities: [{ lineIndex: 0, quantity: 5, unit: 'piece' }],
  });
  assert.ok(wa.includes('5\u200E قطع'));

  // Differing explicit units block duplicate merge and preserve lines untouched
  const blocked = mergeDuplicateLines({
    body: 'عصير\nخبز\nعصير',
    linePhotos: [],
    lineQuantities: [
      { lineIndex: 0, quantity: 2, unit: 'carton' },
      { lineIndex: 2, quantity: 5, unit: 'piece' },
    ],
    keepIndex: 0,
    removeIndices: [2],
  });
  assert.equal(blocked.unitMismatch, true);
  assert.equal(blocked.mergedQuantity, null);
  assert.equal(blocked.body, 'عصير\nخبز\nعصير');
  assert.equal(blocked.lineQuantities.length, 2);

  // Matching units merge normally
  const mergedSame = mergeDuplicateLines({
    body: 'عصير\nعصير',
    linePhotos: [],
    lineQuantities: [
      { lineIndex: 0, quantity: 2, unit: 'box' },
      { lineIndex: 1, quantity: 4, unit: 'box' },
    ],
    keepIndex: 0,
    removeIndices: [1],
  });
  assert.equal(mergedSame.unitMismatch, false);
  assert.equal(mergedSame.mergedQuantity, 6);
  assert.deepEqual(mergedSame.lineQuantities, [
    { lineIndex: 0, quantity: 6, unit: 'box' },
  ]);

  // backupSanitizer defaults & validation for autoTakeNoteNumber, noteUnitMode, noteDefaultUnit
  const defaults = sanitizeSettingsRecord({});
  assert.equal(defaults.autoTakeNoteNumber, false);
  assert.equal(defaults.noteUnitMode, 'per-product');
  assert.equal(defaults.noteDefaultUnit, 'none');

  const custom = sanitizeSettingsRecord({
    autoTakeNoteNumber: true,
    noteUnitMode: 'fixed',
    noteDefaultUnit: 'gram',
  });
  assert.equal(custom.autoTakeNoteNumber, true);
  assert.equal(custom.noteUnitMode, 'fixed');
  assert.equal(custom.noteDefaultUnit, 'gram');
});

test('computeStorageBreakdown computes separate photos, notes, and audio sizes accurately', () => {
  const b64Payload = 'A'.repeat(400); // ~300 decoded bytes
  const breakdown = computeStorageBreakdown({
    photos: [
      {
        id: 'p1',
        sessionId: 's1',
        timestamp: 1000,
        dateKey: '2026-11-24',
        dataUrl: `data:image/jpeg;base64,${b64Payload}`,
        thumbnailDataUrl: `data:image/jpeg;base64,${'B'.repeat(100)}`,
        width: 800,
        height: 600,
      },
    ],
    notes: [
      {
        id: 'n1',
        title: 'نواقص',
        body: 'حليب\nخبز',
        photos: [],
        linePhotos: [
          { lineIndex: 0, dataUrl: `data:image/jpeg;base64,${'C'.repeat(200)}` },
        ],
        numberingEnabled: true,
        resetAfterBlankLine: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    audioBytes: 12000,
  });

  assert.equal(breakdown.photosBytes, 300 + 75 + 256);
  assert.equal(breakdown.notesBytes, 5 * 2 + 8 * 2 + 256 + 150);
  assert.equal(breakdown.audioBytes, 12000);
  assert.equal(
    breakdown.totalBytes,
    breakdown.photosBytes + breakdown.notesBytes + breakdown.audioBytes
  );

  // Deprecated duplicateDebugEnabled toggle is stripped cleanly by sanitizeSettingsRecord
  const sanitized = sanitizeSettingsRecord({
    duplicateDebugEnabled: true,
    cameraHighQuality: false,
  } as Record<string, unknown>);
  assert.equal('duplicateDebugEnabled' in sanitized, false);
  assert.equal(sanitized.cameraHighQuality, false);
});

test('photoEnhancement: defaults, auto exposure gamma lift, highlight safety, and bright-scene no-op', () => {
  assert.equal(ENHANCE_TIMEOUT_MS, 8000);
  assert.equal(resolveEnhanceLevel(undefined), 'medium');
  assert.equal(resolveEnhanceLevel('off'), null);
  assert.equal(resolveEnhanceLevel('light'), 'light');
  assert.equal(resolveEnhanceLevel('strong'), 'strong');
  assert.equal(formatEnhanceLevelLabel('medium'), 'متوسط');

  // Dark scene (mean ~45) gets gamma in [0.6, 1.0) scaled by strength, and bright pixels do not clip > 255
  const darkAcc = createEmptyAnalyzeAccumulator();
  const darkW = 16;
  const darkH = 16;
  const darkBuf = new Uint8ClampedArray(darkW * darkH * 4);
  for (let i = 0; i < darkBuf.length; i += 4) {
    const pxIdx = i / 4;
    if (pxIdx < 4) {
      // Pure highlight pixels that must never clip past 255 or crush downward
      darkBuf[i] = 252;
      darkBuf[i + 1] = 252;
      darkBuf[i + 2] = 250;
    } else {
      darkBuf[i] = 42;
      darkBuf[i + 1] = 44;
      darkBuf[i + 2] = 40;
    }
    darkBuf[i + 3] = 255;
  }
  accumulateTileStats(darkAcc, darkBuf);
  const darkStats = finalizeImageStats(darkAcc);
  assert.ok(darkStats.meanLuminance < 80);

  const planLight = computeEnhancementPlan(darkStats, 'light');
  const planMed = computeEnhancementPlan(darkStats, 'medium');
  const planStrong = computeEnhancementPlan(darkStats, 'strong');
  assert.ok(planLight.gamma < 1.0 && planLight.gamma >= 0.6);
  assert.ok(planMed.gamma < planLight.gamma && planMed.gamma >= 0.6);
  assert.ok(planStrong.gamma <= planMed.gamma && planStrong.gamma >= 0.6);
  assert.equal(planMed.applyDenoise, true);

  const copyForRun = new Uint8ClampedArray(darkBuf);
  const res = enhanceRgbaBuffer(copyForRun, darkW, darkH, 'medium');
  assert.ok(res.afterLuminance > res.beforeLuminance + 8);
  assert.ok(copyForRun[0] >= 245 && copyForRun[0] <= 255);

  // Bright scene (mean >= 110) leaves gamma at 1.0 and skips dark noise reduction
  const brightAcc = createEmptyAnalyzeAccumulator();
  const brightBuf = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < brightBuf.length; i += 4) {
    brightBuf[i] = 160;
    brightBuf[i + 1] = 158;
    brightBuf[i + 2] = 155;
    brightBuf[i + 3] = 255;
  }
  accumulateTileStats(brightAcc, brightBuf);
  const brightPlan = computeEnhancementPlan(finalizeImageStats(brightAcc), 'strong');
  assert.equal(brightPlan.gamma, 1.0);
  assert.equal(brightPlan.applyDenoise, false);
});

test('photoEnhancement: white balance clamps strictly and skips single-color dominated scenes; contrast keeps color ratios', () => {
  // Moderate warm indoor cast -> WB runs and stays clamped within [0.95, 1.05] for light, [0.9, 1.1] for medium/strong
  const warmAcc = createEmptyAnalyzeAccumulator();
  const warmBuf = new Uint8ClampedArray(10 * 10 * 4);
  for (let i = 0; i < warmBuf.length; i += 4) {
    const shade = (i / 4) % 2 === 0 ? 110 : 145;
    warmBuf[i] = shade + 14;
    warmBuf[i + 1] = shade;
    warmBuf[i + 2] = shade - 14;
    warmBuf[i + 3] = 255;
  }
  accumulateTileStats(warmAcc, warmBuf);
  const warmStats = finalizeImageStats(warmAcc);
  assert.equal(warmStats.isSingleColorDominated, false);

  const wbLight = computeEnhancementPlan(warmStats, 'light');
  assert.equal(wbLight.wbSkipped, false);
  assert.ok(wbLight.rGain >= 0.95 && wbLight.rGain <= 1.05);
  assert.ok(wbLight.bGain >= 0.95 && wbLight.bGain <= 1.05);

  const wbStrong = computeEnhancementPlan(warmStats, 'strong');
  assert.equal(wbStrong.wbSkipped, false);
  assert.ok(wbStrong.rGain >= 0.9 && wbStrong.rGain <= 1.1);
  assert.ok(wbStrong.bGain >= 0.9 && wbStrong.bGain <= 1.1);
  assert.ok(wbStrong.bGain > wbStrong.rGain);

  // Single dominant red product scene -> WB is skipped
  const redAcc = createEmptyAnalyzeAccumulator();
  const redBuf = new Uint8ClampedArray(10 * 10 * 4);
  for (let i = 0; i < redBuf.length; i += 4) {
    redBuf[i] = 200;
    redBuf[i + 1] = 45;
    redBuf[i + 2] = 40;
    redBuf[i + 3] = 255;
  }
  accumulateTileStats(redAcc, redBuf);
  const redStats = finalizeImageStats(redAcc);
  assert.equal(redStats.isSingleColorDominated, true);
  const redPlan = computeEnhancementPlan(redStats, 'strong');
  assert.equal(redPlan.wbSkipped, true);
  assert.equal(redPlan.rGain, 1);
  assert.equal(redPlan.gGain, 1);
  assert.equal(redPlan.bGain, 1);

  // Contrast step applies identical RGB gain (with wbSkipped & zero saturation boost isolated)
  const testToneBuf = new Uint8ClampedArray([
    80, 100, 120, 255,
    160, 180, 200, 255,
  ]);
  const isolatedPlan = {
    ...wbStrong,
    gamma: 1,
    rGain: 1,
    gGain: 1,
    bGain: 1,
    satBoost: 0,
    contrastLow: 85,
    contrastHigh: 190,
    contrastScaleStrength: 0.7,
  };
  applyToneAndColorInPlace(testToneBuf, isolatedPlan);
  // Check ratio R:G:B of first pixel stays ~0.80 : 1.00 : 1.20
  const rRatio = testToneBuf[0] / testToneBuf[1];
  const bRatio = testToneBuf[2] / testToneBuf[1];
  assert.ok(Math.abs(rRatio - 0.8) < 0.04);
  assert.ok(Math.abs(bRatio - 1.2) < 0.04);
});

test('photoEnhancement settings defaults, originalDataUrl storage accounting, auto-cleanup, and diagnostics rows', () => {
  const defaultSettings = sanitizeSettingsRecord({});
  assert.equal(defaultSettings.photoEnhanceLevel, 'medium');
  assert.equal(defaultSettings.enhanceGalleryImports, false);
  assert.equal(defaultSettings.keepOriginalPhoto, false);

  const customSettings = sanitizeSettingsRecord({
    photoEnhanceLevel: 'strong',
    enhanceGalleryImports: true,
    keepOriginalPhoto: true,
  });
  assert.equal(customSettings.photoEnhanceLevel, 'strong');
  assert.equal(customSettings.enhanceGalleryImports, true);
  assert.equal(customSettings.keepOriginalPhoto, true);

  const cleanPhoto = sanitizePhotoRecord({
    id: 'ph_1',
    sessionId: 's_1',
    timestamp: 1000,
    dateKey: '2026-11-24',
    dataUrl: 'data:image/jpeg;base64,AAAA',
    originalDataUrl: 'data:image/jpeg;base64,BBBB',
    width: 100,
    height: 100,
    enhancementStatus: 'enhanced',
    enhancementLevel: 'medium',
  });
  assert.equal(cleanPhoto?.originalDataUrl, 'data:image/jpeg;base64,BBBB');
  assert.equal(cleanPhoto?.enhancementStatus, 'enhanced');
  assert.equal(cleanPhoto?.enhancementLevel, 'medium');

  const storage = computeStorageBreakdown({
    photos: [
      {
        id: 'p1',
        sessionId: 's1',
        timestamp: 1000,
        dateKey: '2026-11-24',
        dataUrl: `data:image/jpeg;base64,${'A'.repeat(400)}`,
        originalDataUrl: `data:image/jpeg;base64,${'B'.repeat(400)}`,
        width: 800,
        height: 600,
      },
    ],
    notes: [],
    audioBytes: 0,
  });
  assert.equal(storage.photosBytes, 300 + 300 + 256);

  const diagRows = buildCameraDiagnosticsRows({
    lastEnhanceMs: 142,
    lastEnhanceBeforeLuminance: 68.4,
    lastEnhanceAfterLuminance: 109.2,
    lastEnhanceLevel: 'medium',
  });
  assert.ok(
    diagRows.some(
      (r) =>
        r.label === 'تحسين الصور الأخير' && r.value.includes('متوسط') && r.value.includes('142 م.ث')
    )
  );
  assert.ok(
    diagRows.some(
      (r) => r.label === 'متوسط السطوع (قبل ← بعد)' && r.value === '68 → 109'
    )
  );
});

test('cameraPerf monitors adaptive FPS downgrade (>=3s below 20fps, never while capturing), summarizes 10s metrics & longtasks, and enforces 2Hz auto-flash cadence', () => {
  assert.equal(AUTO_FLASH_DEFAULTS.sampleIntervalMs, 500);
  assert.equal(ADAPTIVE_FPS_LOW_THRESHOLD, 20);
  assert.equal(ADAPTIVE_FPS_SUSTAIN_MS, 3000);
  assert.equal(PERF_TEST_DURATION_MS, 10000);

  // Preview resolution defaults and ladder target dimensions
  assert.equal(resolvePreviewResolutionSetting(undefined, undefined), 'auto');
  assert.equal(resolvePreviewResolutionSetting(undefined, false), '720p');
  assert.equal(resolvePreviewResolutionSetting('1080p', false), '1080p');
  assert.deepEqual(getTargetPreviewDims('auto'), {
    width: 1920,
    height: 1080,
    frameRate: 30,
  });
  assert.deepEqual(getTargetPreviewDims('720p'), {
    width: 1280,
    height: 720,
    frameRate: 30,
  });

  // Adaptive preview: resets timer if capturing or if FPS recovers above 20, triggers after 3s continuous <20fps
  let apState = createAdaptivePreviewState();
  let step = stepAdaptivePreviewState(apState, {
    mode: 'auto',
    currentFps: 15,
    nowMs: 1000,
    isCapturing: false,
  });
  apState = step.nextState;
  assert.equal(step.shouldDowngrade, false);

  // Interruption while capturing resets low-FPS window
  step = stepAdaptivePreviewState(apState, {
    mode: 'auto',
    currentFps: 12,
    nowMs: 3900,
    isCapturing: true,
  });
  apState = step.nextState;
  assert.equal(step.shouldDowngrade, false);
  assert.equal(apState.lowFpsSinceMs, null);

  // Restart low FPS window -> stays false at +2500ms, triggers at +3100ms
  step = stepAdaptivePreviewState(apState, {
    mode: 'auto',
    currentFps: 17,
    nowMs: 5000,
    isCapturing: false,
  });
  apState = step.nextState;
  step = stepAdaptivePreviewState(apState, {
    mode: 'auto',
    currentFps: 18,
    nowMs: 7500,
    isCapturing: false,
  });
  apState = step.nextState;
  assert.equal(step.shouldDowngrade, false);

  step = stepAdaptivePreviewState(apState, {
    mode: 'auto',
    currentFps: 16,
    nowMs: 8100,
    isCapturing: false,
  });
  apState = step.nextState;
  assert.equal(step.shouldDowngrade, true);
  assert.equal(apState.downgraded, true);

  // Fixed '1080p' setting must never downgrade
  const fixedResStep = stepAdaptivePreviewState(createAdaptivePreviewState(), {
    mode: '1080p',
    currentFps: 10,
    nowMs: 9000,
    isCapturing: false,
  });
  assert.equal(fixedResStep.shouldDowngrade, false);

  // Frame stats and longtasks report formatting
  const frameStats = computeVideoFrameStats([0, 33, 66, 200, 233]);
  assert.equal(frameStats.frameCount, 5);
  assert.equal(frameStats.longestGapMs, 134);
  assert.equal(frameStats.gapsOver100Ms, 1);
  assert.ok(frameStats.avgFps > 16 && frameStats.avgFps < 18);

  const longTasks = summarizeLongTasks([18, 52, 85.4, 30, 61]);
  assert.equal(longTasks.countOver50Ms, 3);
  assert.equal(longTasks.longestMs, 85.4);

  const report = buildCameraPerfReport({
    frameTimestampsMs: [0, 33.3, 66.6, 100],
    longTaskDurationsMs: [72],
    longTasksSupported: true,
    requestedWidth: 1920,
    requestedHeight: 1080,
    requestedFps: 30,
    actualWidth: 1920,
    actualHeight: 1080,
    captureMode: 'fast',
    diagnostics: {
      lastCaptureMs: 12,
      lastProcessingMs: 44,
      lastSavingMs: 8,
      lastEnhanceMs: 95,
      lastEnhanceLevel: 'medium',
    },
    durationMs: 10000,
  });
  const text = formatPerfReportText(report);
  assert.ok(text.includes('1920×1080 @ 30fps'));
  assert.ok(text.includes('سريع'));
  assert.ok(text.includes('95 م.ث'));
  assert.ok(text.includes('1 مهمة'));
});

test('backgroundCameraQueue serializes workers one-at-a-time, pauses 1.5s after shutter while camera is open, resumes immediately on leaving Capture tab, and batches photo writes', async () => {
  let fakeClock = 10000;
  const flushedBatches: number[] = [];

  __configureBackgroundQueueForTest({
    now: () => fakeClock,
    batchWriter: async (batch) => {
      flushedBatches.push(batch.length);
    },
    reset: true,
  });

  // 1) 1.5s shutter pause while Capture tab is active, immediate resume upon leaving
  setCaptureTabActive(true);
  notifyShutterPressed(10000);
  assert.equal(getRemainingShutterPauseMs(10500), 1000);
  assert.equal(getRemainingShutterPauseMs(11500), 0);
  assert.equal(SHUTTER_BACKGROUND_PAUSE_MS, 1500);

  let resumed = false;
  const waitPromise = waitForBackgroundSlot({ requireIdle: true }).then(() => {
    resumed = true;
  });
  assert.equal(resumed, false);
  // Leaving Capture tab cancels remaining pause immediately
  setCaptureTabActive(false);
  await waitPromise;
  assert.equal(resumed, true);

  // 2) Single-worker mutex prevents concurrent worker tasks
  let activeCount = 0;
  let maxConcurrent = 0;
  const makeWorkerTask = (delayMs: number) =>
    runExclusiveWorkerTask(async () => {
      activeCount++;
      maxConcurrent = Math.max(maxConcurrent, activeCount);
      await new Promise((r) => setTimeout(r, delayMs));
      activeCount--;
    });
  await Promise.all([makeWorkerTask(15), makeWorkerTask(15), makeWorkerTask(10)]);
  assert.equal(maxConcurrent, 1);

  // 3) Batched photo writes group small batches cleanly instead of single-shot saves inside shutter
  const samplePhoto = (id: string) => ({
    id,
    sessionId: 's_test',
    timestamp: 1000,
    dateKey: '2026-11-24',
    dataUrl: 'data:image/jpeg;base64,AA',
    width: 100,
    height: 100,
  });
  const p1 = enqueueBatchedPhotoWrite(samplePhoto('b1'));
  const p2 = enqueueBatchedPhotoWrite(samplePhoto('b2'));
  const p3 = enqueueBatchedPhotoWrite(samplePhoto('b3'));
  await flushPendingPhotoWritesNow();
  await Promise.all([p1, p2, p3]);
  assert.equal(flushedBatches.reduce((a, b) => a + b, 0), 3);

  __configureBackgroundQueueForTest({ reset: true });
});

test('batterySaver evaluates auto/always/off rules, overrides FPS/idle cleanly, tracks session time without polling, and formats measurement rows', () => {
  assert.equal(resolveCameraIdleTimeoutSec(undefined), 60);
  assert.equal(resolveCameraIdleTimeoutSec(30), 30);
  assert.equal(resolveCameraIdleTimeoutSec(120), 120);
  assert.equal(resolveCameraIdleTimeoutSec(0), 0);
  assert.equal(resolvePreviewFrameRateSetting(undefined), 24);
  assert.equal(resolvePreviewFrameRateSetting(15), 15);
  assert.equal(resolvePreviewFrameRateSetting(30), 30);
  assert.equal(resolveBatterySaverMode(undefined), 'auto');
  assert.equal(resolveBatterySaverMode('always'), 'always');

  // Auto threshold <=20% and not charging
  assert.equal(
    evaluateBatterySaverActive({
      mode: 'auto',
      batterySupported: true,
      level: 0.2,
      charging: false,
    }),
    true
  );
  assert.equal(
    evaluateBatterySaverActive({
      mode: 'auto',
      batterySupported: true,
      level: 0.15,
      charging: true,
    }),
    false
  );
  assert.equal(
    evaluateBatterySaverActive({
      mode: 'auto',
      batterySupported: true,
      level: 0.25,
      charging: false,
    }),
    false
  );
  assert.equal(
    evaluateBatterySaverActive({
      mode: 'auto',
      batterySupported: false,
      level: null,
      charging: null,
    }),
    false
  );
  assert.equal(
    evaluateBatterySaverActive({
      mode: 'always',
      batterySupported: false,
      level: null,
      charging: null,
    }),
    true
  );
  assert.equal(
    evaluateBatterySaverActive({
      mode: 'off',
      batterySupported: true,
      level: 0.05,
      charging: false,
    }),
    false
  );

  // Forced 15fps & 30s idle when Battery Saver ON
  const normalProfile = getEffectiveCameraPowerProfile({
    settings: {
      cameraIdleTimeoutSec: 120,
      previewFrameRate: 24,
      batterySaverMode: 'auto',
    },
    isBatterySaverOn: false,
  });
  assert.deepEqual(normalProfile, { frameRate: 24, idleTimeoutSec: 120 });

  const saverProfile = getEffectiveCameraPowerProfile({
    settings: {
      cameraIdleTimeoutSec: 0,
      previewFrameRate: 30,
      batterySaverMode: 'always',
    },
    isBatterySaverOn: true,
  });
  assert.deepEqual(saverProfile, { frameRate: 15, idleTimeoutSec: 30 });

  // Session timestamp tracker without polling timers
  __resetSessionPowerTrackerForTest();
  markCameraSessionStarted(1000);
  assert.equal(getSessionCameraActiveMs(6000), 5000);
  markCameraSessionStopped(11000);
  markCameraSessionStarted(20000);
  assert.equal(getSessionCameraActiveMs(25000), 15000);
  incrementSessionCaptureCount();
  incrementSessionCaptureCount();
  assert.equal(getSessionCaptureCount(), 2);
  assert.equal(formatSessionDurationArabic(75000), '1 د 15 ث');

  const rows = buildBatteryMeasurementRows({
    cameraActiveMs: 75000,
    sessionCaptures: 2,
    batterySupported: true,
    initialBatteryLevel: 0.84,
    currentBatteryLevel: 0.19,
    batteryCharging: false,
    batterySaverOn: true,
    batterySaverMode: 'auto',
  });
  assert.ok(rows.some((r) => r.value === '1 د 15 ث'));
  assert.ok(rows.some((r) => r.value === '84%'));
  assert.ok(rows.some((r) => r.value === '19%'));
  const clip = formatBatteryMeasurementClipboardText({
    cameraActiveMs: 75000,
    sessionCaptures: 2,
    batterySupported: false,
    initialBatteryLevel: null,
    currentBatteryLevel: null,
    batteryCharging: null,
    batterySaverOn: false,
    batterySaverMode: 'auto',
  });
  assert.ok(clip.includes('غير مدعوم في هذا المتصفح'));
  __resetSessionPowerTrackerForTest();
});

test('cameraStartup preserves preview resolution across 15/24/30fps, adaptive preview does not falsely downgrade 15fps mode, and backupSanitizer validates power fields', () => {
  const attempts15 = buildCameraConstraintAttempts(true, 'auto', 15);
  const firstVideo = attempts15[0].video as MediaTrackConstraints;
  assert.deepEqual(firstVideo.width, { ideal: 1920 });
  assert.deepEqual(firstVideo.height, { ideal: 1080 });
  assert.deepEqual(firstVideo.frameRate, { ideal: 15, max: 15 });
  assert.deepEqual(getTargetPreviewDims('1080p', 15), {
    width: 1920,
    height: 1080,
    frameRate: 15,
  });

  // Steady 15fps when targetFps is 15 must NOT trigger 720p downgrade
  let st = createAdaptivePreviewState();
  for (let t = 0; t <= 4000; t += 1000) {
    const step = stepAdaptivePreviewState(st, {
      mode: 'auto',
      targetFps: 15,
      currentFps: 14,
      nowMs: t,
      isCapturing: false,
    });
    st = step.nextState;
    assert.equal(step.shouldDowngrade, false);
  }

  const sanitized = sanitizeSettingsRecord({
    previewFrameRate: 15,
    cameraIdleTimeoutSec: 120,
    batterySaverMode: 'always',
  });
  assert.equal(sanitized.previewFrameRate, 15);
  assert.equal(sanitized.cameraIdleTimeoutSec, 120);
  assert.equal(sanitized.batterySaverMode, 'always');

  const fallbackSanitized = sanitizeSettingsRecord({
    previewFrameRate: 99,
    cameraIdleTimeoutSec: 999,
    batterySaverMode: 'bad',
  });
  assert.equal(fallbackSanitized.previewFrameRate, 24);
  assert.equal(fallbackSanitized.cameraIdleTimeoutSec, 60);
  assert.equal(fallbackSanitized.batterySaverMode, 'auto');
});

test('waitForEnhancementSlot enforces 10s idle on Capture tab, pauses under Battery Saver until leaving Capture, and pauses while page is hidden', async () => {
  let fakeClock = 50000;
  __configureBackgroundQueueForTest({
    now: () => fakeClock,
    reset: true,
  });

  assert.equal(ENHANCEMENT_IDLE_PAUSE_MS, 10000);
  setCaptureTabActive(true);
  notifyCameraActivity(50000);
  assert.equal(getRemainingEnhancementIdleMs(53000), 7000);
  assert.equal(getRemainingEnhancementIdleMs(60000), 0);

  // Battery Saver ON + Capture tab active pauses enhancement slot indefinitely until leaving Capture tab
  setBatterySaverActive(true);
  assert.equal(isBatterySaverQueuePaused(), true);
  let slotReady = false;
  const p = waitForEnhancementSlot().then(() => {
    slotReady = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(slotReady, false);

  // Page hidden also stays paused even off Capture tab
  setPageHidden(true);
  setCaptureTabActive(false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(slotReady, false);

  // Restoring visibility off Capture tab unblocks immediately
  setPageHidden(false);
  await p;
  assert.equal(slotReady, true);

  __configureBackgroundQueueForTest({ reset: true });
});

test('pwaDiagnostics validates manifest, registration origin guard, iframe/top-level rows, and clipboard formatting', () => {
  // Origin guard: only HTTPS or localhost
  assert.equal(shouldRegisterServiceWorker('https:', 'example.com'), true);
  assert.equal(shouldRegisterServiceWorker('http:', 'localhost'), true);
  assert.equal(shouldRegisterServiceWorker('http:', '127.0.0.1'), true);
  assert.equal(shouldRegisterServiceWorker('http:', '[::1]'), true);
  assert.equal(shouldRegisterServiceWorker('http:', '192.168.1.50'), false);
  assert.equal(shouldRegisterServiceWorker('file:', ''), false);

  // Real manifest.webmanifest + icons + index.html + sw.js contracts
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, 'public', 'manifest.webmanifest');
  const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifestRaw.name, 'نقص الرفوف');
  assert.equal(manifestRaw.short_name, 'نقص الرفوف');
  assert.equal(manifestRaw.lang, 'ar');
  assert.equal(manifestRaw.dir, 'rtl');
  assert.equal(manifestRaw.start_url, '/');
  assert.equal(manifestRaw.scope, '/');
  assert.equal(manifestRaw.display, 'standalone');
  assert.equal(manifestRaw.orientation, 'portrait');
  assert.equal(manifestRaw.background_color, '#0F172A');
  assert.equal(manifestRaw.theme_color, '#0F172A');

  const manifestValidation = validateManifestPayload(manifestRaw);
  assert.equal(manifestValidation.valid, true);
  assert.equal(manifestValidation.icon192Src, '/pwa-192x192.png');
  assert.equal(manifestValidation.icon512Src, '/pwa-512x512.png');

  // Verify maskable 512x512 icon exists in manifest & PNG IHDR sizes match
  assert.ok(
    manifestRaw.icons.some(
      (i: { sizes?: string; purpose?: string; type?: string }) =>
        i.sizes === '512x512' && i.purpose === 'maskable' && i.type === 'image/png'
    )
  );
  const readPngDims = (rel: string) => {
    const buf = fs.readFileSync(path.join(rootDir, 'public', rel));
    assert.equal(buf.toString('ascii', 1, 4), 'PNG');
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  };
  assert.deepEqual(readPngDims('pwa-192x192.png'), { width: 192, height: 192 });
  assert.deepEqual(readPngDims('pwa-512x512.png'), { width: 512, height: 512 });
  assert.deepEqual(readPngDims('pwa-maskable-512x512.png'), { width: 512, height: 512 });

  // Verify index.html & sw.js contracts
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert.ok(html.includes('<link rel="manifest" href="/manifest.webmanifest"'));
  assert.ok(html.includes('<link rel="apple-touch-icon"'));
  assert.ok(html.includes('<meta name="theme-color"'));

  const swSource = fs.readFileSync(path.join(rootDir, 'public', 'sw.js'), 'utf8');
  assert.ok(swSource.includes("addEventListener('fetch'"));
  assert.ok(swSource.includes('caches.delete'));
  assert.ok(swSource.includes('handleNetworkFirst'));
  assert.ok(swSource.includes('handleCacheFirst'));

  // Invalid manifest rejections
  assert.equal(validateManifestPayload(null).valid, false);
  assert.equal(
    validateManifestPayload({ ...manifestRaw, display: 'browser' }).valid,
    false
  );
  assert.equal(
    validateManifestPayload({
      ...manifestRaw,
      icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
    }).valid,
    false
  );

  // Diagnostics rows & clipboard formatting for iframe vs top-level
  const iframeRows = buildPwaDiagnosticsRows({
    manifestValid: true,
    iconsLoaded: true,
    swRegisteredAndActive: false,
    swDetails: 'غير مسجّل',
    isHttps: true,
    protocol: 'https:',
    isInIframe: true,
    isStandalone: false,
    lastError: 'SecurityError: preview frame',
  });
  assert.equal(iframeRows.find((r) => r.key === 'manifest')?.value, 'نعم');
  assert.equal(iframeRows.find((r) => r.key === 'icons')?.value, 'نعم');
  assert.ok(iframeRows.find((r) => r.key === 'sw')?.value.startsWith('لا'));
  assert.equal(iframeRows.find((r) => r.key === 'https')?.value, 'نعم');
  assert.equal(
    iframeRows.find((r) => r.key === 'iframe')?.value,
    'نعم (إطار معاينة)'
  );
  assert.equal(
    iframeRows.find((r) => r.key === 'lastError')?.value,
    'SecurityError: preview frame'
  );

  const iframeClip = formatPwaDiagnosticsClipboardText({
    manifestValid: true,
    iconsLoaded: true,
    swRegisteredAndActive: true,
    isHttps: true,
    protocol: 'https:',
    isInIframe: true,
    isStandalone: false,
    lastError: null,
  });
  assert.ok(iframeClip.includes(IFRAME_INSTALL_WARNING_TEXT));
  assert.ok(iframeClip.includes('آخر خطأ: لا يوجد'));
});

test('music duplicate prevention catches identical content hashes, normalized title+duration, and duplicate radio URLs while keeping mobile multi-file picker clean', async () => {
  // Audio picker accept excludes video/mp4 and video/webm so Android opens file/audio picker instead of empty video gallery
  assert.equal(AUDIO_PICKER_ACCEPT.includes('video/'), false);
  assert.equal(AUDIO_PICKER_ACCEPT.includes('.mp4'), false);
  assert.ok(AUDIO_PICKER_ACCEPT.includes('audio/*'));
  assert.ok(AUDIO_PICKER_ACCEPT.includes('.mp3'));

  // Directory picker must be disabled on mobile user agents (Android/iPhone), even in Node/DOM
  assert.equal(
    supportsDirectorySelection(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
    ),
    false
  );
  assert.equal(
    supportsDirectorySelection(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    ),
    false
  );

  // Extended mobile audio extensions and Ogg MIME
  assert.equal(isSupportedAudioFile({ name: 'voice.amr', type: '', size: 512 }), true);
  assert.equal(isSupportedAudioFile({ name: 'memo.3gp', type: '', size: 512 }), true);
  assert.equal(isSupportedAudioFile({ name: 'track.oga', type: 'application/ogg', size: 512 }), true);

  // Content hashing detects renamed copies of the exact same song
  const bufA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  const bufB = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]).buffer;
  const hashA = await computeAudioContentHash(bufA);
  const hashA2 = await computeAudioContentHash(bufA);
  const hashB = await computeAudioContentHash(bufB);
  assert.equal(hashA, hashA2);
  assert.notEqual(hashA, hashB);

  const existing: MusicTrackRecord[] = [
    {
      id: 'tr_1',
      kind: 'file',
      title: 'أنشودة الصباح',
      fileName: 'morning.mp3',
      duration: 120.4,
      size: 2048,
      contentHash: hashA,
      order: 0,
      missingFile: false,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'rad_1',
      kind: 'radio',
      title: 'إذاعة',
      streamUrl: 'https://Example.COM/stream/',
      duration: 0,
      size: 0,
      order: 1,
      missingFile: false,
      createdAt: 2,
      updatedAt: 2,
    },
  ];

  // Renamed duplicate with matching content hash is rejected
  assert.equal(
    isDuplicateAudioFile(existing, new Set(), 'morning (1).mp3', 2048, hashA, new Set()),
    true
  );
  // Same batch content hash is also rejected
  assert.equal(
    isDuplicateAudioFile([], new Set(), 'copy.mp3', 2048, hashB, new Set([hashB])),
    true
  );
  // Different content hash and filename passes
  assert.equal(
    isDuplicateAudioFile(existing, new Set(), 'other.mp3', 2048, hashB, new Set()),
    false
  );

  // Normalized title + matching duration within 1s is flagged duplicate; differing duration passes
  assert.equal(normalizeAudioTitleForDuplicate('  صباح__الخير  '), 'صباح الخير');
  assert.equal(
    isDuplicateAudioTitleAndDuration(existing, [], 'أنشودة_الصباح', 120.8),
    true
  );
  assert.equal(
    isDuplicateAudioTitleAndDuration(existing, [], 'أنشودة_الصباح', 125),
    false
  );
  assert.equal(
    isDuplicateAudioTitleAndDuration(
      [],
      [{ titleNorm: 'نغمة هادئة', duration: 45 }],
      'نغمة-هادئة',
      45.2
    ),
    true
  );

  // Radio stream URL deduplication (host case-insensitive & trailing slash ignored)
  assert.equal(normalizeRadioStreamUrl('https://Example.com/live/'), 'https://example.com/live');
  assert.equal(isDuplicateRadioStation(existing, 'https://example.com/stream'), true);
  assert.equal(isDuplicateRadioStation(existing, 'https://example.com/other'), false);
});
