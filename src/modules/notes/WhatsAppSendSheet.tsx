import React, { useMemo, useState } from 'react';
import {
  Check,
  Pencil,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { WhatsAppRecipient } from '../../types';
import {
  DEFAULT_COUNTRY_CODE,
  buildWhatsAppUrl,
  deleteWhatsAppRecipient,
  formatPhoneForDisplay,
  getSavedWhatsAppRecipients,
  isValidWhatsAppPhone,
  markWhatsAppRecipientUsed,
  normalizePhoneNumberForWhatsApp,
  splitPhoneForEdit,
  upsertWhatsAppRecipient,
} from './whatsapp';

export const WhatsAppIcon: React.FC<{ className?: string }> = ({
  className = 'w-4 h-4',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.1c-.25.7-1.44 1.33-2 1.41-.53.08-1.2.11-1.94-.12-.45-.14-1.03-.34-1.77-.66-3.11-1.34-5.14-4.48-5.3-4.69-.15-.21-1.26-1.68-1.26-3.2 0-1.52.8-2.27 1.08-2.58.28-.31.61-.39.81-.39h.58c.19 0 .44-.07.69.53.25.61.85 2.09.92 2.24.08.15.13.33.03.53-.1.2-.15.33-.31.5-.15.17-.32.39-.46.52-.15.15-.31.31-.13.62.18.31.8 1.32 1.71 2.14 1.18 1.05 2.17 1.38 2.48 1.53.31.15.49.13.67-.08.18-.21.78-.91.99-1.22.21-.31.42-.26.7-.15.28.1 1.79.84 2.1.99.31.15.51.23.59.36.08.13.08.75-.17 1.45z" />
  </svg>
);

interface WhatsAppSendSheetProps {
  messageText: string;
  includeTotal: boolean;
  hasCalculatedTotal: boolean;
  onToggleIncludeTotal: (next: boolean) => void;
  onSent: () => void;
  onClose: () => void;
}

export const WhatsAppSendSheet: React.FC<WhatsAppSendSheetProps> = ({
  messageText,
  includeTotal,
  hasCalculatedTotal,
  onToggleIncludeTotal,
  onSent,
  onClose,
}) => {
  const [recipients, setRecipients] = useState<WhatsAppRecipient[]>(() =>
    getSavedWhatsAppRecipients()
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [countryCodeInput, setCountryCodeInput] = useState(DEFAULT_COUNTRY_CODE);
  const [phoneInput, setPhoneInput] = useState('');
  const [formError, setFormError] = useState('');

  const openAddForm = () => {
    setEditingId(null);
    setNameInput('');
    setCountryCodeInput(DEFAULT_COUNTRY_CODE);
    setPhoneInput('');
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (r: WhatsAppRecipient) => {
    const split = splitPhoneForEdit(r.phone);
    setEditingId(r.id);
    setNameInput(r.name);
    setCountryCodeInput(split.countryCode);
    setPhoneInput(split.localNumber);
    setFormError('');
    setShowForm(true);
  };

  const handleSaveRecipient = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setFormError('أدخل اسم الشخص');
      return;
    }
    const normalized = normalizePhoneNumberForWhatsApp(phoneInput, countryCodeInput);
    if (!isValidWhatsAppPhone(normalized)) {
      setFormError('أدخل رقم هاتف صحيح');
      return;
    }

    const updated = upsertWhatsAppRecipient({
      id: editingId || undefined,
      name: trimmedName,
      phoneDigits: normalized,
    });
    setRecipients(updated);
    setShowForm(false);
    setEditingId(null);
    setNameInput('');
    setPhoneInput('');
    setFormError('');
  };

  const handleDeleteRecipient = (id: string) => {
    const updated = deleteWhatsAppRecipient(id);
    setRecipients(updated);
    if (editingId === id) {
      setShowForm(false);
      setEditingId(null);
    }
  };

  const handleRecipientTapped = (recipient: WhatsAppRecipient) => {
    const updated = markWhatsAppRecipientUsed(recipient.id);
    setRecipients(updated);
    onSent();
    onClose();
  };

  const normalizedPreview = useMemo(() => {
    if (!phoneInput.trim()) return '';
    return normalizePhoneNumberForWhatsApp(phoneInput, countryCodeInput);
  }, [phoneInput, countryCodeInput]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      dir="rtl"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[86dvh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

        <div className="px-4 pt-2 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <WhatsAppIcon className="w-5 h-5" />
            </span>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              أشخاص محفوظون
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#F7F8FA] dark:bg-slate-800 text-slate-500 flex items-center justify-center"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Optional Total Setting Quick Toggle */}
          {hasCalculatedTotal && (
            <button
              type="button"
              onClick={() => onToggleIncludeTotal(!includeTotal)}
              className="w-full min-h-[48px] px-3.5 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3 text-right active:scale-[0.99] transition"
            >
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                إضافة المجموع للرسالة
              </span>
              <span
                className={`w-6 h-6 rounded-lg flex items-center justify-center transition ${
                  includeTotal
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-transparent'
                }`}
              >
                <Check className="w-4 h-4" />
              </span>
            </button>
          )}

          {/* Saved Recipients List (most recently used first, last used highlighted) */}
          {recipients.length > 0 && (
            <div className="space-y-2">
              {recipients.map((recipient, idx) => {
                const isLastUsed = idx === 0 && Boolean(recipient.lastUsedAt);
                const waHref = buildWhatsAppUrl(messageText, recipient.phone);

                return (
                  <div
                    key={recipient.id}
                    className={`rounded-2xl border flex items-center gap-1.5 pr-1 pl-2 min-h-[60px] transition ${
                      isLastUsed
                        ? 'bg-emerald-50/75 dark:bg-emerald-950/35 border-emerald-400/80 dark:border-emerald-700'
                        : 'bg-[#F7F8FA] dark:bg-slate-800/70 border-slate-200/80 dark:border-slate-800'
                    }`}
                  >
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleRecipientTapped(recipient)}
                      className="flex-1 min-w-0 py-2.5 px-3 flex items-center justify-between gap-2 text-right"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                          {recipient.name}
                        </div>
                        <div
                          className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums"
                          dir="ltr"
                        >
                          {formatPhoneForDisplay(recipient.phone)}
                        </div>
                      </div>
                      {isLastUsed && (
                        <span className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 shrink-0">
                          آخر إرسال
                        </span>
                      )}
                    </a>

                    <button
                      type="button"
                      onClick={() => openEditForm(recipient)}
                      className="min-w-[44px] min-h-[44px] rounded-xl text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 flex items-center justify-center shrink-0"
                      aria-label={`تعديل ${recipient.name}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteRecipient(recipient.id)}
                      className="min-w-[44px] min-h-[44px] rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center shrink-0"
                      aria-label={`حذف ${recipient.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add / Edit Person Inline Form */}
          {showForm ? (
            <form
              onSubmit={handleSaveRecipient}
              className="rounded-2xl bg-[#F7F8FA] dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-3.5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                  {editingId ? 'تعديل جهة الاتصال' : 'إضافة شخص'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setFormError('');
                  }}
                  className="min-w-[36px] min-h-[36px] rounded-lg text-slate-400 flex items-center justify-center"
                  aria-label="إلغاء النموذج"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <input
                type="text"
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  if (formError) setFormError('');
                }}
                placeholder="الاسم (مثال: أبو محمد)"
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />

              <div className="flex items-center gap-2" dir="ltr">
                <input
                  type="tel"
                  value={countryCodeInput}
                  onChange={(e) => setCountryCodeInput(e.target.value)}
                  aria-label="رمز الدولة"
                  className="w-20 min-h-[46px] px-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-extrabold text-center text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 tabular-nums shrink-0"
                />
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => {
                    setPhoneInput(e.target.value);
                    if (formError) setFormError('');
                  }}
                  placeholder="0770 123 4567"
                  aria-label="رقم الهاتف"
                  className="flex-1 min-w-0 min-h-[46px] px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 tabular-nums"
                />
              </div>

              {normalizedPreview && (
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>سيُحفظ الرقم بصيغة واتساب:</span>
                  <span dir="ltr" className="tabular-nums font-bold">
                    +{normalizedPreview}
                  </span>
                </div>
              )}

              {formError && (
                <div className="text-xs font-bold text-red-600 dark:text-red-400">
                  {formError}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setFormError('');
                  }}
                  className="min-h-[46px] px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 min-h-[46px] rounded-xl bg-emerald-500 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 active:scale-95 transition"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingId ? 'حفظ التعديل' : 'حفظ الشخص'}</span>
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={openAddForm}
              className="w-full min-h-[50px] px-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-[#F7F8FA]/60 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200 text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition"
            >
              <UserPlus className="w-4 h-4 text-emerald-500" />
              <span>إضافة شخص</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
