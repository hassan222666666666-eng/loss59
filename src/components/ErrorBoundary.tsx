import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error || ''),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-[100dvh] bg-[#F7F8FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-6"
          dir="rtl"
        >
          <div className="max-w-sm w-full rounded-[24px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 text-center space-y-4 shadow-lg">
            <h1 className="text-lg font-extrabold">تعذر عرض الواجهة</h1>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-relaxed">
              حدث خطأ غير متوقع أثناء تحميل التطبيق. اضغط لإعادة التحميل.
            </p>
            {this.state.errorMessage && (
              <div className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-xl p-2.5 break-words" dir="ltr">
                {this.state.errorMessage}
              </div>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[48px] w-full rounded-2xl bg-emerald-500 text-white font-extrabold text-sm active:scale-95 transition"
            >
              إعادة التحميل
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
