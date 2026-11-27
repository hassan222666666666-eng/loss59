import {
  NoteDefaultUnit,
  NoteQuantityUnit,
  NoteUnitMode,
} from '../../types';
import { normalizeNoteLineWords } from './duplicateDetector';

export const PRODUCT_UNIT_MEMORY_STORAGE_KEY = 'naqs_note_product_units_v1';

const VALID_UNITS = new Set<NoteQuantityUnit>([
  'carton',
  'box',
  'piece',
  'kg',
  'gram',
]);

export interface SimpleStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

function getDefaultStorage(): SimpleStorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export function isValidNoteQuantityUnit(
  value: unknown
): value is NoteQuantityUnit {
  return typeof value === 'string' && VALID_UNITS.has(value as NoteQuantityUnit);
}

/**
 * Normalizes a product line name using the exact same word normalization
 * rules as duplicate detection (ignoring any trailing quantity numbers).
 */
export function normalizeProductNameForUnitMemory(rawName: string): string {
  const words = normalizeNoteLineWords(rawName, {
    ignoreTrailingQuantity: true,
  });
  return words.join(' ');
}

export function loadProductUnitMemory(
  storage: SimpleStorageLike | null = getDefaultStorage()
): Record<string, NoteQuantityUnit> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PRODUCT_UNIT_MEMORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const clean: Record<string, NoteQuantityUnit> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k && isValidNoteQuantityUnit(v)) {
        clean[k] = v;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveProductUnitMemory(
  memory: Record<string, NoteQuantityUnit>,
  storage: SimpleStorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(PRODUCT_UNIT_MEMORY_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Ignore quota/storage errors
  }
}

export function getRememberedUnitForProduct(
  productName: string,
  memory: Record<string, NoteQuantityUnit>
): NoteQuantityUnit | undefined {
  const key = normalizeProductNameForUnitMemory(productName);
  if (!key) return undefined;
  const val = memory[key];
  return isValidNoteQuantityUnit(val) ? val : undefined;
}

export function rememberUnitForProduct(
  productName: string,
  unit: NoteQuantityUnit,
  storage: SimpleStorageLike | null = getDefaultStorage()
): Record<string, NoteQuantityUnit> {
  const current = loadProductUnitMemory(storage);
  const key = normalizeProductNameForUnitMemory(productName);
  if (!key || !isValidNoteQuantityUnit(unit)) return current;
  const next = { ...current, [key]: unit };
  saveProductUnitMemory(next, storage);
  return next;
}

export function forgetUnitForProduct(
  productName: string,
  storage: SimpleStorageLike | null = getDefaultStorage()
): Record<string, NoteQuantityUnit> {
  const current = loadProductUnitMemory(storage);
  const key = normalizeProductNameForUnitMemory(productName);
  if (!key || !(key in current)) return current;
  const next = { ...current };
  delete next[key];
  saveProductUnitMemory(next, storage);
  return next;
}

export function clearProductUnitMemory(
  storage: SimpleStorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    if (typeof storage.removeItem === 'function') {
      storage.removeItem(PRODUCT_UNIT_MEMORY_STORAGE_KEY);
    } else {
      storage.setItem(PRODUCT_UNIT_MEMORY_STORAGE_KEY, '{}');
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Resolves the unit for a newly set quantity in strict order:
 * 1) explicit unit typed in the line (if any)
 * 2) remembered unit for normalized product name (only when unitMode is 'per-product')
 * 3) default unit setting (if not 'none')
 * 4) undefined (no unit)
 */
export function resolveQuantityUnit(params: {
  explicitUnit?: NoteQuantityUnit;
  productName: string;
  unitMode?: NoteUnitMode;
  defaultUnit?: NoteDefaultUnit;
  memory?: Record<string, NoteQuantityUnit>;
}): NoteQuantityUnit | undefined {
  const {
    explicitUnit,
    productName,
    unitMode = 'per-product',
    defaultUnit = 'none',
    memory = {},
  } = params;

  if (isValidNoteQuantityUnit(explicitUnit)) {
    return explicitUnit;
  }

  if (unitMode !== 'fixed') {
    const remembered = getRememberedUnitForProduct(productName, memory);
    if (remembered) {
      return remembered;
    }
  }

  if (defaultUnit && defaultUnit !== 'none' && isValidNoteQuantityUnit(defaultUnit)) {
    return defaultUnit;
  }

  return undefined;
}
