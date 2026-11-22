import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileAudio2,
  FolderPlus,
  Plus,
  X,
} from 'lucide-react';
import { isSupportedAudioFile } from './musicLogic';
import { MusicImportProgress, MusicImportReport } from './types';

export function supportsDirectorySelection(): boolean {
  if (typeof document === 'undefined') return false;
  const input = document.createElement('input');
  return 'webkitdirectory' in input || 'directory' in input;
}

interface MusicAudioImporterTriggerProps {
  variant: 'header-plus' | 'empty-primary' | 'settings-button';
  buttonText?: string;
  disabled?: boolean;
  onSelectFiles: (files: File[]) => void | Promise<unknown>;
  showSavedNote?: boolean;
}

export const MusicAudioImporterTrigger: React.FC<
  MusicAudioImporterTriggerProps
> = ({
  variant,
  buttonText,
  disabled = false,
  onSelectFiles,
  showSavedNote = true,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const canPickFolder = useMemo(() => supportsDirectorySelection(), []);

  useEffect(() => {
    const el = folderInputRef.current;
    if (!el || !canPickFolder) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, [canPickFolder]);

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    e.target.value = '';
    setMenuOpen(false);
    void onSelectFiles(files);
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const audioOnly = Array.from(list).filter((f) => isSupportedAudioFile(f));
    e.target.value = '';
    setMenuOpen(false);
    void onSelectFiles(audioOnly);
  };

  const renderInputs = (
    <>
      <input
        ref={fileInputRef}
        data-testid={`music-file-input-${variant}`}
        type="file"
        accept="audio/*,.mp3,.m4a,.mp4,.aac,.ogg,.opus,.wav,.flac,.webm,video/mp4,video/webm"
        multiple
        onChange={handleFilesChange}
        className="hidden"
      />
      {canPickFolder && (
        <input
          ref={folderInputRef}
          data-testid={`music-folder-input-${variant}`}
          type="file"
          multiple
          onChange={handleFolderChange}
          className="hidden"
        />
      )}
    </>
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const renderMenu = menuOpen && (
    <>
      <div
        data-no-sheet-drag="true"
        className="fixed inset-0 z-30"
        onPointerDown={(e) => {
          e.stopPropagation();
          setMenuOpen(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(false);
        }}
      />
      <div
        data-no-sheet-drag="true"
        data-testid={`music-add-menu-${variant}`}
        className={`absolute z-40 w-64 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-2 space-y-1.5 text-right ${
          variant === 'header-plus' ? 'left-0 top-12' : 'inset-x-0 top-full mt-2 mx-auto'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            fileInputRef.current?.click();
          }}
          className="w-full min-h-[44px] px-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-extrabold text-xs flex items-center gap-2.5"
        >
          <FileAudio2 className="w-4 h-4 shrink-0" />
          <span>اختيار ملفات</span>
        </button>

        {canPickFolder ? (
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              folderInputRef.current?.click();
            }}
            className="w-full min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-extrabold text-xs flex items-center gap-2.5"
          >
            <FolderPlus className="w-4 h-4 shrink-0 text-emerald-500" />
            <span>اختيار مجلد كامل</span>
          </button>
        ) : (
          <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] font-bold text-amber-800 dark:text-amber-200 leading-relaxed">
            في نافذة الاختيار اضغط مطولاً على ملف ثم «تحديد الكل»
          </div>
        )}
      </div>
    </>
  );

  if (variant === 'header-plus') {
    return (
      <div className="relative">
        {renderInputs}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMenuOpen((v) => !v)}
          data-testid="music-header-add-btn"
          aria-label="إضافة ملفات صوتية"
          title="إضافة ملفات صوتية"
          className="min-w-[44px] min-h-[44px] px-3 rounded-2xl bg-emerald-500 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition disabled:opacity-60"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>إضافة</span>
        </button>
        {renderMenu}
      </div>
    );
  }

  return (
    <div className="relative space-y-1.5">
      {renderInputs}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setMenuOpen((v) => !v)}
        data-testid={
          variant === 'empty-primary'
            ? 'music-empty-add-btn'
            : 'music-settings-add-btn'
        }
        className={`w-full px-4 rounded-2xl bg-emerald-500 text-white font-extrabold flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60 shadow-sm ${
          variant === 'empty-primary' ? 'min-h-[54px] text-sm' : 'min-h-[48px] text-sm'
        }`}
      >
        <Plus className="w-5 h-5 shrink-0" />
        <span>
          {buttonText ||
            (variant === 'empty-primary'
              ? 'أضف أول ملفاتك الصوتية'
              : 'إضافة ملفات صوتية')}
        </span>
      </button>

      {showSavedNote && (
        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 text-center">
          الملفات محفوظة داخل التطبيق
        </div>
      )}

      {!canPickFolder && (
        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 text-center leading-relaxed">
          في نافذة الاختيار اضغط مطولاً على ملف ثم «تحديد الكل»
        </div>
      )}

      {renderMenu}
    </div>
  );
};

interface MusicImportStatusPanelProps {
  progress: MusicImportProgress | null;
  report: MusicImportReport | null;
  onCancelImport: () => void;
  onDismissReport: () => void;
}

export const MusicImportStatusPanel: React.FC<MusicImportStatusPanelProps> = ({
  progress,
  report,
  onCancelImport,
  onDismissReport,
}) => {
  if (!progress && !report) return null;

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.currentIndex / progress.total) * 100))
      : 0;

  return (
    <div className="space-y-2.5">
      {progress && (
        <div
          data-testid="music-import-progress"
          className="bg-white dark:bg-slate-900 rounded-2xl p-3.5 border border-emerald-200 dark:border-emerald-800 shadow-sm space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                جاري الحفظ: {progress.currentFileName}
              </div>
              <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                {progress.currentIndex} من {progress.total}
              </div>
            </div>
            <button
              type="button"
              onClick={onCancelImport}
              data-testid="music-import-cancel-btn"
              className="min-h-[36px] px-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-extrabold shrink-0"
            >
              إلغاء
            </button>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {report && !progress && (
        <div
          data-testid="music-import-report"
          className={`rounded-2xl p-3.5 border shadow-sm space-y-2 ${
            report.failedCount > 0
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
              : 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {report.failedCount > 0 ? (
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <span className="text-xs font-extrabold text-slate-900 dark:text-white tabular-nums">
                {report.cancelled ? `${report.summaryText} (أُلغي الباقي)` : report.summaryText}
              </span>
            </div>
            <button
              type="button"
              onClick={onDismissReport}
              aria-label="إغلاق التقرير"
              className="w-7 h-7 rounded-lg bg-black/5 dark:bg-white/10 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {report.failedFiles.length > 0 && (
            <ul className="space-y-1 text-[11px] font-bold text-amber-900 dark:text-amber-200 pr-5 list-disc">
              {report.failedFiles.map((item, idx) => (
                <li key={`${item.fileName}_${idx}`} className="break-words">
                  <span>{item.fileName}</span>: {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
