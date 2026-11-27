import React, { useEffect, useState } from 'react';
import { Package, Settings2, X } from 'lucide-react';
import {
  AppSettings,
  NoteCopyDigitStyle,
  NoteCopySortOrder,
  NoteDefaultUnit,
  NoteUnitMode,
} from '../../types';
import { NOTE_QUANTITY_UNIT_OPTIONS } from './quantityLogic';
import { clearProductUnitMemory, loadProductUnitMemory } from './unitMemory';

export interface NoteSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  noteCopySortOrder?: NoteCopySortOrder;
  noteCopyDigitStyle?: NoteCopyDigitStyle;
  noteCopyIncludeTotalQuantities?: boolean;
  includeTotalInWhatsApp?: boolean;
  defaultNoteQuantities?: boolean;
  defaultNoteNumbering?: boolean;
  autoTakeNoteNumber?: boolean;
  noteUnitMode?: NoteUnitMode;
  noteDefaultUnit?: NoteDefaultUnit;
  onUpdateNoteSettings?: (partial: Partial<AppSettings>) => void;
  onUnitMemoryCleared?: () => void;
}

export const NoteSettingsSheet: React.FC<NoteSettingsSheetProps> = ({
  open,
  onClose,
  noteCopySortOrder = 'as-written',
  noteCopyDigitStyle = 'western',
  noteCopyIncludeTotalQuantities = false,
  includeTotalInWhatsApp = false,
  defaultNoteQuantities = true,
  defaultNoteNumbering = false,
  autoTakeNoteNumber = false,
  noteUnitMode = 'per-product',
  noteDefaultUnit = 'none',
  onUpdateNoteSettings,
  onUnitMemoryCleared,
}) => {
  const [unitMemoryCount, setUnitMemoryCount] = useState<number>(0);
  const [unitMemoryClearedNotice, setUnitMemoryClearedNotice] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUnitMemoryCount(Object.keys(loadProductUnitMemory()).length);
    setUnitMemoryClearedNotice(false);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="إعدادات الملاحظات"
      onClick={onClose}
    >
      <div
        data-testid="note-settings-sheet"
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-[24px] sm:rounded-[20px] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl border border-slate-200 dark:border-slate-800 space-y-3 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-emerald-500" />
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              إعدادات الملاحظات
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section 1: شكل النسخ والإرسال */}
        <div className="rounded-2xl bg-[#F7F8FA] dark:bg-slate-800/75 p-3 space-y-2.5 border border-slate-200/70 dark:border-slate-700/60">
          <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400">
            شكل النسخ والإرسال
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              ترتيب السطور
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onUpdateNoteSettings?.({ noteCopySortOrder: 'as-written' })
                }
                className={`min-h-[38px] rounded-xl text-xs font-extrabold border transition ${
                  noteCopySortOrder === 'as-written'
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                }`}
              >
                كما كتبتها
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateNoteSettings?.({ noteCopySortOrder: 'alphabetical' })
                }
                className={`min-h-[38px] rounded-xl text-xs font-extrabold border transition ${
                  noteCopySortOrder === 'alphabetical'
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                }`}
              >
                ترتيب أبجدي
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              شكل الأرقام
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onUpdateNoteSettings?.({ noteCopyDigitStyle: 'western' })
                }
                className={`min-h-[38px] rounded-xl text-xs font-extrabold border transition ${
                  noteCopyDigitStyle === 'western'
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                }`}
              >
                إنجليزية (123)
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateNoteSettings?.({ noteCopyDigitStyle: 'arabic' })
                }
                className={`min-h-[38px] rounded-xl text-xs font-extrabold border transition ${
                  noteCopyDigitStyle === 'arabic'
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                }`}
              >
                عربية (١٢٣)
              </button>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              إضافة إجمالي الأعداد في آخر سطر
            </span>
            <input
              type="checkbox"
              checked={noteCopyIncludeTotalQuantities}
              onChange={(e) =>
                onUpdateNoteSettings?.({
                  noteCopyIncludeTotalQuantities: e.target.checked,
                })
              }
              className="w-5 h-5 accent-emerald-500 rounded"
            />
          </label>

          <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              إضافة المجموع الحسابي في رسالة واتساب
            </span>
            <input
              type="checkbox"
              checked={includeTotalInWhatsApp}
              onChange={(e) =>
                onUpdateNoteSettings?.({
                  includeTotalInWhatsApp: e.target.checked,
                })
              }
              className="w-5 h-5 accent-emerald-500 rounded"
            />
          </label>
        </div>

        {/* Section 2: الكميات والوحدات */}
        <div
          data-testid="note-settings-quantities-panel"
          className="rounded-2xl bg-[#F7F8FA] dark:bg-slate-800/75 p-3 space-y-2.5 border border-slate-200/70 dark:border-slate-700/60"
        >
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
            <Package className="w-3.5 h-3.5" />
            <span>الكميات والوحدات</span>
          </div>

          <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              الكميات في الملاحظات الجديدة
            </span>
            <input
              type="checkbox"
              checked={defaultNoteQuantities}
              onChange={(e) =>
                onUpdateNoteSettings?.({
                  defaultNoteQuantities: e.target.checked,
                })
              }
              className="w-5 h-5 accent-emerald-500 rounded"
            />
          </label>

          <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              ترقيم الملاحظات الجديدة تلقائياً
            </span>
            <input
              type="checkbox"
              checked={defaultNoteNumbering}
              onChange={(e) =>
                onUpdateNoteSettings?.({
                  defaultNoteNumbering: e.target.checked,
                })
              }
              className="w-5 h-5 accent-emerald-500 rounded"
            />
          </label>

          <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
            <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
              أخذ الرقم تلقائياً
            </span>
            <input
              type="checkbox"
              data-testid="note-settings-auto-take-toggle"
              checked={autoTakeNoteNumber}
              onChange={(e) =>
                onUpdateNoteSettings?.({
                  autoTakeNoteNumber: e.target.checked,
                })
              }
              className="w-5 h-5 accent-emerald-500 rounded"
            />
          </label>

          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400">
              نوع العدد
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-testid="note-settings-unit-mode-per-product"
                onClick={() =>
                  onUpdateNoteSettings?.({ noteUnitMode: 'per-product' })
                }
                className={`min-h-[36px] rounded-xl text-xs font-extrabold transition ${
                  noteUnitMode !== 'fixed'
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                }`}
              >
                حسب المادة
              </button>
              <button
                type="button"
                data-testid="note-settings-unit-mode-fixed"
                onClick={() =>
                  onUpdateNoteSettings?.({ noteUnitMode: 'fixed' })
                }
                className={`min-h-[36px] rounded-xl text-xs font-extrabold transition ${
                  noteUnitMode === 'fixed'
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                }`}
              >
                ثابت
              </button>
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400">
              الوحدة الافتراضية
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'none', label: 'بدون' },
                  ...NOTE_QUANTITY_UNIT_OPTIONS,
                ] as Array<{ id: NoteDefaultUnit; label: string }>
              ).map((opt) => {
                const selected = noteDefaultUnit === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`note-settings-default-unit-${opt.id}`}
                    onClick={() =>
                      onUpdateNoteSettings?.({ noteDefaultUnit: opt.id })
                    }
                    className={`min-h-[34px] px-2 rounded-xl text-xs font-extrabold transition ${
                      selected
                        ? 'bg-emerald-500 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            data-testid="note-settings-clear-unit-memory"
            onClick={() => {
              clearProductUnitMemory();
              setUnitMemoryCount(0);
              setUnitMemoryClearedNotice(true);
              onUnitMemoryCleared?.();
              window.setTimeout(
                () => setUnitMemoryClearedNotice(false),
                2200
              );
            }}
            className="w-full min-h-[38px] px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-extrabold flex items-center justify-between gap-2 active:scale-[0.99] transition"
          >
            <span>
              {unitMemoryClearedNotice
                ? 'تم مسح ذاكرة الوحدات'
                : 'مسح ذاكرة الوحدات'}
            </span>
            <span className="text-[11px] font-bold text-slate-400 tabular-nums">
              {unitMemoryCount} مادة
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
