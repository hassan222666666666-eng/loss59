export interface TrackTileColorOption {
  id: string;
  label: string;
  bgHex: string;
  gradientCss: string;
}

export const TRACK_TILE_COLORS: readonly TrackTileColorOption[] = [
  {
    id: 'emerald',
    label: 'أخضر',
    bgHex: '#059669',
    gradientCss: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
  },
  {
    id: 'cobalt',
    label: 'أزرق',
    bgHex: '#2563EB',
    gradientCss: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
  },
  {
    id: 'violet',
    label: 'بنفسجي',
    bgHex: '#7C3AED',
    gradientCss: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  },
  {
    id: 'rose',
    label: 'وردي',
    bgHex: '#DB2777',
    gradientCss: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
  },
  {
    id: 'amber',
    label: 'عنبر',
    bgHex: '#D97706',
    gradientCss: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
  },
  {
    id: 'teal',
    label: 'تركواز',
    bgHex: '#0D9488',
    gradientCss: 'linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)',
  },
  {
    id: 'crimson',
    label: 'أحمر',
    bgHex: '#DC2626',
    gradientCss: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
  },
  {
    id: 'indigo',
    label: 'نيلي',
    bgHex: '#4F46E5',
    gradientCss: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
  },
] as const;

export function hashTitleToColorIndex(title: string): number {
  const s = (title || '').trim();
  if (!s) return 0;
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % TRACK_TILE_COLORS.length;
}

export function resolveTrackTileColor(
  title: string,
  explicitColorId?: string | null
): TrackTileColorOption {
  if (explicitColorId) {
    const found = TRACK_TILE_COLORS.find((c) => c.id === explicitColorId);
    if (found) return found;
  }
  return TRACK_TILE_COLORS[hashTitleToColorIndex(title)];
}

export function getTrackInitialLetter(title: string): string {
  const trimmed = (title || '').trim();
  if (!trimmed) return '♪';
  const letterMatch = trimmed.match(/\p{L}/u);
  if (letterMatch && letterMatch[0]) {
    return letterMatch[0].toUpperCase();
  }
  const digitMatch = trimmed.match(/\p{N}/u);
  if (digitMatch && digitMatch[0]) {
    return digitMatch[0];
  }
  return '♪';
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readSynchsafeInt(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUInt24BE(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.length) return 0;
  return ((bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2]) >>> 0;
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  const limit = Math.min(end, bytes.length);
  for (let i = start; i < limit; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function detectImageMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function skipTextTerminator(
  bytes: Uint8Array,
  offset: number,
  end: number,
  encoding: number
): number {
  // encoding 1 (UTF-16 with BOM) and 2 (UTF-16BE) use double-zero termination
  const isUtf16 = encoding === 1 || encoding === 2;
  if (isUtf16) {
    let i = offset;
    while (i + 1 < end) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        return i + 2;
      }
      i += 2;
    }
    return end;
  }
  let i = offset;
  while (i < end) {
    if (bytes[i] === 0) return i + 1;
    i += 1;
  }
  return end;
}

export interface EmbeddedCoverResult {
  bytes: Uint8Array;
  mimeType: string;
}

function extractId3ApicCover(bytes: Uint8Array): EmbeddedCoverResult | null {
  if (bytes.length < 10) return null;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // "ID3"

  const majorVersion = bytes[3];
  if (majorVersion < 2 || majorVersion > 4) return null;

  const flags = bytes[5];
  const tagBodySize = readSynchsafeInt(bytes, 6);
  const tagEnd = Math.min(bytes.length, 10 + tagBodySize);
  let cursor = 10;

  // Extended header in v2.3 / v2.4
  if (majorVersion >= 3 && (flags & 0x40) !== 0 && cursor + 4 <= tagEnd) {
    const extSize =
      majorVersion === 4
        ? readSynchsafeInt(bytes, cursor)
        : readUInt32BE(bytes, cursor) + 4;
    cursor += Math.max(4, extSize);
  }

  while (cursor < tagEnd) {
    if (majorVersion === 2) {
      if (cursor + 6 > tagEnd) break;
      const frameId = readAscii(bytes, cursor, cursor + 3);
      if (frameId === '\0\0\0') break;
      const frameSize = readUInt24BE(bytes, cursor + 3);
      cursor += 6;
      const frameEnd = Math.min(tagEnd, cursor + frameSize);
      if (frameId === 'PIC' && frameSize > 6) {
        const encoding = bytes[cursor];
        const imgFormat = readAscii(bytes, cursor + 1, cursor + 4).toUpperCase();
        // cursor+4 is picture type; cursor+5 starts description
        const imgStart = skipTextTerminator(bytes, cursor + 5, frameEnd, encoding);
        if (imgStart < frameEnd) {
          const slice = bytes.slice(imgStart, frameEnd);
          const detected =
            detectImageMimeFromBytes(slice) ||
            (imgFormat === 'PNG' ? 'image/png' : 'image/jpeg');
          if (slice.length > 16) return { bytes: slice, mimeType: detected };
        }
      }
      cursor = frameEnd;
    } else {
      if (cursor + 10 > tagEnd) break;
      const frameId = readAscii(bytes, cursor, cursor + 4);
      if (frameId === '\0\0\0\0') break;
      const frameSize =
        majorVersion === 4
          ? readSynchsafeInt(bytes, cursor + 4)
          : readUInt32BE(bytes, cursor + 4);
      cursor += 10;
      if (frameSize <= 0) break;
      const frameEnd = Math.min(tagEnd, cursor + frameSize);

      if (frameId === 'APIC' && frameSize > 4) {
        const encoding = bytes[cursor];
        let pos = cursor + 1;
        let mimeEnd = pos;
        while (mimeEnd < frameEnd && bytes[mimeEnd] !== 0) mimeEnd++;
        const rawMime = readAscii(bytes, pos, mimeEnd).trim().toLowerCase();
        pos = Math.min(frameEnd, mimeEnd + 1); // skip null
        pos = Math.min(frameEnd, pos + 1); // skip picture type byte
        const imgStart = skipTextTerminator(bytes, pos, frameEnd, encoding);
        if (imgStart < frameEnd) {
          const slice = bytes.slice(imgStart, frameEnd);
          const detected =
            detectImageMimeFromBytes(slice) ||
            (rawMime.startsWith('image/') ? rawMime : 'image/jpeg');
          if (slice.length > 16) return { bytes: slice, mimeType: detected };
        }
      }
      cursor = frameEnd;
    }
  }

  return null;
}

function findMp4Atom(
  bytes: Uint8Array,
  start: number,
  end: number,
  targetName: string
): { contentStart: number; atomEnd: number } | null {
  let pos = start;
  while (pos + 8 <= end) {
    let size = readUInt32BE(bytes, pos);
    const name = readAscii(bytes, pos + 4, pos + 8);
    let headerSize = 8;

    if (size === 1 && pos + 16 <= end) {
      const high = readUInt32BE(bytes, pos + 8);
      const low = readUInt32BE(bytes, pos + 12);
      size = high * 0x100000000 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }

    if (size < headerSize || pos + size > end) break;
    const atomEnd = pos + size;
    if (name === targetName) {
      return { contentStart: pos + headerSize, atomEnd };
    }
    pos = atomEnd;
  }
  return null;
}

function extractMp4CovrCover(bytes: Uint8Array): EmbeddedCoverResult | null {
  if (bytes.length < 16) return null;
  const ftyp = findMp4Atom(bytes, 0, bytes.length, 'ftyp');
  const moov = findMp4Atom(bytes, 0, bytes.length, 'moov');
  if (!moov && !ftyp) return null;
  if (!moov) return null;

  const udta = findMp4Atom(bytes, moov.contentStart, moov.atomEnd, 'udta');
  if (!udta) return null;

  const meta = findMp4Atom(bytes, udta.contentStart, udta.atomEnd, 'meta');
  if (!meta) return null;

  // 'meta' is a FullBox (4 bytes version + flags) followed by child atoms,
  // though some encoders omit flags; probe +4 first, then +0.
  const metaStart =
    meta.contentStart + 4 < meta.atomEnd &&
    (findMp4Atom(bytes, meta.contentStart + 4, meta.atomEnd, 'ilst') ||
      findMp4Atom(bytes, meta.contentStart + 4, meta.atomEnd, 'hdlr'))
      ? meta.contentStart + 4
      : meta.contentStart;

  const ilst = findMp4Atom(bytes, metaStart, meta.atomEnd, 'ilst');
  if (!ilst) return null;

  const covr = findMp4Atom(bytes, ilst.contentStart, ilst.atomEnd, 'covr');
  if (!covr) return null;

  const dataAtom = findMp4Atom(bytes, covr.contentStart, covr.atomEnd, 'data');
  if (!dataAtom || dataAtom.contentStart + 8 >= dataAtom.atomEnd) return null;

  // 'data' payload starts with 4-byte type indicator + 4-byte locale, then raw image bytes
  const typeIndicator = readUInt32BE(bytes, dataAtom.contentStart) & 0x00ffffff;
  const imgBytes = bytes.slice(dataAtom.contentStart + 8, dataAtom.atomEnd);
  if (imgBytes.length <= 16) return null;

  const mimeType =
    detectImageMimeFromBytes(imgBytes) ||
    (typeIndicator === 14 ? 'image/png' : 'image/jpeg');

  return { bytes: imgBytes, mimeType };
}

export function extractEmbeddedCoverArtBytes(
  data: ArrayBuffer | Uint8Array
): EmbeddedCoverResult | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 16) return null;

  const id3 = extractId3ApicCover(bytes);
  if (id3) return id3;

  return extractMp4CovrCover(bytes);
}

export async function compressCoverBlobToDataUrl(
  blob: Blob,
  maxSize: number = 160
): Promise<string | undefined> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return undefined;
  }

  let objectUrl = '';
  try {
    objectUrl = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = objectUrl;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return undefined;

    const scale = Math.min(1, maxSize / Math.max(w, h));
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return undefined;
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore
      }
    }
  }
}
