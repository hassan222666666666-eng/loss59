import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckSquare,
  Copy,
  Image as ImageIcon,
  Plus,
  Search,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { AppSettings, NoteItem } from '../../types';
import {
  deleteNoteById,
  deleteNotesBulk,
  getAllNotes,
  saveNote,
  saveNotesBulk,
} from '../db';
import { formatDayHeading, getLocalDateKey } from '../../utils/arabicText';
import { NoteEditorView } from './NoteEditorView';
import { formatNoteForCopy } from './noteFormat';
import { formatSentTimestampArabic } from './whatsapp';

interface NotesScreenProps {
  settings: AppSettings;
  refreshSignal: number;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onKeyboardOpenChange?: (isOpen: boolean) => void;
}

const SwipeableNoteCard: React.FC<{
  onSwipeDelete: () => void;
  children: React.ReactNode;
}> = ({ onSwipeDelete, children }) => {
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    setSwiping(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;
    if (!swiping && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      setSwiping(true);
    }
    if (swiping) setOffsetX(dx);
  };

  const handleTouchEnd = () => {
    if (swiping && Math.abs(offsetX) > 95) {
      setOffsetX(offsetX > 0 ? 280 : -280);
      setTimeout(() => {
        onSwipeDelete();
      }, 120);
    } else {
      setOffsetX(0);
    }
    startXRef.current = null;
    startYRef.current = null;
    setSwiping(false);
  };

  return (
    <div className="relative overflow-hidden rounded-[20px]">
      {Math.abs(offsetX) > 18 && (
        <div className="absolute inset-0 bg-red-500 text-white flex items-center justify-between px-5 font-extrabold text-sm rounded-[20px]">
          <span>حذف</span>
          <Trash2 className="w-5 h-5" />
        </div>
      )}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={
          offsetX !== 0 ? { transform: `translateX(${offsetX}px)` } : undefined
        }
        className="relative transition-transform duration-150"
      >
        {children}
      </div>
    </div>
  );
};

export const NotesScreen: React.FC<NotesScreenProps> = ({
  settings,
  refreshSignal,
  onUpdateSettings,
  onKeyboardOpenChange,
}) => {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  // Undo toast for swiped / bulk-deleted notes
  const [undoNotes, setUndoNotes] = useState<NoteItem[] | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // Bulk selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(
    () => new Set()
  );
  const [copiedSelected, setCopiedSelected] = useState(false);

  const loadNotesData = useCallback(async () => {
    const allNotes = await getAllNotes();
    setNotes(allNotes);
  }, []);

  useEffect(() => {
    loadNotesData();
  }, [loadNotesData, refreshSignal]);

  const handleCreateNote = async () => {
    const now = Date.now();
    const newNote: NoteItem = {
      id: `note_${now}_${Math.random().toString(36).slice(2, 6)}`,
      title: '',
      body: '',
      photos: [],
      numberingEnabled: settings.defaultNoteNumbering,
      resetAfterBlankLine: false,
      quantitiesEnabled: settings.defaultNoteQuantities !== false,
      lineQuantities: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveNote(newNote);
    await loadNotesData();
    setActiveNoteId(newNote.id);
  };

  const handleDeleteNoteWithUndo = async (note: NoteItem) => {
    await deleteNoteById(note.id);
    setUndoNotes([note]);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      setUndoNotes(null);
    }, 5500);
    await loadNotesData();
  };

  const handleUndoDelete = async () => {
    if (!undoNotes || undoNotes.length === 0) return;
    const restored = undoNotes;
    setUndoNotes(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    if (restored.length === 1) {
      await saveNote(restored[0]);
    } else {
      await saveNotesBulk(restored);
    }
    await loadNotesData();
  };

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
    );
  }, [notes, searchQuery]);

  const hasVisibleNotes = filteredNotes.length > 0;
  const isAllVisibleSelected = useMemo(() => {
    if (!hasVisibleNotes) return false;
    return filteredNotes.every((n) => selectedNoteIds.has(n.id));
  }, [hasVisibleNotes, filteredNotes, selectedNoteIds]);

  const handleToggleSelectAll = () => {
    if (!hasVisibleNotes) return;
    if (selectionMode && isAllVisibleSelected) {
      setSelectionMode(false);
      setSelectedNoteIds(new Set());
    } else {
      setSelectionMode(true);
      setSelectedNoteIds(new Set(filteredNotes.map((n) => n.id)));
    }
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedNoteIds(new Set());
  };

  const toggleNoteSelection = (id: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const toDelete = notes.filter((n) => selectedNoteIds.has(n.id));
    if (toDelete.length === 0) return;
    await deleteNotesBulk(toDelete.map((n) => n.id));
    setUndoNotes(toDelete);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      setUndoNotes(null);
    }, 5500);
    handleCancelSelection();
    await loadNotesData();
  };

  const handleBulkCopy = async () => {
    const selected = filteredNotes.filter((n) => selectedNoteIds.has(n.id));
    if (selected.length === 0) return;
    const text = selected
      .map((n) =>
        formatNoteForCopy({
          title: n.title,
          body: n.body,
          numberingEnabled: Boolean(n.numberingEnabled),
          resetAfterBlankLine: Boolean(n.resetAfterBlankLine),
          quantitiesEnabled: Boolean(n.quantitiesEnabled),
          lineQuantities: n.lineQuantities || [],
          sortOrder: settings.noteCopySortOrder || 'as-written',
          digitStyle: settings.noteCopyDigitStyle || 'western',
          includeTotalQuantities: Boolean(settings.noteCopyIncludeTotalQuantities),
        })
      )
      .filter(Boolean)
      .join('\n\n---\n\n');
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      setCopiedSelected(true);
      window.setTimeout(() => setCopiedSelected(false), 1800);
    } catch {
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.setAttribute('readonly', '');
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      setCopiedSelected(true);
      window.setTimeout(() => setCopiedSelected(false), 1800);
    }
  };

  const activeNote = activeNoteId
    ? notes.find((n) => n.id === activeNoteId) || null
    : null;

  return (
    <div
      className="min-h-[100dvh] pb-28 bg-[#F7F8FA] dark:bg-slate-950"
      dir="rtl"
    >
      <header className="sticky top-0 z-20 bg-[#F7F8FA]/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-3">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
              الملاحظات
            </h1>

            <div className="flex items-center gap-2">
              {selectionMode && (
                <button
                  type="button"
                  onClick={handleCancelSelection}
                  className="min-h-[44px] px-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition"
                >
                  <X className="w-4 h-4" />
                  <span>إلغاء</span>
                </button>
              )}

              {hasVisibleNotes && (
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className={`min-h-[44px] px-3.5 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 active:scale-95 transition ${
                    selectionMode && isAllVisibleSelected
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {selectionMode && isAllVisibleSelected ? (
                    <CheckSquare className="w-4 h-4" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  <span>
                    {selectionMode && isAllVisibleSelected
                      ? 'إلغاء التحديد'
                      : 'تحديد الكل'}
                  </span>
                </button>
              )}

              {!selectionMode && (
                <button
                  type="button"
                  onClick={() => handleCreateNote()}
                  className="min-h-[44px] min-w-[44px] px-3.5 rounded-2xl bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition"
                  aria-label="ملاحظة جديدة"
                >
                  <Plus className="w-5 h-5" />
                  <span>جديدة</span>
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث في الملاحظات..."
              className="w-full min-h-[48px] pr-10 pl-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-4 space-y-6">
        {/* Notes List */}
        <section className="space-y-2.5">
          {filteredNotes.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[20px] p-8 text-center border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-3">
                <StickyNote className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                لا توجد ملاحظات بعد
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                أنشئ ملاحظة لتدوين الطلبات، الحسابات السريعة، أو صور الأصناف.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {filteredNotes.map((note) => {
                const firstLine =
                  note.body
                    .split('\n')
                    .map((l) => l.trim())
                    .find(Boolean) || '';
                const dateLabel = formatDayHeading(getLocalDateKey(note.updatedAt));
                const firstPhoto =
                  note.photos?.[0]?.thumbnailDataUrl || note.photos?.[0]?.dataUrl;

                const isSelected = selectedNoteIds.has(note.id);
                const cardButton = (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectionMode) {
                        toggleNoteSelection(note.id);
                      } else {
                        setActiveNoteId(note.id);
                      }
                    }}
                    className={`w-full rounded-[20px] p-4 border shadow-sm flex items-center gap-3 text-right active:scale-[0.99] transition ${
                      selectionMode && isSelected
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500 ring-2 ring-emerald-500/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
                    }`}
                  >
                    {selectionMode && (
                      <span className="shrink-0">
                        {isSelected ? (
                          <CheckSquare className="w-6 h-6 text-emerald-500" />
                        ) : (
                          <Square className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                        )}
                      </span>
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="text-base font-extrabold text-slate-900 dark:text-white truncate">
                        {note.title.trim() || 'ملاحظة بدون عنوان'}
                      </div>
                      {firstLine && (
                        <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
                          {firstLine}
                        </div>
                      )}
                      <div className="text-xs text-slate-400 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                        <span>{dateLabel}</span>
                        {note.photos && note.photos.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <ImageIcon className="w-3.5 h-3.5 inline" />
                          </>
                        )}
                        {note.lastSentAt && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            · أُرسلت · {formatSentTimestampArabic(note.lastSentAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    {firstPhoto && (
                      <img
                        src={firstPhoto}
                        alt="معاينة الملاحظة"
                        decoding="async"
                        loading="lazy"
                        className="w-16 h-16 rounded-xl object-cover shrink-0 bg-slate-100 dark:bg-slate-800"
                      />
                    )}
                  </button>
                );

                return selectionMode ? (
                  <div key={note.id}>{cardButton}</div>
                ) : (
                  <SwipeableNoteCard
                    key={note.id}
                    onSwipeDelete={() => handleDeleteNoteWithUndo(note)}
                  >
                    {cardButton}
                  </SwipeableNoteCard>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Bulk Selection Action Bar (fixed above BottomNav) */}
      {selectionMode && selectedNoteIds.size > 0 && (
        <div className="fixed bottom-[68px] inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 px-4 py-2.5 shadow-lg">
          <div className="max-w-3xl mx-auto flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleBulkCopy}
              className="min-h-[52px] flex-1 rounded-2xl bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
            >
              {copiedSelected ? (
                <>
                  <Check className="w-5 h-5" />
                  <span>تم النسخ</span>
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5" />
                  <span>نسخ المحدد</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="min-h-[52px] flex-1 rounded-2xl bg-red-500/15 text-red-600 dark:text-red-400 font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
            >
              <Trash2 className="w-5 h-5" />
              <span>حذف المحدد ({selectedNoteIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Undo Swipe / Bulk Delete Toast */}
      {undoNotes && undoNotes.length > 0 && (
        <div className="fixed bottom-20 inset-x-4 z-40 flex justify-center pointer-events-none">
          <div className="pointer-events-auto bg-slate-900 dark:bg-slate-800 text-white rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-4 border border-slate-700">
            <span className="text-sm font-bold">
              {undoNotes.length === 1
                ? 'تم حذف الملاحظة'
                : `تم حذف ${undoNotes.length} ملاحظات`}
            </span>
            <button
              type="button"
              onClick={handleUndoDelete}
              className="min-h-[40px] px-3 rounded-xl bg-emerald-500 text-white text-xs font-extrabold flex items-center gap-1 active:scale-95 transition"
            >
              <Undo2 className="w-4 h-4" />
              <span>تراجع</span>
            </button>
          </div>
        </div>
      )}

      {/* Full Note Editor View */}
      {activeNote && (
        <NoteEditorView
          note={activeNote}
          includeTotalInWhatsApp={Boolean(settings.includeTotalInWhatsApp)}
          defaultNoteNumbering={Boolean(settings.defaultNoteNumbering)}
          defaultNoteQuantities={settings.defaultNoteQuantities !== false}
          autoTakeNoteNumber={Boolean(settings.autoTakeNoteNumber)}
          noteUnitMode={settings.noteUnitMode === 'fixed' ? 'fixed' : 'per-product'}
          noteDefaultUnit={settings.noteDefaultUnit || 'none'}
          noteCopySortOrder={settings.noteCopySortOrder || 'as-written'}
          noteCopyDigitStyle={settings.noteCopyDigitStyle || 'western'}
          noteCopyIncludeTotalQuantities={Boolean(
            settings.noteCopyIncludeTotalQuantities
          )}
          onToggleIncludeTotalInWhatsApp={(next) => {
            onUpdateSettings({ includeTotalInWhatsApp: next }).catch(() => {});
          }}
          onUpdateNoteSettings={(partial) => {
            onUpdateSettings(partial).catch(() => {});
          }}
          onChangeNote={async (updated) => {
            await saveNote(updated);
            await loadNotesData();
          }}
          onKeyboardOpenChange={onKeyboardOpenChange}
          onClose={() => {
            onKeyboardOpenChange?.(false);
            setActiveNoteId(null);
          }}
        />
      )}
    </div>
  );
};
