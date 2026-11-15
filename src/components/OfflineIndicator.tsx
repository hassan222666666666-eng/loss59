import React, { useEffect, useState } from 'react';
import { WifiOff, X } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isOnline) {
      setDismissed(false);
    }
  }, [isOnline]);

  if (isOnline || dismissed) return null;

  return (
    <div
      className="fixed bottom-[76px] left-3 right-3 z-30 flex justify-center pointer-events-none"
      dir="rtl"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-slate-900/95 dark:bg-slate-800/95 text-white px-3.5 py-2 text-xs font-bold shadow-lg border border-amber-500/40 max-w-md">
        <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
        <span>وضع عدم الاتصال — يعمل التطبيق بالبيانات المحلية</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="w-6 h-6 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0 transition"
          aria-label="إخفاء إشعار عدم الاتصال"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
