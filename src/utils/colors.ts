export interface ShortageColor {
  hex: string;
  bgSoft: string;
  text: string;
  border: string;
}

export const SHORTAGE_COLORS: ShortageColor[] = [
  { hex: '#10B981', bgSoft: 'rgba(16, 185, 129, 0.14)', text: '#059669', border: '#10B981' },
  { hex: '#3B82F6', bgSoft: 'rgba(59, 130, 246, 0.14)', text: '#2563EB', border: '#3B82F6' },
  { hex: '#F59E0B', bgSoft: 'rgba(245, 158, 11, 0.14)', text: '#D97706', border: '#F59E0B' },
  { hex: '#EF4444', bgSoft: 'rgba(239, 68, 68, 0.14)', text: '#DC2626', border: '#EF4444' },
  { hex: '#8B5CF6', bgSoft: 'rgba(139, 92, 246, 0.14)', text: '#7C3AED', border: '#8B5CF6' },
  { hex: '#06B6D4', bgSoft: 'rgba(6, 182, 212, 0.14)', text: '#0891B2', border: '#06B6D4' },
  { hex: '#F97316', bgSoft: 'rgba(249, 115, 22, 0.14)', text: '#EA580C', border: '#F97316' },
  { hex: '#EC4899', bgSoft: 'rgba(236, 72, 153, 0.14)', text: '#DB2777', border: '#EC4899' },
  { hex: '#14B8A6', bgSoft: 'rgba(20, 184, 166, 0.14)', text: '#0D9488', border: '#14B8A6' },
  { hex: '#6366F1', bgSoft: 'rgba(99, 102, 241, 0.14)', text: '#4F46E5', border: '#6366F1' },
];

export function getShortageColor(colorIndex: number): ShortageColor {
  const idx = ((colorIndex % SHORTAGE_COLORS.length) + SHORTAGE_COLORS.length) % SHORTAGE_COLORS.length;
  return SHORTAGE_COLORS[idx];
}
