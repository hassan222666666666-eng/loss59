import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuideModal(true);
  };

  if (variant === 'compact') {
    if (!isInstallable && !isIOS) {
      return null;
    }

    return (
      <>
        <button
          type="button"
          onClick={handleAction}
          className="min-h-[44px] px-3 rounded-2xl bg-emerald-500 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition shrink-0"
          aria-label="تثبيت التطبيق"
        >
          <Download className="w-4 h-4" />
          <span>تثبيت</span>
        </button>

        {showGuideModal && (
          <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuideModal(false)} />
        )}
      </>
    );
  }

  return (
    <>
      <section className="bg-white dark:bg-slate-900 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-slate-900 dark:text-white">
              تثبيت التطبيق على الهاتف
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {isIOS
                ? 'اضغط زر المشاركة في المتصفح ثم «إضافة إلى الشاشة الرئيسية» للعمل بدون إنترنت'
                : 'تثبيت كتطبيق مستقل يفتح فوراً ويعمل بدون إنترنت'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAction}
          className="min-h-[48px] px-4 rounded-2xl bg-emerald-500 text-white font-bold text-sm shrink-0 inline-flex items-center gap-1.5 active:scale-95 transition"
        >
          {isInstallable ? (
            <>
              <Download className="w-4 h-4" />
              <span>تثبيت</span>
            </>
          ) : (
            <span>طريقة التثبيت</span>
          )}
        </button>
      </section>

      {showGuideModal && (
        <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuideModal(false)} />
      )}
    </>
  );
};

const InstallGuideModal: React.FC<{ isIOS: boolean; onClose: () => void }> = ({
  isIOS,
  onClose,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    dir="rtl"
    role="dialog"
    aria-modal="true"
    aria-label="طريقة تثبيت التطبيق"
  >
    <div className="w-full max-w-sm rounded-[24px] bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
          تثبيت التطبيق للعمل بدون إنترنت
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center"
          aria-label="إغلاق"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isIOS ? (
        <ol className="space-y-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <li className="flex items-start gap-2">
            <span className="font-extrabold text-emerald-600">1.</span>
            <span>
              اضغط زر <strong>المشاركة</strong>{' '}
              <Share className="inline w-4 h-4 text-emerald-600" /> في شريط Safari.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-extrabold text-emerald-600">2.</span>
            <span>
              اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-extrabold text-emerald-600">3.</span>
            <span>افتح التطبيق من الشاشة الرئيسية وسيعمل محلياً بدون إنترنت.</span>
          </li>
        </ol>
      ) : (
        <ol className="space-y-2.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <li className="flex items-start gap-2">
            <span className="font-extrabold text-emerald-600">1.</span>
            <span>افتح قائمة المتصفح (⋮ في الأعلى).</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-extrabold text-emerald-600">2.</span>
            <span>
              اختر <strong>تثبيت التطبيق</strong> أو{' '}
              <strong>الإضافة إلى الشاشة الرئيسية</strong>.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-extrabold text-emerald-600">3.</span>
            <span>بعد التثبيت يمكنك فتح التطبيق واستخدامه بالكامل بدون إنترنت.</span>
          </li>
        </ol>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full min-h-[48px] rounded-2xl bg-emerald-500 text-white font-extrabold text-sm active:scale-95 transition"
      >
        حسناً
      </button>
    </div>
  </div>
);
