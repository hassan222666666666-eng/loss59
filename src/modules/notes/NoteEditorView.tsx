import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowRight,
  Calculator,
  Camera,
  Check,
  Copy,
  CopyCheck,
  Delete,
  Eye,
  Hash,
  ImagePlus,
  ListRestart,
  MoreHorizontal,
  Package,
  Plus,
  Settings2,
  Share2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AppSettings,
  NoteCopyDigitStyle,
  NoteCopySortOrder,
  NoteDefaultUnit,
  NoteItem,
  NoteLinePhoto,
  NoteLineQuantity,
  NotePhoto,
  NoteQuantityUnit,
  NoteUnitMode,
} from '../../types';
import { compressCanvasToJpeg, fileOrDataUrlToCanvas } from '../camera/imageCompression';
import { useVisualViewport } from '../../hooks/useVisualViewport';
import { formatDayHeading, getLocalDateKey } from '../../utils/arabicText';
import {
  CalculatorState,
  applyCalculatorKey,
  computeNoteTotal,
  formatMathNumber,
  getCalculatorLiveResult,
  parseNoteLineMath,
} from './mathParser';
import { realignLinePhotosAfterEdit } from './linePhotoAlignment';
import {
  computeVisualLineNumbers,
  formatNoteForCopy,
  formatNoteForWhatsApp,
} from './noteFormat';
import {
  formatSentTimestampArabic,
  openWhatsAppDirect,
  shareNoteViaOtherApp,
} from './whatsapp';
import { WhatsAppIcon, WhatsAppSendSheet } from './WhatsAppSendSheet';
import {
  DuplicateGroup,
  deleteDuplicateLinesBulk,
  mergeDuplicateLines,
  scanNoteDuplicates,
} from './duplicateDetector';
import {
  NOTE_QUANTITY_UNIT_OPTIONS,
  computeNoteQuantitiesSummary,
  computeToolbarVisibleCount,
  extractAutoTakeQuantityAndUnit,
  formatQuantityNumber,
  formatQuantityUnitLabel,
  parseQuantityNumberInput,
  realignLineQuantitiesAfterEdit,
  roundQuantityValue,
} from './quantityLogic';
import {
  forgetUnitForProduct,
  loadProductUnitMemory,
  rememberUnitForProduct,
  resolveQuantityUnit,
} from './unitMemory';
import { NoteSettingsSheet } from './NoteSettingsSheet';

interface NoteEditorViewProps {
  note: NoteItem;
  includeTotalInWhatsApp: boolean;
  defaultNoteNumbering?: boolean;
  defaultNoteQuantities?: boolean;
  autoTakeNoteNumber?: boolean;
  noteUnitMode?: NoteUnitMode;
  noteDefaultUnit?: NoteDefaultUnit;
  noteCopySortOrder?: NoteCopySortOrder;
  noteCopyDigitStyle?: NoteCopyDigitStyle;
  noteCopyIncludeTotalQuantities?: boolean;
  onToggleIncludeTotalInWhatsApp: (next: boolean) => void;
  onUpdateNoteSettings?: (partial: Partial<AppSettings>) => void;
  onChangeNote: (updated: NoteItem) => Promise<void>;
  onKeyboardOpenChange?: (isOpen: boolean) => void;
  onClose: () => void;
}

const KEYPAD_BUTTONS = [
  ['(', ')', '÷', '⌫'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['C', '0', '.', '='],
];

type FullscreenPhotoTarget =
  | { kind: 'attachment'; photo: NotePhoto }
  | { kind: 'linePhoto'; lineIndex: number; dataUrl: string };

export const NoteEditorView: React.FC<NoteEditorViewProps> = ({
  note,
  includeTotalInWhatsApp,
  defaultNoteNumbering = false,
  defaultNoteQuantities = true,
  autoTakeNoteNumber = false,
  noteUnitMode = 'per-product',
  noteDefaultUnit = 'none',
  noteCopySortOrder = 'as-written',
  noteCopyDigitStyle = 'western',
  noteCopyIncludeTotalQuantities = false,
  onToggleIncludeTotalInWhatsApp,
  onUpdateNoteSettings,
  onChangeNote,
  onKeyboardOpenChange,
  onClose,
}) => {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [photos, setPhotos] = useState<NotePhoto[]>(note.photos || []);
  const [linePhotos, setLinePhotos] = useState<NoteLinePhoto[]>(
    note.linePhotos || []
  );
  const [numberingEnabled, setNumberingEnabled] = useState(
    Boolean(note.numberingEnabled)
  );
  const [resetAfterBlankLine, setResetAfterBlankLine] = useState(
    Boolean(note.resetAfterBlankLine)
  );
  const [quantitiesEnabled, setQuantitiesEnabled] = useState(
    Boolean(note.quantitiesEnabled)
  );
  const [lineQuantities, setLineQuantities] = useState<NoteLineQuantity[]>(
    note.lineQuantities || []
  );
  const [keptDuplicatePairs, setKeptDuplicatePairs] = useState<string[]>(
    note.keptDuplicatePairs || []
  );
  const [lastSentAt, setLastSentAt] = useState<number | undefined>(
    note.lastSentAt
  );

  const [copiedTotal, setCopiedTotal] = useState(false);
  const [copiedNote, setCopiedNote] = useState(false);
  const [showCalcSheet, setShowCalcSheet] = useState(false);
  const [showWhatsAppSheet, setShowWhatsAppSheet] = useState(false);
  const [showToolbarMoreMenu, setShowToolbarMoreMenu] = useState(false);
  const [showPhotoSourceMenu, setShowPhotoSourceMenu] = useState(false);
  const [showCopyPreviewSheet, setShowCopyPreviewSheet] = useState(false);
  const [showNoteSettingsSheet, setShowNoteSettingsSheet] = useState(false);
  const [activeQtyLineIndex, setActiveQtyLineIndex] = useState<number | null>(
    null
  );
  const [qtyDraft, setQtyDraft] = useState('');
  const activeQtyLineRef = useRef<number | null>(null);
  const qtyDraftRef = useRef('');
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [topUnitNotice, setTopUnitNotice] = useState<string | null>(null);
  const topUnitNoticeTimerRef = useRef<number | null>(null);
  const [showDuplicateCheckSheet, setShowDuplicateCheckSheet] = useState(false);
  const [unitMismatchGroupIds, setUnitMismatchGroupIds] = useState<string[]>([]);
  const [calcState, setCalcState] = useState<CalculatorState>({
    expression: '',
    justEvaluated: false,
  });

  // Top toolbar width measurement so overflowing trailing actions move cleanly into "⋯"
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarWidth, setToolbarWidth] = useState(360);

  // Keyboard & visualViewport tracking
  const viewport = useVisualViewport();
  const [isFieldFocused, setIsFieldFocused] = useState(false);
  const blurTimerRef = useRef<number | null>(null);
  const wasViewportShrunkRef = useRef(false);
  const [caretPos, setCaretPos] = useState(0);

  // Focus line tracking & undo state for manual duplicate actions
  const activeUnnumberedLineRef = useRef<number>(0);
  const focusedNumberedLineRef = useRef<number | null>(null);
  const [duplicateUndo, setDuplicateUndo] = useState<{
    previousBody: string;
    previousLinePhotos: NoteLinePhoto[];
    previousLineQuantities: NoteLineQuantity[];
    label: string;
  } | null>(null);
  const duplicateUndoTimerRef = useRef<number | null>(null);

  // Non-blocking inline auto-take feedback: 0.5s box highlight + 4s tiny undo icon beside that box
  const [highlightedQtyLineIndex, setHighlightedQtyLineIndex] = useState<
    number | null
  >(null);
  const highlightQtyTimerRef = useRef<number | null>(null);
  const [autoTakeUndo, setAutoTakeUndo] = useState<{
    lineIndex: number;
    previousBody: string;
    previousLinePhotos: NoteLinePhoto[];
    previousLineQuantities: NoteLineQuantity[];
    fading: boolean;
  } | null>(null);
  const autoTakeUndoFadeTimerRef = useRef<number | null>(null);
  const autoTakeUndoClearTimerRef = useRef<number | null>(null);

  // Long-press handling on "نسخ" button -> opens "معاينة النسخ"
  const copyLongPressTimerRef = useRef<number | null>(null);
  const copyLongPressTriggeredRef = useRef(false);

  // Side-picture slot menu (Camera & Gallery only)
  const [menuLineIndex, setMenuLineIndex] = useState<number | null>(null);
  const pendingLineTargetRef = useRef<number | null>(null);

  // Fullscreen photo viewer (works for both note attachments & numbered line side pictures)
  const [viewerTarget, setViewerTarget] =
    useState<FullscreenPhotoTarget | null>(null);
  const [viewerZoom, setViewerZoom] = useState(1);
  const pinchDistRef = useRef<number | null>(null);
  const pinchZoomRef = useRef(1);

  // Long-press handling on line side pictures
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  // Refs for scrollable editor area, plain-mode textarea, and per-line inputs
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const caretMarkerRef = useRef<HTMLSpanElement | null>(null);
  const lineInputRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const qtyInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lineRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const activeLineIndexRef = useRef<number | null>(null);
  const mirrorRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [lineMetrics, setLineMetrics] = useState<
    Array<{ top: number; height: number }>
  >([]);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const lineCameraInputRef = useRef<HTMLInputElement | null>(null);
  const lineGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const onChangeNoteRef = useRef(onChangeNote);
  onChangeNoteRef.current = onChangeNote;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const rawLinesRef = useRef<string[]>(body.split('\n'));
  rawLinesRef.current = body.split('\n');
  const quantitiesEnabledRef = useRef(quantitiesEnabled);
  quantitiesEnabledRef.current = quantitiesEnabled;
  const autoTakeNoteNumberRef = useRef(autoTakeNoteNumber);
  autoTakeNoteNumberRef.current = autoTakeNoteNumber;
  const noteUnitModeRef = useRef<NoteUnitMode>(noteUnitMode);
  noteUnitModeRef.current = noteUnitMode;
  const noteDefaultUnitRef = useRef<NoteDefaultUnit>(noteDefaultUnit);
  noteDefaultUnitRef.current = noteDefaultUnit;
  const lineQuantitiesRef = useRef<NoteLineQuantity[]>(lineQuantities);
  lineQuantitiesRef.current = lineQuantities;
  const linePhotosRef = useRef<NoteLinePhoto[]>(linePhotos);
  linePhotosRef.current = linePhotos;

  const isPerLineMode = numberingEnabled || quantitiesEnabled;
  const isKeyboardMode = isFieldFocused;

  // Notify root App when keyboard opens/closes so BottomNav hides cleanly
  useEffect(() => {
    onKeyboardOpenChange?.(isKeyboardMode);
  }, [isKeyboardMode, onKeyboardOpenChange]);

  useEffect(() => {
    return () => {
      onKeyboardOpenChange?.(false);
      if (duplicateUndoTimerRef.current !== null) {
        window.clearTimeout(duplicateUndoTimerRef.current);
      }
      if (topUnitNoticeTimerRef.current !== null) {
        window.clearTimeout(topUnitNoticeTimerRef.current);
      }
      if (highlightQtyTimerRef.current !== null) {
        window.clearTimeout(highlightQtyTimerRef.current);
      }
      if (autoTakeUndoFadeTimerRef.current !== null) {
        window.clearTimeout(autoTakeUndoFadeTimerRef.current);
      }
      if (autoTakeUndoClearTimerRef.current !== null) {
        window.clearTimeout(autoTakeUndoClearTimerRef.current);
      }
      if (copyLongPressTimerRef.current !== null) {
        window.clearTimeout(copyLongPressTimerRef.current);
      }
    };
  }, [onKeyboardOpenChange]);

  // Measure toolbar row width so excess trailing actions move cleanly into "⋯"
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || isKeyboardMode) return;
    const updateWidth = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setToolbarWidth(w);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateWidth());
    ro.observe(el);
    return () => ro.disconnect();
  }, [isKeyboardMode]);

  // Autosave whenever fields change
  useEffect(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      onChangeNoteRef.current({
        ...note,
        title,
        body,
        photos,
        linePhotos,
        numberingEnabled,
        resetAfterBlankLine,
        quantitiesEnabled,
        lineQuantities,
        keptDuplicatePairs,
        lastSentToName: undefined,
        lastSentAt,
        updatedAt: Date.now(),
      });
    }, 180);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [
    title,
    body,
    photos,
    linePhotos,
    numberingEnabled,
    resetAfterBlankLine,
    quantitiesEnabled,
    lineQuantities,
    keptDuplicatePairs,
    lastSentAt,
  ]);

  const rawLines = useMemo(() => body.split('\n'), [body]);
  const mathAnalysis = useMemo(() => computeNoteTotal(body), [body]);

  // Compute visual margin numbers (never written into note.body)
  const lineNumbers = useMemo(
    () =>
      computeVisualLineNumbers(
        rawLines,
        numberingEnabled,
        resetAfterBlankLine
      ),
    [rawLines, numberingEnabled, resetAfterBlankLine]
  );

  const lineQuantityMap = useMemo(() => {
    const map = new Map<
      number,
      { quantity: number; unit?: NoteQuantityUnit }
    >();
    for (const q of lineQuantities) {
      if (Number.isFinite(q.quantity) && q.quantity > 0) {
        map.set(q.lineIndex, {
          quantity: roundQuantityValue(q.quantity),
          ...(q.unit ? { unit: q.unit } : {}),
        });
      }
    }
    return map;
  }, [lineQuantities]);

  const quantitiesSummary = useMemo(
    () => computeNoteQuantitiesSummary(rawLines, lineQuantities),
    [rawLines, lineQuantities]
  );

  const keptPairKeysSet = useMemo(
    () => new Set(keptDuplicatePairs),
    [keptDuplicatePairs]
  );

  // Manual duplicate scan only runs on demand when the user opens "فحص التكرار"
  const manualScanResult = useMemo(() => {
    if (!showDuplicateCheckSheet) {
      return {
        groups: [],
        totalExtraDuplicates: 0,
        duplicateBadgeLineIndices: [] as number[],
      };
    }
    return scanNoteDuplicates({
      lines: rawLines,
      visualLineNumbers: lineNumbers,
      keptPairKeys: keptPairKeysSet,
      ignoreTrailingQuantity: quantitiesEnabled,
    });
  }, [
    showDuplicateCheckSheet,
    rawLines,
    lineNumbers,
    keptPairKeysSet,
    quantitiesEnabled,
  ]);

  const linePhotoMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const lp of linePhotos) {
      map.set(lp.lineIndex, lp.dataUrl);
    }
    return map;
  }, [linePhotos]);

  // Keep active line / caret strictly visible above the keyboard
  const scrollCaretOrLineIntoView = useCallback(() => {
    const sc = scrollContainerRef.current;
    if (!sc) return;

    const scRect = sc.getBoundingClientRect();
    if (scRect.height <= 0) return;

    const topPadding = 12;
    const bottomClearance = 68; // Space above keyboard + floating "تم" button

    let targetTop: number | null = null;
    let targetBottom: number | null = null;

    if (isPerLineMode && activeLineIndexRef.current !== null) {
      const idx = activeLineIndexRef.current;
      const ta = lineInputRefs.current[idx];
      const rowEl = lineRowRefs.current[idx] || ta;
      if (rowEl) {
        const rect = rowEl.getBoundingClientRect();
        // For multi-line wrapped textareas, estimate caret vertical band inside the textarea
        if (ta && rect.height > 64 && ta.value.length > 0) {
          const sel = ta.selectionStart ?? ta.value.length;
          const ratio = Math.max(0, Math.min(1, sel / ta.value.length));
          const taRect = ta.getBoundingClientRect();
          const estY = taRect.top + ratio * Math.max(36, taRect.height - 24);
          targetTop = Math.max(rect.top, estY - 12);
          targetBottom = Math.min(rect.bottom, estY + 40);
        } else {
          targetTop = rect.top;
          targetBottom = rect.bottom;
        }
      }
    } else if (!isPerLineMode && caretMarkerRef.current) {
      const markerRect = caretMarkerRef.current.getBoundingClientRect();
      targetTop = markerRect.top;
      targetBottom = markerRect.bottom;
    }

    if (targetTop === null || targetBottom === null) return;

    const maxBottom = scRect.bottom - bottomClearance;
    const minTop = scRect.top + topPadding;

    if (targetBottom > maxBottom) {
      sc.scrollTop += targetBottom - maxBottom;
    } else if (targetTop < minTop) {
      sc.scrollTop -= minTop - targetTop;
    }
  }, [isPerLineMode]);

  const scheduleScrollActiveLine = useCallback(
    (includeDelayedRetries: boolean = false) => {
      requestAnimationFrame(() => {
        scrollCaretOrLineIntoView();
      });
      if (includeDelayedRetries) {
        window.setTimeout(() => scrollCaretOrLineIntoView(), 90);
        window.setTimeout(() => scrollCaretOrLineIntoView(), 260);
      }
    },
    [scrollCaretOrLineIntoView]
  );

  const showTopUnitNotice = useCallback(
    (message: string, durationMs: number = 2200) => {
      if (topUnitNoticeTimerRef.current !== null) {
        window.clearTimeout(topUnitNoticeTimerRef.current);
      }
      setTopUnitNotice(message);
      topUnitNoticeTimerRef.current = window.setTimeout(() => {
        setTopUnitNotice(null);
        topUnitNoticeTimerRef.current = null;
      }, durationMs);
    },
    []
  );

  const clearAutoTakeTimers = useCallback(() => {
    if (highlightQtyTimerRef.current !== null) {
      window.clearTimeout(highlightQtyTimerRef.current);
      highlightQtyTimerRef.current = null;
    }
    if (autoTakeUndoFadeTimerRef.current !== null) {
      window.clearTimeout(autoTakeUndoFadeTimerRef.current);
      autoTakeUndoFadeTimerRef.current = null;
    }
    if (autoTakeUndoClearTimerRef.current !== null) {
      window.clearTimeout(autoTakeUndoClearTimerRef.current);
      autoTakeUndoClearTimerRef.current = null;
    }
  }, []);

  const triggerAutoTakeFeedback = useCallback(
    (
      lineIndex: number,
      previousBody: string,
      previousLinePhotos: NoteLinePhoto[],
      previousLineQuantities: NoteLineQuantity[]
    ) => {
      clearAutoTakeTimers();
      setHighlightedQtyLineIndex(lineIndex);
      setAutoTakeUndo({
        lineIndex,
        previousBody,
        previousLinePhotos,
        previousLineQuantities,
        fading: false,
      });
      highlightQtyTimerRef.current = window.setTimeout(() => {
        setHighlightedQtyLineIndex(null);
        highlightQtyTimerRef.current = null;
      }, 520);
      autoTakeUndoFadeTimerRef.current = window.setTimeout(() => {
        setAutoTakeUndo((prev) => (prev ? { ...prev, fading: true } : null));
        autoTakeUndoFadeTimerRef.current = null;
      }, 3650);
      autoTakeUndoClearTimerRef.current = window.setTimeout(() => {
        setAutoTakeUndo(null);
        autoTakeUndoClearTimerRef.current = null;
      }, 4000);
    },
    [clearAutoTakeTimers]
  );

  const handleUndoAutoTake = useCallback(() => {
    if (!autoTakeUndo) return;
    clearAutoTakeTimers();
    const targetIdx = autoTakeUndo.lineIndex;
    const restoredBody = autoTakeUndo.previousBody;
    const restoredPhotos = autoTakeUndo.previousLinePhotos;
    const restoredQuantities = autoTakeUndo.previousLineQuantities;
    const restoredLineCount = restoredBody.split('\n').length;

    bodyRef.current = restoredBody;
    linePhotosRef.current = restoredPhotos;
    lineQuantitiesRef.current = restoredQuantities;
    flushSync(() => {
      setBody(restoredBody);
      setLinePhotos(restoredPhotos);
      setLineQuantities(restoredQuantities);
      setAutoTakeUndo(null);
      setHighlightedQtyLineIndex(null);
    });

    const focusIdx = Math.min(targetIdx, Math.max(0, restoredLineCount - 1));
    focusedNumberedLineRef.current = focusIdx;
    activeLineIndexRef.current = focusIdx;
    const el = lineInputRefs.current[focusIdx];
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [autoTakeUndo, clearAutoTakeTimers]);

  const showUndoBannerFor5Seconds = useCallback(
    (
      previousBody: string,
      previousLinePhotos: NoteLinePhoto[],
      previousLineQuantities: NoteLineQuantity[],
      label: string
    ) => {
      if (duplicateUndoTimerRef.current !== null) {
        window.clearTimeout(duplicateUndoTimerRef.current);
      }
      setDuplicateUndo({
        previousBody,
        previousLinePhotos,
        previousLineQuantities,
        label,
      });
      duplicateUndoTimerRef.current = window.setTimeout(() => {
        setDuplicateUndo(null);
        duplicateUndoTimerRef.current = null;
      }, 5000);
    },
    []
  );

  const upsertLineQuantity = (
    list: NoteLineQuantity[],
    lineIndex: number,
    quantity: number | null,
    unit?: NoteQuantityUnit
  ): NoteLineQuantity[] => {
    const existing = list.find((q) => q.lineIndex === lineIndex);
    const filtered = list.filter((q) => q.lineIndex !== lineIndex);
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
      return filtered.sort((a, b) => a.lineIndex - b.lineIndex);
    }
    const resolvedUnit = unit !== undefined ? unit : existing?.unit;
    return [
      ...filtered,
      {
        lineIndex,
        quantity: roundQuantityValue(quantity),
        ...(resolvedUnit ? { unit: resolvedUnit } : {}),
      },
    ].sort((a, b) => a.lineIndex - b.lineIndex);
  };

  const applyAutoTakeOnLineFinish = useCallback(
    (
      lineIdx: number,
      options?: { overrideLineText?: string }
    ): { extracted: boolean; cleanName: string } => {
      if (!quantitiesEnabledRef.current || !autoTakeNoteNumberRef.current) {
        const lines = bodyRef.current.split('\n');
        return {
          extracted: false,
          cleanName: options?.overrideLineText ?? lines[lineIdx] ?? '',
        };
      }
      const prevBody = bodyRef.current;
      const lines = prevBody.split('\n');
      if (lineIdx < 0 || lineIdx >= lines.length) {
        return { extracted: false, cleanName: '' };
      }
      const rawLine = options?.overrideLineText ?? lines[lineIdx];
      const extracted = extractAutoTakeQuantityAndUnit(rawLine);
      if (!extracted) {
        return { extracted: false, cleanName: rawLine };
      }

      const prevLinePhotos = linePhotosRef.current;
      const prevLineQuantities = lineQuantitiesRef.current;

      const resolvedUnit = resolveQuantityUnit({
        explicitUnit: extracted.unit,
        productName: extracted.cleanName,
        unitMode: noteUnitModeRef.current,
        defaultUnit: noteDefaultUnitRef.current,
        memory: loadProductUnitMemory(),
      });

      if (extracted.unit && noteUnitModeRef.current !== 'fixed') {
        rememberUnitForProduct(extracted.cleanName, extracted.unit);
      }

      lines[lineIdx] = extracted.cleanName;
      const nextBody = lines.join('\n');

      const filtered = prevLineQuantities.filter(
        (q) => q.lineIndex !== lineIdx
      );
      const nextQuantities: NoteLineQuantity[] = [
        ...filtered,
        {
          lineIndex: lineIdx,
          quantity: roundQuantityValue(extracted.quantity),
          ...(resolvedUnit ? { unit: resolvedUnit } : {}),
        },
      ].sort((a, b) => a.lineIndex - b.lineIndex);

      bodyRef.current = nextBody;
      lineQuantitiesRef.current = nextQuantities;
      setBody(nextBody);
      setLineQuantities(nextQuantities);

      triggerAutoTakeFeedback(
        lineIdx,
        prevBody,
        prevLinePhotos,
        prevLineQuantities
      );

      return { extracted: true, cleanName: extracted.cleanName };
    },
    [triggerAutoTakeFeedback]
  );

  // Re-ensure visibility whenever visualViewport height changes while focused
  useEffect(() => {
    if (!isKeyboardMode) return;
    scheduleScrollActiveLine(false);
  }, [isKeyboardMode, viewport.height, caretPos, body, scheduleScrollActiveLine]);

  // If mobile software keyboard dismisses externally, restore layout cleanly
  useEffect(() => {
    if (viewport.isViewportShrunk) {
      wasViewportShrunkRef.current = true;
    } else if (wasViewportShrunkRef.current) {
      wasViewportShrunkRef.current = false;
      if (isFieldFocused) {
        if (focusedNumberedLineRef.current !== null) {
          applyAutoTakeOnLineFinish(focusedNumberedLineRef.current);
        }
        const active = document.activeElement as HTMLElement | null;
        if (active && active.dataset.noteEditorField === 'true') {
          active.blur();
        }
        focusedNumberedLineRef.current = null;
        setIsFieldFocused(false);
      }
    }
  }, [viewport.isViewportShrunk, isFieldFocused, applyAutoTakeOnLineFinish]);

  const handleFieldFocus = (lineIdx?: number) => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (typeof lineIdx === 'number') {
      focusedNumberedLineRef.current = lineIdx;
      activeLineIndexRef.current = lineIdx;
    }
    setIsFieldFocused(true);
    scheduleScrollActiveLine(true);
  };

  const handleFieldBlur = () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
    }
    blurTimerRef.current = window.setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active.dataset.noteEditorField !== 'true') {
        focusedNumberedLineRef.current = null;
        setIsFieldFocused(false);
      }
    }, 90);
  };

  const handleNumberedLineBlur = (lineIdx: number) => {
    applyAutoTakeOnLineFinish(lineIdx);
    handleFieldBlur();
  };

  const handleDoneKeyboard = () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (focusedNumberedLineRef.current !== null) {
      applyAutoTakeOnLineFinish(focusedNumberedLineRef.current);
    }
    activeQtyLineRef.current = null;
    setActiveQtyLineIndex(null);
    focusedNumberedLineRef.current = null;
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }
    setIsFieldFocused(false);
  };

  // Update body while preserving visual side picture AND quantity box alignment cleanly
  const updateBodyWithAlignment = (nextBody: string): {
    nextPhotos: NoteLinePhoto[];
    nextQuantities: NoteLineQuantity[];
  } => {
    const oldLines = bodyRef.current.split('\n');
    const newLines = nextBody.split('\n');
    let nextPhotos = linePhotosRef.current;
    let nextQuantities = lineQuantitiesRef.current;
    if (oldLines.length !== newLines.length) {
      nextPhotos = realignLinePhotosAfterEdit(oldLines, newLines, nextPhotos);
      nextQuantities = realignLineQuantitiesAfterEdit(
        oldLines,
        newLines,
        nextQuantities
      );
      linePhotosRef.current = nextPhotos;
      lineQuantitiesRef.current = nextQuantities;
      setLinePhotos(nextPhotos);
      setLineQuantities(nextQuantities);
    }
    bodyRef.current = nextBody;
    setBody(nextBody);
    return { nextPhotos, nextQuantities };
  };

  // Auto-resize per-line textareas so wrapped Arabic lines align accurately
  useEffect(() => {
    if (!isPerLineMode) return;
    const raf = requestAnimationFrame(() => {
      for (let i = 0; i < rawLines.length; i++) {
        const el = lineInputRefs.current[i];
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${Math.max(36, el.scrollHeight)}px`;
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [rawLines, isPerLineMode, isKeyboardMode]);

  // Measure mirror paragraph offsets for plain mode (neither numbering nor quantities)
  useEffect(() => {
    if (isPerLineMode) return;
    const raf = requestAnimationFrame(() => {
      const next: Array<{ top: number; height: number }> = [];
      let y = 0;
      for (let i = 0; i < rawLines.length; i++) {
        const el = mirrorRefs.current[i];
        const h = el ? el.offsetHeight : 36;
        next.push({ top: y, height: h });
        y += h;
      }
      setLineMetrics(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [rawLines, isPerLineMode, mathAnalysis.hasAnyCalculated, isKeyboardMode]);

  const handlePhotoFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    const added: NotePhoto[] = [];
    for (const f of files) {
      const canvas = await fileOrDataUrlToCanvas(f, 1280);
      const compressed = compressCanvasToJpeg(canvas, 1280, 0.85);
      added.push({
        id: `np_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        dataUrl: compressed.dataUrl,
        thumbnailDataUrl: compressed.thumbnailDataUrl,
        createdAt: Date.now(),
      });
    }
    setPhotos((prev) => [...prev, ...added]);
  };

  const assignLinePhoto = (lineIndex: number, dataUrl: string) => {
    setLinePhotos((prev) => {
      const filtered = prev.filter((p) => p.lineIndex !== lineIndex);
      return [...filtered, { lineIndex, dataUrl }].sort(
        (a, b) => a.lineIndex - b.lineIndex
      );
    });
  };

  const removeLinePhoto = (lineIndex: number) => {
    setLinePhotos((prev) => prev.filter((p) => p.lineIndex !== lineIndex));
  };

  const handleLinePhotoFilePicked = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetLine = pendingLineTargetRef.current;
    pendingLineTargetRef.current = null;
    if (!file || targetLine === null) return;

    const canvas = await fileOrDataUrlToCanvas(file, 768);
    const compressed = compressCanvasToJpeg(canvas, 768, 0.85);
    assignLinePhoto(targetLine, compressed.dataUrl);
  };

  const copyTextToClipboard = async (textToCopy: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        return;
      }
      throw new Error('Clipboard API unavailable');
    } catch {
      const temp = document.createElement('textarea');
      temp.value = textToCopy;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
  };

  const handleCopyTotal = async () => {
    const textToCopy = mathAnalysis.hasAnyCalculated
      ? formatMathNumber(mathAnalysis.total)
      : '0';
    await copyTextToClipboard(textToCopy);
    setCopiedTotal(true);
    window.setTimeout(() => setCopiedTotal(false), 1800);
  };

  const copyPreviewText = useMemo(
    () =>
      formatNoteForCopy({
        title,
        body,
        numberingEnabled,
        resetAfterBlankLine,
        quantitiesEnabled,
        lineQuantities,
        sortOrder: noteCopySortOrder,
        digitStyle: noteCopyDigitStyle,
        includeTotalQuantities: noteCopyIncludeTotalQuantities,
      }),
    [
      title,
      body,
      numberingEnabled,
      resetAfterBlankLine,
      quantitiesEnabled,
      lineQuantities,
      noteCopySortOrder,
      noteCopyDigitStyle,
      noteCopyIncludeTotalQuantities,
    ]
  );

  const handleCopyNote = async () => {
    if (!copyPreviewText) return;
    await copyTextToClipboard(copyPreviewText);
    setCopiedNote(true);
    window.setTimeout(() => setCopiedNote(false), 1800);
  };

  const handleCalcKey = (key: string) => {
    setCalcState((prev) => applyCalculatorKey(prev, key));
  };

  const handleInsertExpression = () => {
    const expr = calcState.expression.trim();
    if (!expr) {
      setShowCalcSheet(false);
      return;
    }

    if (isPerLineMode && activeLineIndexRef.current !== null) {
      const idx = Math.min(rawLines.length - 1, activeLineIndexRef.current);
      const nextLines = [...rawLines];
      nextLines[idx] = nextLines[idx] ? `${nextLines[idx]} ${expr}` : expr;
      bodyRef.current = nextLines.join('\n');
      setBody(nextLines.join('\n'));
      setCalcState({ expression: '', justEvaluated: false });
      setShowCalcSheet(false);
      return;
    }

    const ta = textareaRef.current;
    if (!ta) {
      updateBodyWithAlignment(body ? `${body}\n${expr}` : expr);
      setCalcState({ expression: '', justEvaluated: false });
      setShowCalcSheet(false);
      return;
    }

    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const needsLeadingNewline =
      before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const insertion = `${needsLeadingNewline}${expr}`;
    const nextBody = `${before}${insertion}${after}`;
    updateBodyWithAlignment(nextBody);
    setCalcState({ expression: '', justEvaluated: false });
    setShowCalcSheet(false);

    setTimeout(() => {
      ta.focus();
      const pos = start + insertion.length;
      ta.setSelectionRange(pos, pos);
      setCaretPos(pos);
    }, 30);
  };

  const getCursorLineIndex = (text: string, selectionStart: number): number => {
    const safePos = Math.max(0, Math.min(selectionStart, text.length));
    let lineIdx = 0;
    for (let i = 0; i < safePos; i++) {
      if (text.charCodeAt(i) === 10) lineIdx++;
    }
    return lineIdx;
  };

  const handleToggleQuantities = () => {
    setQuantitiesEnabled((prev) => {
      const next = !prev;
      quantitiesEnabledRef.current = next;
      return next;
    });
  };

  const commitQtyDraftForLine = (lineIdx: number, rawText: string) => {
    const trimmed = rawText.trim().replace(/[.\u066B,]+$/, '');
    if (!trimmed) {
      const nextQuantities = upsertLineQuantity(
        lineQuantitiesRef.current,
        lineIdx,
        null
      );
      lineQuantitiesRef.current = nextQuantities;
      setLineQuantities(nextQuantities);
      return;
    }
    const existingEntry = lineQuantitiesRef.current.find(
      (q) => q.lineIndex === lineIdx && q.quantity > 0
    );
    const parsed = parseQuantityNumberInput(trimmed);
    if (parsed !== null) {
      const unitForNew =
        existingEntry === undefined
          ? resolveQuantityUnit({
              productName: rawLinesRef.current[lineIdx] || '',
              unitMode: noteUnitModeRef.current,
              defaultUnit: noteDefaultUnitRef.current,
              memory: loadProductUnitMemory(),
            })
          : undefined;
      const nextQuantities = upsertLineQuantity(
        lineQuantitiesRef.current,
        lineIdx,
        parsed,
        unitForNew
      );
      lineQuantitiesRef.current = nextQuantities;
      setLineQuantities(nextQuantities);
    }
  };

  const handleQtyInputFocus = (lineIdx: number, el: HTMLInputElement) => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (
      focusedNumberedLineRef.current !== null &&
      focusedNumberedLineRef.current !== lineIdx
    ) {
      applyAutoTakeOnLineFinish(focusedNumberedLineRef.current);
    }
    focusedNumberedLineRef.current = null;
    activeLineIndexRef.current = lineIdx;
    activeQtyLineRef.current = lineIdx;
    setActiveQtyLineIndex(lineIdx);

    const existingEntry = lineQuantitiesRef.current.find(
      (q) => q.lineIndex === lineIdx && q.quantity > 0
    );
    const initialDraft =
      existingEntry !== undefined
        ? formatQuantityNumber(existingEntry.quantity)
        : '';
    qtyDraftRef.current = initialDraft;
    setQtyDraft(initialDraft);
    setIsFieldFocused(true);
    scheduleScrollActiveLine(true);

    window.requestAnimationFrame(() => {
      if (document.activeElement === el && el.value.length > 0) {
        el.select();
      }
    });
  };

  const handleQtyInputChange = (lineIdx: number, rawVal: string) => {
    const cleaned = rawVal
      .replace(/[^0-9\u0660-\u0669\u06F0-\u06F9.,\u066B]/g, '')
      .slice(0, 10);
    qtyDraftRef.current = cleaned;
    setQtyDraft(cleaned);

    if (cleaned.trim() === '') {
      const nextQuantities = upsertLineQuantity(
        lineQuantitiesRef.current,
        lineIdx,
        null
      );
      lineQuantitiesRef.current = nextQuantities;
      setLineQuantities(nextQuantities);
      return;
    }

    const existingEntry = lineQuantitiesRef.current.find(
      (q) => q.lineIndex === lineIdx && q.quantity > 0
    );
    const parsed = parseQuantityNumberInput(cleaned);
    if (parsed !== null) {
      const unitForNew =
        existingEntry === undefined
          ? resolveQuantityUnit({
              productName: rawLinesRef.current[lineIdx] || '',
              unitMode: noteUnitModeRef.current,
              defaultUnit: noteDefaultUnitRef.current,
              memory: loadProductUnitMemory(),
            })
          : undefined;
      const nextQuantities = upsertLineQuantity(
        lineQuantitiesRef.current,
        lineIdx,
        parsed,
        unitForNew
      );
      lineQuantitiesRef.current = nextQuantities;
      setLineQuantities(nextQuantities);
    }
  };

  const handleQtyInputBlur = (lineIdx: number) => {
    commitQtyDraftForLine(lineIdx, qtyDraftRef.current);
    window.setTimeout(() => {
      if (activeQtyLineRef.current === lineIdx) {
        activeQtyLineRef.current = null;
        setActiveQtyLineIndex(null);
      }
    }, 0);
    handleFieldBlur();
  };

  const handleQtyInputKeyDown = (
    lineIdx: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitQtyDraftForLine(lineIdx, e.currentTarget.value);
      const currentLines = rawLinesRef.current;
      const nextIdx = lineIdx + 1;

      if (nextIdx < currentLines.length) {
        if (currentLines[nextIdx].trim() === '') {
          const nextLineEl = lineInputRefs.current[nextIdx];
          if (nextLineEl) {
            focusedNumberedLineRef.current = nextIdx;
            activeLineIndexRef.current = nextIdx;
            nextLineEl.focus();
            nextLineEl.setSelectionRange(0, 0);
            return;
          }
        } else {
          const nextQtyEl = qtyInputRefs.current[nextIdx];
          if (nextQtyEl) {
            nextQtyEl.focus();
            return;
          }
        }
      }

      const currentLineHasContent =
        currentLines[lineIdx]?.trim() !== '' ||
        e.currentTarget.value.trim() !== '';
      if (currentLineHasContent) {
        const nextLines = [...currentLines, ''];
        flushSync(() => {
          updateBodyWithAlignment(nextLines.join('\n'));
        });
        const newLineIdx = currentLines.length;
        const newLineEl = lineInputRefs.current[newLineIdx];
        if (newLineEl) {
          focusedNumberedLineRef.current = newLineIdx;
          activeLineIndexRef.current = newLineIdx;
          newLineEl.focus();
          newLineEl.setSelectionRange(0, 0);
          return;
        }
      }

      handleDoneKeyboard();
      return;
    }
    if (e.key === 'ArrowDown') {
      const nextEl = qtyInputRefs.current[lineIdx + 1];
      if (nextEl) {
        e.preventDefault();
        nextEl.focus();
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      const prevEl = qtyInputRefs.current[lineIdx - 1];
      if (prevEl) {
        e.preventDefault();
        prevEl.focus();
      }
    }
  };

  const handleToggleActiveQtyUnit = (unit: NoteQuantityUnit) => {
    const lineIdx = activeQtyLineRef.current;
    if (lineIdx === null) return;
    const existingEntry = lineQuantitiesRef.current.find(
      (q) => q.lineIndex === lineIdx && q.quantity > 0
    );
    const nextUnit = existingEntry?.unit === unit ? undefined : unit;
    const productName = rawLinesRef.current[lineIdx] || '';

    if (noteUnitModeRef.current !== 'fixed') {
      if (nextUnit) {
        rememberUnitForProduct(productName, nextUnit);
      } else {
        forgetUnitForProduct(productName);
      }
    }

    const parsedDraft = parseQuantityNumberInput(qtyDraftRef.current);
    const resolvedQty =
      parsedDraft ?? existingEntry?.quantity ?? (nextUnit ? 1 : null);

    if (resolvedQty === null) return;

    if (!qtyDraftRef.current.trim()) {
      const nextText = formatQuantityNumber(resolvedQty);
      qtyDraftRef.current = nextText;
      setQtyDraft(nextText);
    }

    const filtered = lineQuantitiesRef.current.filter(
      (q) => q.lineIndex !== lineIdx
    );
    const nextQuantities: NoteLineQuantity[] = [
      ...filtered,
      {
        lineIndex: lineIdx,
        quantity: roundQuantityValue(resolvedQty),
        ...(nextUnit ? { unit: nextUnit } : {}),
      },
    ].sort((a, b) => a.lineIndex - b.lineIndex);
    lineQuantitiesRef.current = nextQuantities;
    setLineQuantities(nextQuantities);
    showTopUnitNotice(
      nextUnit
        ? `تم تغيير الوحدة إلى ${formatQuantityUnitLabel(nextUnit)}`
        : 'تمت إزالة الوحدة'
    );
  };

  const handleOpenManualDuplicateCheck = () => {
    if (isKeyboardMode) {
      handleDoneKeyboard();
    }
    setUnitMismatchGroupIds([]);
    setShowDuplicateCheckSheet(true);
  };

  const handleManualGroupDelete = (group: DuplicateGroup) => {
    const deleteIndices = group.items.slice(1).map((it) => it.lineIndex);
    if (deleteIndices.length === 0) return;

    const prevBody = bodyRef.current;
    const prevLinePhotos = linePhotosRef.current;
    const prevLineQuantities = lineQuantitiesRef.current;
    const res = deleteDuplicateLinesBulk({
      body: prevBody,
      linePhotos: prevLinePhotos,
      lineQuantities: prevLineQuantities,
      deleteIndices,
    });
    bodyRef.current = res.body;
    linePhotosRef.current = res.linePhotos;
    lineQuantitiesRef.current = res.lineQuantities;
    setBody(res.body);
    setLinePhotos(res.linePhotos);
    setLineQuantities(res.lineQuantities);
    showUndoBannerFor5Seconds(
      prevBody,
      prevLinePhotos,
      prevLineQuantities,
      'تم حذف السطور المكررة'
    );
  };

  const handleManualGroupMerge = (group: DuplicateGroup) => {
    if (group.items.length < 2) return;
    const keepIndex = group.items[0].lineIndex;
    const removeIndices = group.items.slice(1).map((it) => it.lineIndex);

    const prevBody = bodyRef.current;
    const prevLinePhotos = linePhotosRef.current;
    const prevLineQuantities = lineQuantitiesRef.current;
    const res = mergeDuplicateLines({
      body: prevBody,
      linePhotos: prevLinePhotos,
      lineQuantities: prevLineQuantities,
      keepIndex,
      removeIndices,
    });
    if (res.unitMismatch) {
      setUnitMismatchGroupIds((prev) =>
        prev.includes(group.id) ? prev : [...prev, group.id]
      );
      return;
    }
    setUnitMismatchGroupIds((prev) => prev.filter((id) => id !== group.id));
    bodyRef.current = res.body;
    linePhotosRef.current = res.linePhotos;
    lineQuantitiesRef.current = res.lineQuantities;
    setBody(res.body);
    setLinePhotos(res.linePhotos);
    setLineQuantities(res.lineQuantities);
    showUndoBannerFor5Seconds(
      prevBody,
      prevLinePhotos,
      prevLineQuantities,
      res.mergedQuantity !== null
        ? `تم الدمج (الكمية: ${formatQuantityNumber(res.mergedQuantity)})`
        : 'تم دمج السطور المكررة'
    );
  };

  const handleManualGroupKeep = (group: DuplicateGroup) => {
    setKeptDuplicatePairs((prev) => {
      const next = new Set(prev);
      for (const pk of group.pairKeys) {
        next.add(pk);
      }
      return Array.from(next);
    });
  };

  const handleUndoDuplicateAction = () => {
    if (!duplicateUndo) return;
    if (duplicateUndoTimerRef.current !== null) {
      window.clearTimeout(duplicateUndoTimerRef.current);
      duplicateUndoTimerRef.current = null;
    }
    const restoredLineCount = duplicateUndo.previousBody.split('\n').length;
    bodyRef.current = duplicateUndo.previousBody;
    linePhotosRef.current = duplicateUndo.previousLinePhotos;
    lineQuantitiesRef.current = duplicateUndo.previousLineQuantities;
    setBody(duplicateUndo.previousBody);
    setLinePhotos(duplicateUndo.previousLinePhotos);
    setLineQuantities(duplicateUndo.previousLineQuantities);
    if (
      activeLineIndexRef.current !== null &&
      activeLineIndexRef.current >= restoredLineCount
    ) {
      activeLineIndexRef.current = Math.max(0, restoredLineCount - 1);
    }
    if (
      focusedNumberedLineRef.current !== null &&
      focusedNumberedLineRef.current >= restoredLineCount
    ) {
      focusedNumberedLineRef.current = Math.max(0, restoredLineCount - 1);
    }
    setDuplicateUndo(null);
  };

  // Helper called when finishing a non-empty item line via Enter or virtual keyboard '\n'
  const advanceAfterAutoTakeOnLine = (
    idx: number,
    prevBodyBeforeAutoTake: string,
    prevPhotosBeforeAutoTake: NoteLinePhoto[],
    prevQuantitiesBeforeAutoTake: NoteLineQuantity[]
  ): boolean => {
    const preAutoLines = [...rawLinesRef.current];
    const targetRaw = preAutoLines[idx] ?? '';
    const extracted = extractAutoTakeQuantityAndUnit(targetRaw);
    if (!extracted) return false;

    const resolvedUnit = resolveQuantityUnit({
      explicitUnit: extracted.unit,
      productName: extracted.cleanName,
      unitMode: noteUnitModeRef.current,
      defaultUnit: noteDefaultUnitRef.current,
      memory: loadProductUnitMemory(),
    });
    if (extracted.unit && noteUnitModeRef.current !== 'fixed') {
      rememberUnitForProduct(extracted.cleanName, extracted.unit);
    }

    const updatedLines = [...preAutoLines];
    updatedLines[idx] = extracted.cleanName;

    const filteredQty = prevQuantitiesBeforeAutoTake.filter(
      (q) => q.lineIndex !== idx
    );
    const updatedQuantities: NoteLineQuantity[] = [
      ...filteredQty,
      {
        lineIndex: idx,
        quantity: roundQuantityValue(extracted.quantity),
        ...(resolvedUnit ? { unit: resolvedUnit } : {}),
      },
    ].sort((a, b) => a.lineIndex - b.lineIndex);

    lineQuantitiesRef.current = updatedQuantities;
    setLineQuantities(updatedQuantities);

    const nextIdx = idx + 1;
    const reuseNextBlank =
      nextIdx < updatedLines.length && updatedLines[nextIdx].trim() === '';
    if (!reuseNextBlank) {
      updatedLines.splice(nextIdx, 0, '');
    }

    bodyRef.current = updatedLines.join('\n');
    flushSync(() => {
      if (!reuseNextBlank) {
        const nextPhotos = realignLinePhotosAfterEdit(
          preAutoLines,
          updatedLines,
          prevPhotosBeforeAutoTake
        );
        const nextQuantities = realignLineQuantitiesAfterEdit(
          preAutoLines,
          updatedLines,
          updatedQuantities
        );
        linePhotosRef.current = nextPhotos;
        lineQuantitiesRef.current = nextQuantities;
        setLinePhotos(nextPhotos);
        setLineQuantities(nextQuantities);
      }
      setBody(updatedLines.join('\n'));
    });

    triggerAutoTakeFeedback(
      idx,
      prevBodyBeforeAutoTake,
      prevPhotosBeforeAutoTake,
      prevQuantitiesBeforeAutoTake
    );

    focusedNumberedLineRef.current = nextIdx;
    activeLineIndexRef.current = nextIdx;
    const nextEl = lineInputRefs.current[nextIdx];
    if (nextEl) {
      nextEl.focus();
      nextEl.setSelectionRange(0, 0);
      scheduleScrollActiveLine(false);
    }
    return true;
  };

  // Keyboard handlers for per-line editors
  const handleNumberedLineChange = (idx: number, val: string) => {
    if (val.includes('\n')) {
      const inserted = val.split('\n');

      // Mobile virtual keyboards often insert '\n' via onChange instead of firing Enter keyDown:
      // when Quantities mode is ON and user finishes a non-empty item line:
      // - if autoTakeNoteNumber is ON and trailing number matches -> extract number (+ unit) and move to next line
      // - otherwise jump directly to its quantity box while leaving note text intact.
      if (
        quantitiesEnabledRef.current &&
        inserted.length === 2 &&
        inserted[1] === '' &&
        inserted[0].trim() !== ''
      ) {
        const prevBodySnapshot = bodyRef.current;
        const prevPhotosSnapshot = linePhotosRef.current;
        const prevQuantitiesSnapshot = lineQuantitiesRef.current;

        const nextLines = [...rawLinesRef.current];
        nextLines[idx] = inserted[0];
        const cleanBody = nextLines.join('\n');
        bodyRef.current = cleanBody;
        setBody(cleanBody);

        if (
          autoTakeNoteNumberRef.current &&
          advanceAfterAutoTakeOnLine(
            idx,
            prevBodySnapshot,
            prevPhotosSnapshot,
            prevQuantitiesSnapshot
          )
        ) {
          return;
        }

        const qtyEl = qtyInputRefs.current[idx];
        if (qtyEl) {
          qtyEl.focus();
          return;
        }
      }

      const nextLines = [
        ...rawLinesRef.current.slice(0, idx),
        ...inserted,
        ...rawLinesRef.current.slice(idx + 1),
      ];
      updateBodyWithAlignment(nextLines.join('\n'));
      const focusIdx = idx + inserted.length - 1;
      focusedNumberedLineRef.current = focusIdx;
      activeLineIndexRef.current = focusIdx;
      setTimeout(() => {
        const el = lineInputRefs.current[focusIdx];
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
          scheduleScrollActiveLine(false);
        }
      }, 10);
      return;
    }

    const nextLines = [...rawLinesRef.current];
    nextLines[idx] = val;
    const nextBody = nextLines.join('\n');
    bodyRef.current = nextBody;
    setBody(nextBody);
    activeLineIndexRef.current = idx;
    scheduleScrollActiveLine(false);
  };

  const handleNumberedLineKeyDown = (
    idx: number,
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    const el = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault();
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const rawBefore = el.value.slice(0, start);
      const after = el.value.slice(end);

      if (
        quantitiesEnabledRef.current &&
        rawBefore.trim() !== '' &&
        after === ''
      ) {
        if (
          autoTakeNoteNumberRef.current &&
          advanceAfterAutoTakeOnLine(
            idx,
            bodyRef.current,
            linePhotosRef.current,
            lineQuantitiesRef.current
          )
        ) {
          return;
        }

        const qtyEl = qtyInputRefs.current[idx];
        if (qtyEl) {
          qtyEl.focus();
          return;
        }
      }

      const nextLines = [
        ...rawLinesRef.current.slice(0, idx),
        rawBefore,
        after,
        ...rawLinesRef.current.slice(idx + 1),
      ];
      updateBodyWithAlignment(nextLines.join('\n'));
      focusedNumberedLineRef.current = idx + 1;
      activeLineIndexRef.current = idx + 1;
      setTimeout(() => {
        const nextEl = lineInputRefs.current[idx + 1];
        if (nextEl) {
          nextEl.focus();
          nextEl.setSelectionRange(0, 0);
          scheduleScrollActiveLine(false);
        }
      }, 10);
    } else if (
      e.key === 'Backspace' &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0 &&
      idx > 0
    ) {
      e.preventDefault();
      const prevLen = rawLines[idx - 1].length;
      const merged = rawLines[idx - 1] + rawLines[idx];
      const nextLines = [
        ...rawLines.slice(0, idx - 1),
        merged,
        ...rawLines.slice(idx + 1),
      ];
      updateBodyWithAlignment(nextLines.join('\n'));
      activeLineIndexRef.current = idx - 1;
      setTimeout(() => {
        const prevEl = lineInputRefs.current[idx - 1];
        if (prevEl) {
          prevEl.focus();
          prevEl.setSelectionRange(prevLen, prevLen);
          scheduleScrollActiveLine(false);
        }
      }, 10);
    } else if (e.key === 'ArrowUp' && el.selectionStart === 0 && idx > 0) {
      e.preventDefault();
      const prevEl = lineInputRefs.current[idx - 1];
      prevEl?.focus();
    } else if (
      e.key === 'ArrowDown' &&
      el.selectionStart === el.value.length &&
      idx < rawLines.length - 1
    ) {
      e.preventDefault();
      const nextEl = lineInputRefs.current[idx + 1];
      nextEl?.focus();
    }
  };

  // Long-press & tap handling for filled line side picture
  const handleLinePicTouchStart = (lineIdx: number) => {
    longPressTriggeredRef.current = false;
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
      removeLinePhoto(lineIdx);
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.vibrate === 'function'
      ) {
        try {
          navigator.vibrate(25);
        } catch {
          // ignore
        }
      }
    }, 520);
  };

  const cancelLinePicHold = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleRecordWhatsAppSent = async () => {
    const sentAt = Date.now();
    setLastSentAt(sentAt);
    await onChangeNote({
      ...note,
      title,
      body,
      photos,
      linePhotos,
      numberingEnabled,
      resetAfterBlankLine,
      quantitiesEnabled,
      lineQuantities,
      keptDuplicatePairs,
      lastSentToName: undefined,
      lastSentAt: sentAt,
      updatedAt: sentAt,
    });
  };

  const handleDirectWhatsAppSend = () => {
    if (!whatsAppMessageText.trim()) return;
    openWhatsAppDirect(whatsAppMessageText);
    void handleRecordWhatsAppSent();
  };

  const handleCopyTouchStart = () => {
    copyLongPressTriggeredRef.current = false;
    if (copyLongPressTimerRef.current !== null) {
      window.clearTimeout(copyLongPressTimerRef.current);
    }
    copyLongPressTimerRef.current = window.setTimeout(() => {
      copyLongPressTriggeredRef.current = true;
      copyLongPressTimerRef.current = null;
      if (copyPreviewText) {
        setShowCopyPreviewSheet(true);
        if (
          typeof navigator !== 'undefined' &&
          typeof navigator.vibrate === 'function'
        ) {
          try {
            navigator.vibrate(20);
          } catch {
            // ignore
          }
        }
      }
    }, 480);
  };

  const cancelCopyHold = () => {
    if (copyLongPressTimerRef.current !== null) {
      window.clearTimeout(copyLongPressTimerRef.current);
      copyLongPressTimerRef.current = null;
    }
  };

  const handleShareOtherApp = async () => {
    setShowToolbarMoreMenu(false);
    const result = await shareNoteViaOtherApp(
      { photos, linePhotos },
      whatsAppMessageText
    );
    if (result === 'shared') {
      await handleRecordWhatsAppSent();
    } else if (result === 'unsupported') {
      if (whatsAppMessageText.trim()) {
        await copyTextToClipboard(whatsAppMessageText);
      }
      setShareFeedback('المشاركة المباشرة غير مدعومة هنا — تم نسخ نص الملاحظة');
      window.setTimeout(() => setShareFeedback(null), 2600);
    }
  };

  const calcLiveResult = getCalculatorLiveResult(calcState);
  const editorTotalHeight = Math.max(
    280,
    lineMetrics.length > 0
      ? lineMetrics[lineMetrics.length - 1].top +
          lineMetrics[lineMetrics.length - 1].height +
          48
      : 280
  );

  const whatsAppMessageText = useMemo(
    () =>
      formatNoteForWhatsApp({
        title,
        body,
        numberingEnabled,
        resetAfterBlankLine,
        totalText: mathAnalysis.hasAnyCalculated
          ? formatMathNumber(mathAnalysis.total)
          : null,
        includeTotal: includeTotalInWhatsApp,
        quantitiesEnabled,
        lineQuantities,
        sortOrder: noteCopySortOrder,
        digitStyle: noteCopyDigitStyle,
        includeTotalQuantities: noteCopyIncludeTotalQuantities,
      }),
    [
      title,
      body,
      numberingEnabled,
      resetAfterBlankLine,
      mathAnalysis.hasAnyCalculated,
      mathAnalysis.total,
      includeTotalInWhatsApp,
      quantitiesEnabled,
      lineQuantities,
      noteCopySortOrder,
      noteCopyDigitStyle,
      noteCopyIncludeTotalQuantities,
    ]
  );

  const primaryToolbarButtons = useMemo(
    () => [
      {
        id: 'numbering',
        label: 'ترقيم',
        icon: Hash,
        isToggle: true,
        active: numberingEnabled,
        onClick: () => setNumberingEnabled((v) => !v),
      },
      {
        id: 'quantities',
        label: 'الكميات',
        icon: Package,
        isToggle: true,
        active: quantitiesEnabled,
        onClick: handleToggleQuantities,
      },
      {
        id: 'photo',
        label: 'صورة',
        icon: ImagePlus,
        isToggle: false,
        active: false,
        onClick: () => setShowPhotoSourceMenu(true),
      },
    ],
    [numberingEnabled, quantitiesEnabled]
  );

  const visibleToolbarCount = computeToolbarVisibleCount(
    toolbarWidth,
    primaryToolbarButtons.length,
    56,
    4
  );
  const visibleToolbarButtons = primaryToolbarButtons.slice(0, visibleToolbarCount);
  const overflowToolbarButtons = primaryToolbarButtons.slice(visibleToolbarCount);

  const dateLabel = useMemo(
    () => formatDayHeading(getLocalDateKey(note.updatedAt || note.createdAt)),
    [note.updatedAt, note.createdAt]
  );

  const sentStatusText = useMemo(() => {
    if (!lastSentAt) return '';
    return `أُرسلت ${formatSentTimestampArabic(lastSentAt)}`;
  }, [lastSentAt]);

  const hasAnyModalOpen =
    showCalcSheet ||
    showWhatsAppSheet ||
    showDuplicateCheckSheet ||
    showPhotoSourceMenu ||
    menuLineIndex !== null ||
    viewerTarget !== null ||
    showToolbarMoreMenu ||
    showCopyPreviewSheet ||
    showNoteSettingsSheet;

  return (
    <div
      style={
        isKeyboardMode
          ? {
              top: `${viewport.offsetTop}px`,
              height: `${viewport.height}px`,
              left: 0,
              right: 0,
            }
          : undefined
      }
      className={`fixed ${hasAnyModalOpen ? 'z-50' : 'z-30'} bg-[#F7F8FA] dark:bg-slate-950 flex flex-col ${
        isKeyboardMode
          ? ''
          : 'inset-x-0 top-0 bottom-[calc(68px+env(safe-area-inset-bottom,0px))]'
      }`}
      dir="rtl"
    >
      {/* Hidden Inputs for Note Attachments */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoFiles}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handlePhotoFiles}
        className="hidden"
      />

      {/* Hidden Inputs for Numbered-Line Side Pictures */}
      <input
        ref={lineCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleLinePhotoFilePicked}
        className="hidden"
      />
      <input
        ref={lineGalleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleLinePhotoFilePicked}
        className="hidden"
      />

      {/* Top Area */}
      {isKeyboardMode ? (
        /* Keyboard Open Mode: Collapsed Single Thin Row */
        <header className="px-2.5 py-1.5 min-h-[46px] bg-white/95 dark:bg-slate-900/95 border-b border-slate-200/80 dark:border-slate-800 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={async () => {
              handleDoneKeyboard();
              await onChangeNote({
                ...note,
                title,
                body: bodyRef.current,
                photos,
                linePhotos: linePhotosRef.current,
                numberingEnabled,
                resetAfterBlankLine,
                quantitiesEnabled,
                lineQuantities: lineQuantitiesRef.current,
                keptDuplicatePairs,
                lastSentToName: undefined,
                lastSentAt,
                updatedAt: Date.now(),
              });
              onClose();
            }}
            className="min-w-[40px] min-h-[40px] rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0"
            aria-label="العودة للملاحظات"
          >
            <ArrowRight className="w-4 h-4" />
          </button>

          <input
            type="text"
            data-note-editor-field="true"
            value={title}
            onFocus={() => handleFieldFocus()}
            onBlur={handleFieldBlur}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان الملاحظة..."
            className="flex-1 min-w-0 bg-transparent text-base font-extrabold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
          />

          {quantitiesEnabled && quantitiesSummary.quantifiedCount > 0 && (
            <span
              data-testid="quantities-summary-chip"
              className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0"
            >
              {quantitiesSummary.itemCount} مادة · إجمالي{' '}
              {formatQuantityNumber(quantitiesSummary.totalQuantity)}
            </span>
          )}

          {mathAnalysis.hasAnyCalculated && (
            <span
              dir="ltr"
              className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0 px-1"
            >
              {formatMathNumber(mathAnalysis.total)}
            </span>
          )}
        </header>
      ) : (
        /* Normal Mode: Row 1 Title/Date/Compact Summary + Row 2 Streamlined 5-Button Toolbar Row */
        <header className="px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] bg-white/95 dark:bg-slate-900/95 border-b border-slate-200/80 dark:border-slate-800 space-y-2 shrink-0">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                await onChangeNote({
                  ...note,
                  title,
                  body: bodyRef.current,
                  photos,
                  linePhotos: linePhotosRef.current,
                  numberingEnabled,
                  resetAfterBlankLine,
                  quantitiesEnabled,
                  lineQuantities: lineQuantitiesRef.current,
                  keptDuplicatePairs,
                  lastSentToName: undefined,
                  lastSentAt,
                  updatedAt: Date.now(),
                });
                onClose();
              }}
              className="min-w-[44px] min-h-[44px] rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 active:scale-95 transition"
              aria-label="العودة للملاحظات"
            >
              <ArrowRight className="w-5 h-5" />
            </button>

            <input
              type="text"
              data-note-editor-field="true"
              value={title}
              onFocus={() => handleFieldFocus()}
              onBlur={handleFieldBlur}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان الملاحظة..."
              className="flex-1 min-w-0 bg-transparent text-lg font-extrabold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
            />

            <div className="text-left shrink-0 max-w-[46%]">
              <div className="text-[11px] font-bold text-slate-400 dark:text-slate-500 truncate">
                {dateLabel}
                {sentStatusText ? ` · ${sentStatusText}` : ''}
              </div>
              {quantitiesEnabled && quantitiesSummary.quantifiedCount > 0 && (
                <div
                  data-testid="quantities-summary-chip"
                  className="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums truncate"
                >
                  {quantitiesSummary.itemCount} مادة · إجمالي{' '}
                  {formatQuantityNumber(quantitiesSummary.totalQuantity)}
                </div>
              )}
            </div>
          </div>

          {/* Single Row of Equal-Size Stacked Icon+Label Toolbar Buttons */}
          <div
            ref={toolbarRef}
            data-testid="notes-toolbar"
            className="max-w-3xl mx-auto grid gap-1.5"
            style={{
              gridTemplateColumns: `repeat(${visibleToolbarButtons.length + 1}, minmax(0, 1fr))`,
            }}
          >
            {visibleToolbarButtons.map((btn) => {
              const Icon = btn.icon;
              let btnClass =
                'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-transparent';
              if (btn.isToggle) {
                btnClass = btn.active
                  ? 'bg-emerald-500 text-white border border-emerald-500 shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700';
              } else if (btn.active) {
                btnClass =
                  'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35';
              }

              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={btn.onClick}
                  aria-pressed={btn.isToggle ? btn.active : undefined}
                  className={`relative h-[50px] px-1 rounded-xl flex flex-col items-center justify-center gap-0.5 min-w-0 active:scale-95 transition ${btnClass}`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] leading-[1.15] font-bold text-center line-clamp-2 w-full">
                    {btn.label}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setShowToolbarMoreMenu(true)}
              aria-label="المزيد من خيارات الملاحظة"
              className="relative h-[50px] px-1 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-transparent flex flex-col items-center justify-center gap-0.5 min-w-0 active:scale-95 transition"
            >
              <MoreHorizontal className="w-4 h-4 shrink-0" />
              <span className="text-[10px] leading-[1.15] font-bold text-center">
                المزيد
              </span>
            </button>
          </div>
        </header>
      )}

      {/* Non-blocking single-line notice directly under the header (merge, delete duplicate, unit/share feedback) */}
      {(duplicateUndo || shareFeedback || topUnitNotice) && (
        <div
          data-testid="notes-top-notice"
          className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/60 border-b border-emerald-200/70 dark:border-emerald-800/50 shrink-0"
        >
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-slate-800 dark:text-slate-100 truncate">
              {duplicateUndo?.label ?? shareFeedback ?? topUnitNotice}
            </span>
            {duplicateUndo && (
              <button
                type="button"
                data-testid="note-undo-button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleUndoDuplicateAction}
                className="px-2.5 py-1 rounded-lg bg-emerald-500 text-white text-[11px] font-extrabold flex items-center gap-1 shrink-0 active:scale-95 transition"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>تراجع</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Middle: Scrollable Editor Body (takes ALL remaining height) */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 min-h-0 overflow-y-auto px-3 pt-2.5 ${
          isKeyboardMode ? 'pb-16' : 'pb-4'
        }`}
      >
        <div className="max-w-3xl mx-auto space-y-3">
          {/* Editor Card */}
          <div className="relative bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm p-3">
            {isPerLineMode ? (
              /* Per-Line Mode (Numbering and/or Quantities): Visual Numbers + Side Pictures + Inline Math + Aligned Quantity Box */
              <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {rawLines.map((lineText, idx) => {
                  const num = lineNumbers[idx];
                  const linePic = linePhotoMap.get(idx);
                  const lineQty = lineQuantityMap.get(idx);
                  const lineMath =
                    mathAnalysis.lines[idx] || parseNoteLineMath(lineText);

                  return (
                    <div
                      key={idx}
                      ref={(el) => {
                        lineRowRefs.current[idx] = el;
                      }}
                      className="py-2 min-h-[54px]"
                    >
                      <div className="flex items-start gap-2.5">
                        {numberingEnabled && (
                          num !== null ? (
                            <>
                              {/* Clear Visual Line Number */}
                              <span className="w-6 pt-1.5 text-sm font-extrabold text-emerald-600/85 dark:text-emerald-400/85 tabular-nums text-center shrink-0 select-none">
                                {num}.
                              </span>

                              {/* Compact 36px Rounded Square Picture Slot */}
                              {linePic ? (
                                <button
                                  type="button"
                                  onTouchStart={() => handleLinePicTouchStart(idx)}
                                  onTouchMove={cancelLinePicHold}
                                  onTouchEnd={cancelLinePicHold}
                                  onMouseDown={() => handleLinePicTouchStart(idx)}
                                  onMouseUp={cancelLinePicHold}
                                  onMouseLeave={cancelLinePicHold}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    cancelLinePicHold();
                                    removeLinePhoto(idx);
                                  }}
                                  onClick={() => {
                                    if (longPressTriggeredRef.current) {
                                      longPressTriggeredRef.current = false;
                                      return;
                                    }
                                    setViewerZoom(1);
                                    setViewerTarget({
                                      kind: 'linePhoto',
                                      lineIndex: idx,
                                      dataUrl: linePic,
                                    });
                                  }}
                                  className="w-9 h-9 mt-0.5 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 active:scale-95 transition select-none"
                                  aria-label="عرض صورة السطر أو حذفها بالضغط المطول"
                                >
                                  <img
                                    src={linePic}
                                    alt=""
                                    className="w-full h-full object-cover pointer-events-none"
                                  />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setMenuLineIndex(idx)}
                                  className="w-9 h-9 mt-0.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-[#F7F8FA] dark:bg-slate-800/70 text-slate-400 hover:text-emerald-500 hover:border-emerald-400 flex items-center justify-center shrink-0 active:scale-95 transition"
                                  aria-label="إضافة صورة للسطر"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          ) : (
                            <div className="w-[70px] shrink-0" />
                          )
                        )}

                        <div className="flex-1 min-w-0 flex items-start gap-1.5">
                          <textarea
                            ref={(el) => {
                              lineInputRefs.current[idx] = el;
                            }}
                            data-note-editor-field="true"
                            data-line-index={idx}
                            enterKeyHint={
                              quantitiesEnabled && lineText.trim() !== ''
                                ? 'next'
                                : 'enter'
                            }
                            rows={1}
                            value={lineText}
                            onFocus={() => handleFieldFocus(idx)}
                            onBlur={() => handleNumberedLineBlur(idx)}
                            onClick={() => {
                              activeLineIndexRef.current = idx;
                              scheduleScrollActiveLine(false);
                            }}
                            onKeyUp={() => scheduleScrollActiveLine(false)}
                            onChange={(e) =>
                              handleNumberedLineChange(idx, e.target.value)
                            }
                            onKeyDown={(e) => handleNumberedLineKeyDown(idx, e)}
                            placeholder={
                              idx === 0
                                ? 'اكتب الصنف أو العملية مثل 6 * 12...'
                                : 'سطر جديد...'
                            }
                            className="flex-1 min-w-0 resize-none bg-transparent text-[17px] leading-9 font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none overflow-hidden"
                          />

                          {lineMath.hasExpression && (
                            <span
                              dir="ltr"
                              className="h-7 mt-1 px-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-extrabold flex items-center tabular-nums max-w-[96px] truncate shrink-0 select-none"
                            >
                              = {lineMath.formattedResult}
                            </span>
                          )}
                        </div>

                        {/* Aligned Direct-Input Quantity Box Column at Line End (+ tiny 4s undo icon when auto-taken) */}
                        {quantitiesEnabled &&
                          (() => {
                            const isQtyActive = activeQtyLineIndex === idx;
                            const isQtyHighlighted =
                              highlightedQtyLineIndex === idx;
                            const showLineUndo =
                              autoTakeUndo?.lineIndex === idx;
                            const displayQty =
                              lineQty !== undefined
                                ? formatQuantityNumber(lineQty.quantity)
                                : '';
                            const inputValue = isQtyActive
                              ? qtyDraft
                              : displayQty;
                            const unitLabel = lineQty?.unit
                              ? formatQuantityUnitLabel(lineQty.unit)
                              : '';
                            return (
                              <div className="shrink-0 flex items-center justify-end gap-1 pt-0.5">
                                {showLineUndo && (
                                  <button
                                    type="button"
                                    data-testid={`line-auto-undo-${idx}`}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={handleUndoAutoTake}
                                    aria-label="تراجع عن أخذ الرقم"
                                    title="تراجع"
                                    className={`w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 active:scale-90 transition-opacity duration-300 ${
                                      autoTakeUndo.fading
                                        ? 'opacity-0'
                                        : 'opacity-100'
                                    }`}
                                  >
                                    <Undo2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <div
                                  data-qty-highlighted={
                                    isQtyHighlighted ? 'true' : 'false'
                                  }
                                  className={`w-[56px] min-h-[40px] rounded-xl flex flex-col items-center justify-center px-1 py-0.5 transition-all duration-300 ${
                                    isQtyHighlighted
                                      ? 'bg-emerald-500/25 border-2 border-emerald-500 ring-2 ring-emerald-400/50 scale-[1.04]'
                                      : isQtyActive
                                      ? 'bg-emerald-500/15 border-2 border-emerald-500 ring-2 ring-emerald-500/15'
                                      : lineQty !== undefined
                                      ? 'bg-emerald-500/12 border border-emerald-500/40'
                                      : 'bg-[#F7F8FA]/80 dark:bg-slate-800/50 border border-dashed border-slate-300/80 dark:border-slate-700 hover:border-emerald-400'
                                  }`}
                                >
                                  <input
                                    ref={(el) => {
                                      qtyInputRefs.current[idx] = el;
                                    }}
                                    type="text"
                                    inputMode="decimal"
                                    enterKeyHint={
                                      lineText.trim() !== '' ||
                                      idx + 1 < rawLines.length
                                        ? 'next'
                                        : 'done'
                                    }
                                    dir="ltr"
                                    data-note-editor-field="true"
                                    data-qty-input-index={idx}
                                    data-testid={`qty-box-${idx}`}
                                    value={inputValue}
                                    placeholder="+"
                                    aria-label={
                                      lineQty !== undefined
                                        ? `تعديل الكمية (${displayQty}${
                                            unitLabel ? ` ${unitLabel}` : ''
                                          })`
                                        : 'إضافة كمية للسطر'
                                    }
                                    onFocus={(e) =>
                                      handleQtyInputFocus(idx, e.currentTarget)
                                    }
                                    onBlur={() => handleQtyInputBlur(idx)}
                                    onChange={(e) =>
                                      handleQtyInputChange(idx, e.target.value)
                                    }
                                    onKeyDown={(e) =>
                                      handleQtyInputKeyDown(idx, e)
                                    }
                                    className={`w-full ${
                                      unitLabel ? 'h-5' : 'h-8'
                                    } bg-transparent text-center text-sm font-extrabold tabular-nums focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 placeholder:font-bold ${
                                      lineQty !== undefined || isQtyActive
                                        ? 'text-emerald-700 dark:text-emerald-300'
                                        : 'text-slate-700 dark:text-slate-200'
                                    }`}
                                  />
                                  {unitLabel && (
                                    <span className="text-[9px] font-extrabold text-emerald-700/85 dark:text-emerald-300/90 leading-none pb-0.5 pointer-events-none select-none">
                                      {unitLabel}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Unnumbered Mode: Unified RTL Textarea + Mirror Caret Tracker + Inline Calculator Results */
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none invisible absolute top-3 inset-x-3 text-[17px] leading-9 font-medium whitespace-pre-wrap break-words pr-1 pl-24"
                >
                  {rawLines.map((ln, idx) => (
                    <div
                      key={idx}
                      ref={(el) => {
                        mirrorRefs.current[idx] = el;
                      }}
                      className="min-h-[36px]"
                    >
                      {ln || ' '}
                    </div>
                  ))}
                </div>

                {/* Invisible Caret Mirror Marker to keep the edited line above keyboard */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none invisible absolute top-3 inset-x-3 text-[17px] leading-9 font-medium whitespace-pre-wrap break-words pr-1 pl-24"
                >
                  <span>{body.slice(0, caretPos)}</span>
                  <span
                    ref={caretMarkerRef}
                    className="inline-block w-0 h-9 align-top"
                  />
                </div>

                <div className="relative" style={{ minHeight: editorTotalHeight }}>
                  {lineMetrics.map((m, idx) => {
                    const parsed = mathAnalysis.lines[idx];
                    if (!parsed || !parsed.hasExpression) return null;
                    return (
                      <div
                        key={idx}
                        style={{ top: `${m.top + 4}px` }}
                        className="pointer-events-none select-none absolute left-1 z-10 flex items-center gap-1"
                      >
                        <span
                          dir="ltr"
                          className="h-7 px-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-extrabold flex items-center tabular-nums max-w-[82px] truncate"
                        >
                          = {parsed.formattedResult}
                        </span>
                      </div>
                    );
                  })}

                  <textarea
                    ref={textareaRef}
                    data-note-editor-field="true"
                    value={body}
                    onFocus={(e) => {
                      const pos = e.currentTarget.selectionStart ?? body.length;
                      setCaretPos(pos);
                      activeUnnumberedLineRef.current = getCursorLineIndex(
                        e.currentTarget.value,
                        pos
                      );
                      handleFieldFocus();
                    }}
                    onBlur={handleFieldBlur}
                    onSelect={(e) => {
                      const pos = e.currentTarget.selectionStart ?? body.length;
                      activeUnnumberedLineRef.current = getCursorLineIndex(
                        e.currentTarget.value,
                        pos
                      );
                      setCaretPos(pos);
                      scheduleScrollActiveLine(false);
                    }}
                    onClick={(e) => {
                      const pos = e.currentTarget.selectionStart ?? body.length;
                      activeUnnumberedLineRef.current = getCursorLineIndex(
                        e.currentTarget.value,
                        pos
                      );
                      setCaretPos(pos);
                      scheduleScrollActiveLine(false);
                    }}
                    onKeyUp={(e) => {
                      const pos = e.currentTarget.selectionStart ?? body.length;
                      activeUnnumberedLineRef.current = getCursorLineIndex(
                        e.currentTarget.value,
                        pos
                      );
                      setCaretPos(pos);
                      scheduleScrollActiveLine(false);
                    }}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      const pos = e.currentTarget.selectionStart ?? nextVal.length;
                      activeUnnumberedLineRef.current = getCursorLineIndex(
                        nextVal,
                        pos
                      );
                      setCaretPos(pos);
                      updateBodyWithAlignment(nextVal);
                      scheduleScrollActiveLine(false);
                    }}
                    placeholder="اكتب ملاحظتك أو عمليات حسابية مثل 6 * 12..."
                    style={{ height: editorTotalHeight }}
                    className="w-full resize-none bg-transparent text-[17px] leading-9 font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none overflow-hidden pr-1 pl-24"
                  />
                </div>
              </>
            )}
          </div>

          {/* Attached Note Photos */}
          {photos.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {photos.map((np) => (
                <div
                  key={np.id}
                  className="relative aspect-square rounded-2xl overflow-hidden bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setViewerZoom(1);
                      setViewerTarget({ kind: 'attachment', photo: np });
                    }}
                    className="w-full h-full block focus:outline-none"
                    aria-label="تكبير الصورة"
                  >
                    <img
                      src={np.dataUrl}
                      alt="صورة مرفقة"
                      className="w-full h-full object-cover"
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Keyboard Bar: compact 5-unit chips strip when typing in a quantity box + "تم" button */}
      {isKeyboardMode && (
        <div className="absolute inset-x-3 bottom-3 z-40 flex items-center justify-between gap-2 pointer-events-none">
          {activeQtyLineIndex !== null ? (
            <div
              data-testid="qty-unit-strip"
              className="pointer-events-auto flex items-center gap-1 overflow-x-auto no-scrollbar bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 rounded-2xl p-1 shadow-lg max-w-full min-w-0"
            >
              {NOTE_QUANTITY_UNIT_OPTIONS.map((opt) => {
                const isSelected =
                  lineQuantityMap.get(activeQtyLineIndex)?.unit === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`qty-unit-${opt.id}`}
                    aria-pressed={isSelected}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleToggleActiveQtyUnit(opt.id)}
                    className={`min-h-[34px] px-2.5 rounded-xl text-[11px] font-extrabold whitespace-nowrap shrink-0 transition active:scale-95 ${
                      isSelected
                        ? 'bg-emerald-500 text-white shadow-xs'
                        : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div />
          )}

          <button
            type="button"
            data-testid="keyboard-done-button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleDoneKeyboard}
            className="pointer-events-auto min-h-[42px] px-3.5 rounded-2xl bg-emerald-500 text-white font-extrabold text-sm shadow-lg shadow-emerald-500/25 flex items-center gap-1.5 active:scale-95 transition shrink-0"
            aria-label="إغلاق لوحة المفاتيح"
          >
            <Check className="w-4 h-4" />
            <span>تم</span>
          </button>
        </div>
      )}

      {/* Normal Mode Fixed Bottom Action Bar (3 buttons: نسخ, واتساب, حاسبة + optional ناتج الحاسبة) */}
      {!isKeyboardMode && (
        <div
          data-testid="notes-bottom-bar"
          className="px-3 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 shrink-0"
        >
          <div className="max-w-3xl mx-auto flex items-center gap-1.5">
            {/* 1. نسخ (primary, wider; long-press opens معاينة النسخ) */}
            <button
              type="button"
              data-testid="copy-note-button"
              onTouchStart={handleCopyTouchStart}
              onTouchMove={cancelCopyHold}
              onTouchEnd={cancelCopyHold}
              onTouchCancel={cancelCopyHold}
              onMouseDown={handleCopyTouchStart}
              onMouseUp={cancelCopyHold}
              onMouseLeave={cancelCopyHold}
              onContextMenu={(e) => {
                e.preventDefault();
                cancelCopyHold();
                if (copyPreviewText) {
                  setShowCopyPreviewSheet(true);
                }
              }}
              onClick={() => {
                if (copyLongPressTriggeredRef.current) {
                  copyLongPressTriggeredRef.current = false;
                  return;
                }
                void handleCopyNote();
              }}
              disabled={!title.trim() && !body.trim()}
              className="flex-[1.3] min-w-[74px] h-11 px-2.5 rounded-xl bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition disabled:opacity-40 select-none"
              aria-label="نسخ الملاحظة"
            >
              {copiedNote ? (
                <>
                  <Check className="w-4 h-4 shrink-0" />
                  <span className="whitespace-nowrap">تم</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 shrink-0" />
                  <span className="whitespace-nowrap">نسخ</span>
                </>
              )}
            </button>

            {/* 2. واتساب (إرسال مباشر) */}
            <button
              type="button"
              onClick={handleDirectWhatsAppSend}
              disabled={!whatsAppMessageText.trim()}
              className={`${
                mathAnalysis.hasAnyCalculated ? 'shrink-0 px-2.5' : 'flex-1 px-2.5'
              } h-11 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 font-extrabold text-xs flex items-center justify-center gap-1 whitespace-nowrap active:scale-95 transition disabled:opacity-40`}
              aria-label="إرسال مباشر عبر واتساب"
            >
              <WhatsAppIcon className="w-4 h-4 shrink-0 text-[#25D366]" />
              <span>واتساب</span>
            </button>

            {/* 3. حاسبة + ناتج الحاسبة (only when note has calculator lines) */}
            <div
              className={`flex items-center gap-1.5 ${
                mathAnalysis.hasAnyCalculated ? 'min-w-0 shrink' : 'flex-1 min-w-0'
              }`}
            >
              {mathAnalysis.hasAnyCalculated && (
                <button
                  type="button"
                  data-testid="calc-result-chip"
                  onClick={handleCopyTotal}
                  className="h-11 px-2 rounded-xl bg-emerald-500/12 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-extrabold text-[11px] flex items-center gap-1 min-w-0 max-w-[132px] active:scale-95 transition"
                  aria-label="نسخ ناتج الحاسبة"
                >
                  {copiedTotal ? (
                    <>
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span className="whitespace-nowrap">تم</span>
                    </>
                  ) : (
                    <>
                      <span className="whitespace-nowrap">ناتج الحاسبة:</span>
                      <span dir="ltr" className="tabular-nums truncate">
                        {formatMathNumber(mathAnalysis.total)}
                      </span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowCalcSheet(true)}
                className={`${
                  mathAnalysis.hasAnyCalculated ? 'shrink-0 px-2.5' : 'w-full px-2.5'
                } h-11 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-extrabold text-xs flex items-center justify-center gap-1 whitespace-nowrap active:scale-95 transition`}
                aria-label="فتح الآلة الحاسبة"
              >
                <Calculator className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>حاسبة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Recipients Sheet ("أشخاص محفوظون") */}
      {showWhatsAppSheet && (
        <WhatsAppSendSheet
          messageText={whatsAppMessageText}
          includeTotal={includeTotalInWhatsApp}
          hasCalculatedTotal={mathAnalysis.hasAnyCalculated}
          onToggleIncludeTotal={onToggleIncludeTotalInWhatsApp}
          onSent={() => {
            void handleRecordWhatsAppSent();
          }}
          onClose={() => setShowWhatsAppSheet(false)}
        />
      )}

      {/* Manual Duplicate Check Sheet ("فحص التكرار") */}
      {showDuplicateCheckSheet && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          dir="rtl"
          onClick={() => setShowDuplicateCheckSheet(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-[24px] sm:rounded-[20px] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[82vh] flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CopyCheck className="w-5 h-5 text-orange-500" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  فحص التكرار
                </h3>
                {manualScanResult.totalExtraDuplicates > 0 && (
                  <span className="px-2 py-0.5 rounded-lg bg-orange-500/15 text-orange-700 dark:text-orange-300 text-xs font-extrabold">
                    {manualScanResult.totalExtraDuplicates} مكرر
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowDuplicateCheckSheet(false)}
                className="w-10 h-10 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {manualScanResult.groups.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6" />
                </div>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  لا توجد سطور مكررة في هذه الملاحظة
                </div>
              </div>
            ) : (
              <div className="overflow-y-auto space-y-2.5 py-1">
                {manualScanResult.groups.map((group) => (
                  <div
                    key={group.id}
                    className="rounded-2xl bg-[#F7F8FA] dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-orange-700 dark:text-orange-300">
                        مكرر
                      </span>
                      <span className="text-[11px] font-bold text-slate-400">
                        {group.items.length} سطور
                      </span>
                    </div>

                    <div className="space-y-1">
                      {group.items.map((item, idxInGroup) => {
                        const qty = lineQuantityMap.get(item.lineIndex);
                        return (
                          <div
                            key={item.lineIndex}
                            className="flex items-baseline gap-2 text-xs text-slate-800 dark:text-slate-100"
                          >
                            <span className="font-extrabold text-emerald-600 dark:text-emerald-400 shrink-0 tabular-nums">
                              السطر {item.lineNumber}:
                            </span>
                            <span className="font-medium break-words min-w-0 flex-1">
                              {item.lineText}
                            </span>
                            {quantitiesEnabled && qty !== undefined && (
                              <span
                                dir="rtl"
                                className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-extrabold text-[11px] tabular-nums shrink-0"
                              >
                                {formatQuantityNumber(qty.quantity)}
                                {qty.unit ? ` ${formatQuantityUnitLabel(qty.unit)}` : ''}
                              </span>
                            )}
                            {idxInGroup === 0 && (
                              <span className="text-[10px] font-bold text-slate-400 shrink-0">
                                الأصلي
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {unitMismatchGroupIds.includes(group.id) && (
                      <div
                        data-testid="duplicate-unit-mismatch-note"
                        className="rounded-xl bg-amber-500/12 border border-amber-500/30 px-2.5 py-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-300"
                      >
                        تختلف الوحدات — تم إبقاء السطور دون دمج
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      {quantitiesEnabled && (
                        <button
                          type="button"
                          onClick={() => handleManualGroupMerge(group)}
                          className="min-h-[42px] flex-1 rounded-xl bg-emerald-600 text-white text-xs font-extrabold active:scale-95 transition"
                        >
                          دمج
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleManualGroupDelete(group)}
                        className="min-h-[42px] flex-1 rounded-xl bg-red-600 text-white text-xs font-extrabold active:scale-95 transition"
                      >
                        حذف المكرر
                      </button>
                      <button
                        type="button"
                        onClick={() => handleManualGroupKeep(group)}
                        className="min-h-[42px] flex-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold active:scale-95 transition"
                      >
                        إبقاء
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Side Picture Slot Small Action Menu */}
      {menuLineIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-4"
          dir="rtl"
          onClick={() => setMenuLineIndex(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[20px] p-4 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-2"
          >
            <div className="flex items-center justify-between pb-1">
              <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                إضافة صورة للسطر
              </span>
              <button
                type="button"
                onClick={() => setMenuLineIndex(null)}
                className="w-9 h-9 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                pendingLineTargetRef.current = menuLineIndex;
                setMenuLineIndex(null);
                lineCameraInputRef.current?.click();
              }}
              className="w-full min-h-[52px] px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.98] transition"
            >
              <Camera className="w-5 h-5 text-emerald-500" />
              <span>التقاط صورة</span>
            </button>

            <button
              type="button"
              onClick={() => {
                pendingLineTargetRef.current = menuLineIndex;
                setMenuLineIndex(null);
                lineGalleryInputRef.current?.click();
              }}
              className="w-full min-h-[52px] px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.98] transition"
            >
              <ImagePlus className="w-5 h-5 text-emerald-500" />
              <span>من المعرض</span>
            </button>
          </div>
        </div>
      )}

      {/* Calculator Keypad Sheet */}
      {showCalcSheet && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowCalcSheet(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-[24px] sm:rounded-[20px] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                الآلة الحاسبة
              </h3>
              <button
                type="button"
                onClick={() => setShowCalcSheet(false)}
                className="w-10 h-10 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              className="bg-[#F7F8FA] dark:bg-slate-800 rounded-2xl p-3.5 text-left min-h-[74px] flex flex-col justify-between"
              dir="ltr"
            >
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100 break-all tabular-nums">
                {calcState.expression || '0'}
              </div>
              <div className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums min-h-[18px]">
                {calcLiveResult !== null
                  ? `= ${formatMathNumber(calcLiveResult)}`
                  : ''}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2" dir="ltr">
              {KEYPAD_BUTTONS.flat().map((btn) => {
                const isOp = ['+', '-', '×', '÷', '(', ')'].includes(btn);
                const isEq = btn === '=';
                const isClear = btn === 'C';
                return (
                  <button
                    key={btn}
                    type="button"
                    onClick={() => handleCalcKey(btn)}
                    className={`min-h-[52px] rounded-2xl font-extrabold text-lg flex items-center justify-center active:scale-95 transition ${
                      isEq
                        ? 'bg-emerald-500 text-white'
                        : isClear
                        ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                        : isOp
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-900 dark:text-white'
                    }`}
                  >
                    {btn === '⌫' ? <Delete className="w-5 h-5" /> : btn}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleInsertExpression}
              className="min-h-[54px] w-full rounded-2xl bg-emerald-500 text-white font-extrabold text-sm active:scale-95 transition"
            >
              إدراج في الملاحظة
            </button>
          </div>
        </div>
      )}

      {/* Full-Screen Photo Viewer (attachments & numbered line side pictures) */}
      {viewerTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950 flex flex-col select-none"
          dir="rtl"
        >
          <div className="px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] flex items-center justify-between bg-slate-950/90 border-b border-slate-800">
            <button
              type="button"
              onClick={() => setViewerTarget(null)}
              className="min-w-[52px] min-h-[52px] rounded-2xl bg-slate-800 text-white flex items-center justify-center"
              aria-label="إغلاق"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewerZoom((z) => Math.max(1, z - 0.5))}
                className="min-w-[46px] min-h-[46px] rounded-xl bg-slate-800 text-white flex items-center justify-center"
                aria-label="تصغير"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setViewerZoom((z) => Math.min(4, z + 0.5))}
                className="min-w-[46px] min-h-[46px] rounded-xl bg-slate-800 text-white flex items-center justify-center"
                aria-label="تكبير"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (viewerTarget.kind === 'attachment') {
                    const delId = viewerTarget.photo.id;
                    setPhotos((prev) => prev.filter((p) => p.id !== delId));
                  } else {
                    removeLinePhoto(viewerTarget.lineIndex);
                  }
                  setViewerTarget(null);
                }}
                className="min-w-[52px] min-h-[52px] rounded-2xl bg-red-600/20 text-red-400 flex items-center justify-center"
                aria-label="حذف الصورة"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div
            className="flex-1 overflow-hidden flex items-center justify-center bg-black touch-none"
            onTouchStart={(e) => {
              if (e.touches.length === 2) {
                pinchDistRef.current = Math.hypot(
                  e.touches[0].clientX - e.touches[1].clientX,
                  e.touches[0].clientY - e.touches[1].clientY
                );
                pinchZoomRef.current = viewerZoom;
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && pinchDistRef.current) {
                const dist = Math.hypot(
                  e.touches[0].clientX - e.touches[1].clientX,
                  e.touches[0].clientY - e.touches[1].clientY
                );
                setViewerZoom(
                  Math.max(
                    1,
                    Math.min(
                      4,
                      pinchZoomRef.current * (dist / pinchDistRef.current)
                    )
                  )
                );
              }
            }}
            onTouchEnd={() => {
              pinchDistRef.current = null;
            }}
          >
            <img
              src={
                viewerTarget.kind === 'attachment'
                  ? viewerTarget.photo.dataUrl
                  : viewerTarget.dataUrl
              }
              alt="عرض الصورة"
              style={{ transform: `scale(${viewerZoom})` }}
              className="max-w-full max-h-full object-contain transition-transform duration-75"
            />
          </div>
        </div>
      )}

      {/* Merged Photo Source Picker Sheet ("صورة" -> الكاميرا أو المعرض) */}
      {showPhotoSourceMenu && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-4"
          dir="rtl"
          onClick={() => setShowPhotoSourceMenu(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[20px] p-4 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-2"
          >
            <div className="flex items-center justify-between pb-1">
              <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                إرفاق صورة للملاحظة
              </span>
              <button
                type="button"
                onClick={() => setShowPhotoSourceMenu(false)}
                className="w-9 h-9 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowPhotoSourceMenu(false);
                cameraInputRef.current?.click();
              }}
              className="w-full min-h-[50px] px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.98] transition"
            >
              <Camera className="w-5 h-5 text-emerald-500 shrink-0" />
              <span>التقاط صورة بالكاميرا</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPhotoSourceMenu(false);
                galleryInputRef.current?.click();
              }}
              className="w-full min-h-[50px] px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.98] transition"
            >
              <ImagePlus className="w-5 h-5 text-emerald-500 shrink-0" />
              <span>اختيار من المعرض</span>
            </button>
          </div>
        </div>
      )}

      {/* "المزيد" Grouped Bottom Sheet */}
      {showToolbarMoreMenu && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          dir="rtl"
          onClick={() => setShowToolbarMoreMenu(false)}
        >
          <div
            data-testid="notes-more-sheet"
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-[24px] sm:rounded-[20px] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl border border-slate-200 dark:border-slate-800 space-y-2.5 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                المزيد
              </h3>
              <button
                type="button"
                onClick={() => setShowToolbarMoreMenu(false)}
                className="w-9 h-9 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {overflowToolbarButtons.length > 0 && (
              <div className="space-y-1 pb-2 border-b border-slate-200/80 dark:border-slate-800">
                {overflowToolbarButtons.map((btn) => {
                  const Icon = btn.icon;
                  return (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => {
                        setShowToolbarMoreMenu(false);
                        btn.onClick();
                      }}
                      className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center justify-between gap-3 active:scale-[0.99] transition"
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>{btn.label}</span>
                      </span>
                      {btn.isToggle && (
                        <span
                          className={`text-xs font-extrabold ${
                            btn.active ? 'text-emerald-600' : 'text-slate-400'
                          }`}
                        >
                          {btn.active ? 'مفعّل' : 'متوقف'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Group 1: الإدخال */}
            <div className="space-y-1">
              <div className="px-2 text-[11px] font-extrabold text-slate-400 dark:text-slate-500">
                الإدخال
              </div>

              <button
                type="button"
                data-testid="note-menu-auto-take"
                onClick={() => {
                  onUpdateNoteSettings?.({
                    autoTakeNoteNumber: !autoTakeNoteNumber,
                  });
                  setShowToolbarMoreMenu(false);
                }}
                className="w-full min-h-[46px] px-3.5 rounded-xl hover:bg-[#F7F8FA] dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center justify-between gap-3 active:scale-[0.99] transition text-right"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Package className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>أخذ الرقم تلقائياً</span>
                </span>
                <span
                  className={`text-xs font-extrabold shrink-0 ${
                    autoTakeNoteNumber
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-400'
                  }`}
                >
                  {autoTakeNoteNumber ? 'مفعّل' : 'متوقف'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setResetAfterBlankLine((prev) => {
                    const next = !prev;
                    if (next && !numberingEnabled) {
                      setNumberingEnabled(true);
                    }
                    return next;
                  });
                  setShowToolbarMoreMenu(false);
                }}
                className="w-full min-h-[46px] px-3.5 rounded-xl hover:bg-[#F7F8FA] dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center justify-between gap-3 active:scale-[0.99] transition text-right"
              >
                <span className="flex items-center gap-3">
                  <ListRestart className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>إعادة الترقيم بعد الفراغ</span>
                </span>
                <span
                  className={`text-xs font-extrabold ${
                    numberingEnabled && resetAfterBlankLine
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-400'
                  }`}
                >
                  {numberingEnabled && resetAfterBlankLine ? 'مفعّل' : 'متوقف'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowToolbarMoreMenu(false);
                  handleOpenManualDuplicateCheck();
                }}
                className="w-full min-h-[46px] px-3.5 rounded-xl hover:bg-[#F7F8FA] dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.99] transition text-right"
              >
                <CopyCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>فحص التكرار</span>
              </button>
            </div>

            {/* Group 2: النسخ والإرسال */}
            <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="px-2 text-[11px] font-extrabold text-slate-400 dark:text-slate-500">
                النسخ والإرسال
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowToolbarMoreMenu(false);
                  setShowCopyPreviewSheet(true);
                }}
                className="w-full min-h-[46px] px-3.5 rounded-xl hover:bg-[#F7F8FA] dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.99] transition text-right"
              >
                <Eye className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>معاينة النسخ</span>
              </button>

              <button
                type="button"
                onClick={handleShareOtherApp}
                className="w-full min-h-[46px] px-3.5 rounded-xl hover:bg-[#F7F8FA] dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.99] transition text-right"
              >
                <Share2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>مشاركة بتطبيق آخر</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowToolbarMoreMenu(false);
                  setShowWhatsAppSheet(true);
                }}
                className="w-full min-h-[46px] px-3.5 rounded-xl hover:bg-[#F7F8FA] dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.99] transition text-right"
              >
                <Users className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>أشخاص محفوظون</span>
              </button>
            </div>

            {/* Group 3: الإعدادات */}
            <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="px-2 text-[11px] font-extrabold text-slate-400 dark:text-slate-500">
                الإعدادات
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowToolbarMoreMenu(false);
                  setShowNoteSettingsSheet(true);
                }}
                className="w-full min-h-[46px] px-3.5 rounded-xl hover:bg-[#F7F8FA] dark:hover:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.99] transition text-right"
              >
                <Settings2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>إعدادات الملاحظات</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Preview Sheet ("معاينة النسخ") */}
      {showCopyPreviewSheet && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          dir="rtl"
          onClick={() => setShowCopyPreviewSheet(false)}
        >
          <div
            data-testid="copy-preview-sheet"
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-[24px] sm:rounded-[20px] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[82vh] flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-emerald-500" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  معاينة النسخ
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCopyPreviewSheet(false)}
                className="w-10 h-10 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <pre
              dir="rtl"
              data-testid="copy-preview-text"
              className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-800 dark:text-slate-100 bg-[#F7F8FA] dark:bg-slate-800 rounded-2xl p-3.5 max-h-[48vh] overflow-y-auto border border-slate-200/70 dark:border-slate-700"
            >
              {copyPreviewText || 'الملاحظة فارغة'}
            </pre>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                type="button"
                onClick={async () => {
                  await handleCopyNote();
                  setShowCopyPreviewSheet(false);
                }}
                disabled={!copyPreviewText}
                className="min-h-[48px] rounded-2xl bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-40"
              >
                <Copy className="w-4 h-4" />
                <span>نسخ النص</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCopyPreviewSheet(false);
                  setShowNoteSettingsSheet(true);
                }}
                className="min-h-[48px] px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-xs flex items-center gap-1.5 active:scale-95 transition"
              >
                <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
                <span>شكل النسخ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Consolidated Note Settings Sheet ("إعدادات الملاحظات") */}
      <NoteSettingsSheet
        open={showNoteSettingsSheet}
        onClose={() => setShowNoteSettingsSheet(false)}
        noteCopySortOrder={noteCopySortOrder}
        noteCopyDigitStyle={noteCopyDigitStyle}
        noteCopyIncludeTotalQuantities={noteCopyIncludeTotalQuantities}
        includeTotalInWhatsApp={includeTotalInWhatsApp}
        defaultNoteQuantities={defaultNoteQuantities}
        defaultNoteNumbering={defaultNoteNumbering}
        autoTakeNoteNumber={autoTakeNoteNumber}
        noteUnitMode={noteUnitMode}
        noteDefaultUnit={noteDefaultUnit}
        onUpdateNoteSettings={(partial) => {
          if (typeof partial.includeTotalInWhatsApp === 'boolean') {
            onToggleIncludeTotalInWhatsApp(partial.includeTotalInWhatsApp);
          }
          onUpdateNoteSettings?.(partial);
        }}
        onUnitMemoryCleared={() => showTopUnitNotice('تم مسح ذاكرة الوحدات')}
      />
    </div>
  );
};
