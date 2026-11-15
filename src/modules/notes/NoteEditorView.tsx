import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Calculator,
  Camera,
  Check,
  Copy,
  Delete,
  Flame,
  Hash,
  ImagePlus,
  ListRestart,
  Plus,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  KnownProduct,
  NoteItem,
  NoteLinePhoto,
  NotePhoto,
} from '../../types';
import { getAllKnownProducts, getTopPulledProducts } from '../db';
import { compressCanvasToJpeg, fileOrDataUrlToCanvas } from '../camera/imageCompression';
import {
  CalculatorState,
  applyCalculatorKey,
  computeNoteTotal,
  formatMathNumber,
  getCalculatorLiveResult,
  parseNoteLineMath,
} from './mathParser';
import { realignLinePhotosAfterEdit } from './linePhotoAlignment';
import { computeVisualLineNumbers, formatNoteForCopy } from './noteFormat';

interface NoteEditorViewProps {
  note: NoteItem;
  onChangeNote: (updated: NoteItem) => Promise<void>;
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
  onChangeNote,
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

  const [copiedTotal, setCopiedTotal] = useState(false);
  const [copiedNote, setCopiedNote] = useState(false);
  const [showCalcSheet, setShowCalcSheet] = useState(false);
  const [calcState, setCalcState] = useState<CalculatorState>({
    expression: '',
    justEvaluated: false,
  });

  // Side-picture slot menu & top-pulled picker
  const [menuLineIndex, setMenuLineIndex] = useState<number | null>(null);
  const [topPickLineIndex, setTopPickLineIndex] = useState<number | null>(null);
  const [pickableProducts, setPickableProducts] = useState<KnownProduct[]>([]);
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

  // Refs for plain-mode textarea and numbered-mode line inputs
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineInputRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
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

  // Autosave whenever fields change
  useEffect(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      onChangeNote({
        ...note,
        title,
        body,
        photos,
        linePhotos,
        numberingEnabled,
        resetAfterBlankLine,
        updatedAt: Date.now(),
      });
    }, 180);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [title, body, photos, linePhotos, numberingEnabled, resetAfterBlankLine]);

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

  const linePhotoMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const lp of linePhotos) {
      map.set(lp.lineIndex, lp.dataUrl);
    }
    return map;
  }, [linePhotos]);

  // Update body while preserving visual side picture alignment cleanly
  const updateBodyWithAlignment = (nextBody: string) => {
    const oldLines = body.split('\n');
    const newLines = nextBody.split('\n');
    if (oldLines.length !== newLines.length) {
      setLinePhotos((prev) =>
        realignLinePhotosAfterEdit(oldLines, newLines, prev)
      );
    }
    setBody(nextBody);
  };

  // Auto-resize numbered line textareas so wrapped Arabic lines align accurately
  useEffect(() => {
    if (!numberingEnabled) return;
    const raf = requestAnimationFrame(() => {
      for (let i = 0; i < rawLines.length; i++) {
        const el = lineInputRefs.current[i];
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${Math.max(28, el.scrollHeight)}px`;
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [rawLines, numberingEnabled]);

  // Measure mirror paragraph offsets for plain mode (numbering off)
  useEffect(() => {
    if (numberingEnabled) return;
    const raf = requestAnimationFrame(() => {
      const next: Array<{ top: number; height: number }> = [];
      let y = 0;
      for (let i = 0; i < rawLines.length; i++) {
        const el = mirrorRefs.current[i];
        const h = el ? el.offsetHeight : 28;
        next.push({ top: y, height: h });
        y += h;
      }
      setLineMetrics(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [rawLines, numberingEnabled, mathAnalysis.hasAnyCalculated]);

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

  const openTopPulledPickerForLine = async (lineIdx: number) => {
    setMenuLineIndex(null);
    setTopPickLineIndex(lineIdx);
    const [topRes, allProducts] = await Promise.all([
      getTopPulledProducts(12),
      getAllKnownProducts(),
    ]);
    // Combine top-pulled first, then other saved product thumbnails if needed
    const seen = new Set<string>();
    const combined: KnownProduct[] = [];
    for (const p of [...topRes.products, ...allProducts]) {
      if (!p.thumbnailDataUrl || seen.has(p.id)) continue;
      seen.add(p.id);
      combined.push(p);
    }
    setPickableProducts(combined);
  };

  const handleCopyTotal = async () => {
    const textToCopy = formatMathNumber(mathAnalysis.total);
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedTotal(true);
      setTimeout(() => setCopiedTotal(false), 1800);
    } catch {
      // Fallback
    }
  };

  const handleCopyNote = async () => {
    const textToCopy = formatNoteForCopy({
      title,
      body,
      numberingEnabled,
      resetAfterBlankLine,
    });
    if (!textToCopy) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        throw new Error('Clipboard API unavailable');
      }
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

    if (numberingEnabled && activeLineIndexRef.current !== null) {
      const idx = Math.min(rawLines.length - 1, activeLineIndexRef.current);
      const nextLines = [...rawLines];
      nextLines[idx] = nextLines[idx] ? `${nextLines[idx]} ${expr}` : expr;
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
    }, 30);
  };

  // Keyboard handlers for numbered-line editors (Enter splits line, Backspace at start merges)
  const handleNumberedLineChange = (idx: number, val: string) => {
    if (val.includes('\n')) {
      const inserted = val.split('\n');
      const nextLines = [
        ...rawLines.slice(0, idx),
        ...inserted,
        ...rawLines.slice(idx + 1),
      ];
      updateBodyWithAlignment(nextLines.join('\n'));
      const focusIdx = idx + inserted.length - 1;
      setTimeout(() => {
        const el = lineInputRefs.current[focusIdx];
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }, 10);
      return;
    }

    const nextLines = [...rawLines];
    nextLines[idx] = val;
    setBody(nextLines.join('\n'));
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
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const nextLines = [
        ...rawLines.slice(0, idx),
        before,
        after,
        ...rawLines.slice(idx + 1),
      ];
      updateBodyWithAlignment(nextLines.join('\n'));
      setTimeout(() => {
        const nextEl = lineInputRefs.current[idx + 1];
        if (nextEl) {
          nextEl.focus();
          nextEl.setSelectionRange(0, 0);
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
      setTimeout(() => {
        const prevEl = lineInputRefs.current[idx - 1];
        if (prevEl) {
          prevEl.focus();
          prevEl.setSelectionRange(prevLen, prevLen);
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

  const calcLiveResult = getCalculatorLiveResult(calcState);
  const editorTotalHeight = Math.max(
    260,
    lineMetrics.length > 0
      ? lineMetrics[lineMetrics.length - 1].top +
          lineMetrics[lineMetrics.length - 1].height +
          32
      : 260
  );

  return (
    <div
      className="fixed inset-0 bottom-[calc(68px+env(safe-area-inset-bottom,0px))] z-30 bg-[#F7F8FA] dark:bg-slate-950 flex flex-col"
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

      {/* Top Toolbar */}
      <header className="px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top,0px))] bg-white/95 dark:bg-slate-900/95 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={async () => {
            await onChangeNote({
              ...note,
              title,
              body,
              photos,
              linePhotos,
              numberingEnabled,
              resetAfterBlankLine,
              updatedAt: Date.now(),
            });
            onClose();
          }}
          className="min-w-[48px] min-h-[48px] rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center active:scale-95 transition"
          aria-label="العودة للملاحظات"
        >
          <ArrowRight className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setNumberingEnabled((v) => !v)}
            className={`min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
              numberingEnabled
                ? 'bg-emerald-500 text-white'
                : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Hash className="w-4 h-4" />
            <span>ترقيم</span>
          </button>

          {numberingEnabled && (
            <button
              type="button"
              onClick={() => setResetAfterBlankLine((v) => !v)}
              className={`min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition ${
                resetAfterBlankLine
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
                  : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
              title="إعادة الترقيم بعد السطر الفارغ"
            >
              <ListRestart className="w-4 h-4" />
              <span>إعادة بعد الفراغ</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0"
            aria-label="إضافة صورة بالكاميرا"
          >
            <Camera className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0"
            aria-label="استيراد صور من المعرض"
          >
            <ImagePlus className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowCalcSheet(true)}
            className="min-w-[44px] min-h-[44px] rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0"
            aria-label="فتح الآلة الحاسبة"
          >
            <Calculator className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Scrollable Editor Body */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان الملاحظة..."
              className="flex-1 min-w-0 bg-transparent text-xl font-extrabold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopyNote}
              disabled={!title.trim() && !body.trim()}
              className="min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-sm active:scale-95 transition disabled:opacity-40"
              aria-label="نسخ الملاحظة"
            >
              {copiedNote ? (
                <>
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">
                    تم النسخ
                  </span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>نسخ الملاحظة</span>
                </>
              )}
            </button>
          </div>

          {/* Editor Card */}
          <div className="relative bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm p-3">
            {numberingEnabled ? (
              /* Numbered Lines with Compact 36px Visual Side Picture Slots + Inline Math Results */
              <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {rawLines.map((lineText, idx) => {
                  const num = lineNumbers[idx];
                  const linePic = linePhotoMap.get(idx);
                  const lineMath =
                    mathAnalysis.lines[idx] || parseNoteLineMath(lineText);

                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-2 py-1.5 min-h-[46px]"
                    >
                      {num !== null ? (
                        <>
                          {/* Visual Line Number (never written into note text) */}
                          <span className="w-5 pt-2 text-xs font-extrabold text-slate-400 tabular-nums text-center shrink-0 select-none">
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
                              className="w-9 h-9 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 active:scale-95 transition select-none"
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
                              className="w-9 h-9 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-[#F7F8FA] dark:bg-slate-800/70 text-slate-400 hover:text-emerald-500 hover:border-emerald-400 flex items-center justify-center shrink-0 active:scale-95 transition"
                              aria-label="إضافة صورة للسطر"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="w-[64px] shrink-0" />
                      )}

                      <div className="flex-1 min-w-0 pt-1 flex items-start gap-2">
                        <textarea
                          ref={(el) => {
                            lineInputRefs.current[idx] = el;
                          }}
                          rows={1}
                          value={lineText}
                          onFocus={() => {
                            activeLineIndexRef.current = idx;
                          }}
                          onChange={(e) =>
                            handleNumberedLineChange(idx, e.target.value)
                          }
                          onKeyDown={(e) => handleNumberedLineKeyDown(idx, e)}
                          placeholder={
                            idx === 0
                              ? 'اكتب الصنف أو العملية مثل 6 * 12...'
                              : 'سطر جديد...'
                          }
                          className="flex-1 min-w-0 resize-none bg-transparent text-base leading-7 font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none overflow-hidden"
                        />

                        {lineMath.hasExpression && (
                          <span
                            dir="ltr"
                            className="h-7 px-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-extrabold flex items-center tabular-nums max-w-[96px] truncate shrink-0 select-none"
                          >
                            = {lineMath.formattedResult}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Unnumbered Mode: Unified RTL Textarea + Inline Calculator Results */
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none invisible absolute top-3 inset-x-3 text-base leading-7 font-medium whitespace-pre-wrap break-words pr-1 pl-24"
                >
                  {rawLines.map((ln, idx) => (
                    <div
                      key={idx}
                      ref={(el) => {
                        mirrorRefs.current[idx] = el;
                      }}
                      className="min-h-[28px]"
                    >
                      {ln || ' '}
                    </div>
                  ))}
                </div>

                <div className="relative" style={{ minHeight: editorTotalHeight }}>
                  {lineMetrics.map((m, idx) => {
                    const parsed = mathAnalysis.lines[idx];
                    if (!parsed || !parsed.hasExpression) return null;
                    return (
                      <span
                        key={idx}
                        dir="ltr"
                        style={{ top: `${m.top}px` }}
                        className="pointer-events-none select-none absolute left-1 h-7 px-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-extrabold flex items-center tabular-nums max-w-[92px] truncate"
                      >
                        = {parsed.formattedResult}
                      </span>
                    );
                  })}

                  <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => updateBodyWithAlignment(e.target.value)}
                    placeholder="اكتب ملاحظتك أو عمليات حسابية مثل 6 * 12..."
                    style={{ height: editorTotalHeight }}
                    className="w-full resize-none bg-transparent text-base leading-7 font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none overflow-hidden pr-1 pl-24"
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

      {/* Bottom Total Bar */}
      <div className="px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] bg-white/95 dark:bg-slate-900/95 border-t border-slate-200/80 dark:border-slate-800 shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              المجموع:
            </span>
            <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums truncate">
              {mathAnalysis.hasAnyCalculated
                ? formatMathNumber(mathAnalysis.total)
                : '0'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyTotal}
              className="min-h-[48px] px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 active:scale-95 transition"
            >
              {copiedTotal ? (
                <>
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span>تم النسخ</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>نسخ</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowCalcSheet(true)}
              className="min-h-[48px] px-4 rounded-2xl bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 active:scale-95 transition"
            >
              <Calculator className="w-4 h-4" />
              <span>حاسبة</span>
            </button>
          </div>
        </div>
      </div>

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

            <button
              type="button"
              onClick={() => openTopPulledPickerForLine(menuLineIndex)}
              className="w-full min-h-[52px] px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-sm flex items-center gap-3 active:scale-[0.98] transition"
            >
              <Flame className="w-5 h-5 text-amber-500" />
              <span>من «يُسحب كثيراً»</span>
            </button>
          </div>
        </div>
      )}

      {/* Top Pulled / Known Products Thumbnail Picker */}
      {topPickLineIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
          dir="rtl"
          onClick={() => setTopPickLineIndex(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-[24px] sm:rounded-[20px] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[75vh] flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-500" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  اختر من «يُسحب كثيراً»
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setTopPickLineIndex(null)}
                className="w-10 h-10 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pickableProducts.length === 0 ? (
              <div className="py-10 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                لا توجد منتجات محفوظة بعد، صوّر الرفوف أولاً.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2.5 overflow-y-auto py-1">
                {pickableProducts.map((kp) => (
                  <button
                    key={kp.id}
                    type="button"
                    onClick={() => {
                      assignLinePhoto(topPickLineIndex, kp.thumbnailDataUrl);
                      setTopPickLineIndex(null);
                    }}
                    className="aspect-square rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 active:scale-95 transition"
                  >
                    <img
                      src={kp.thumbnailDataUrl}
                      alt={kp.productName || ''}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
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
    </div>
  );
};
