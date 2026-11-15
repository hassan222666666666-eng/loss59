import React from 'react';
import { Camera, ClipboardList, StickyNote, Settings } from 'lucide-react';

export type TabKey = 'capture' | 'log' | 'notes' | 'settings';

interface BottomNavProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

const NAV_ITEMS: Array<{
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'capture', label: 'التصوير', icon: Camera },
  { key: 'log', label: 'السجل', icon: ClipboardList },
  { key: 'notes', label: 'الملاحظات', icon: StickyNote },
  { key: 'settings', label: 'الإعدادات', icon: Settings },
];

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
}) => {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 pb-safe shadow-[0_-4px_16px_rgba(0,0,0,0.04)]"
      dir="rtl"
      role="navigation"
      aria-label="شريط التنقل السفلي"
    >
      <div className="max-w-lg mx-auto grid grid-cols-4 h-[68px] px-2">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTabChange(key)}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              className={`min-h-[52px] h-full flex flex-col items-center justify-center gap-1 transition-colors relative ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-extrabold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-semibold'
              }`}
            >
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-emerald-500 rounded-full" />
              )}
              <Icon
                className={`w-6 h-6 transition-transform duration-150 ${
                  isActive ? 'scale-105 stroke-[2.4]' : 'stroke-[1.9]'
                }`}
              />
              <span className="text-[11px] leading-none whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
