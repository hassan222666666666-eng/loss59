import {
  KnownProduct,
  MatchProductResponse,
  MatchShelfResponse,
  Shelf,
} from '../../types';

function tokenizeDescription(desc: string): Set<string> {
  return new Set(
    desc
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}

export function descriptionSimilarity(descA: string, descB: string): number {
  const a = tokenizeDescription(descA);
  const b = tokenizeDescription(descB);
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Selects up to 6 saved products whose visual productDescription is most similar
 * to the newly detected item's description.
 */
export function rankCandidateProductsByDescription(
  newDescription: string,
  savedProducts: KnownProduct[],
  maxCandidates: number = 6
): KnownProduct[] {
  const withThumbs = savedProducts.filter((p) => Boolean(p.thumbnailDataUrl));
  if (withThumbs.length <= maxCandidates) {
    return withThumbs;
  }

  return [...withThumbs]
    .map((product) => ({
      product,
      score: descriptionSimilarity(
        newDescription,
        product.productDescription || ''
      ),
    }))
    .sort((a, b) => b.score - a.score || b.product.updatedAt - a.product.updatedAt)
    .slice(0, maxCandidates)
    .map((entry) => entry.product);
}

/**
 * Sends the new crop + up to 6 candidate saved crops to /api/match-product
 * so Gemini visually decides if it matches one of the saved products.
 */
export async function matchProductWithGemini(
  newCropDataUrl: string,
  newDescription: string,
  savedProducts: KnownProduct[]
): Promise<KnownProduct | null> {
  const candidates = rankCandidateProductsByDescription(
    newDescription,
    savedProducts,
    6
  );
  if (candidates.length === 0) return null;

  try {
    const res = await fetch('/api/match-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newCropDataUrl,
        candidates: candidates.map((c) => ({
          productId: c.id,
          cropDataUrl: c.thumbnailDataUrl,
        })),
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as MatchProductResponse;
    if (
      typeof data.matchIndex === 'number' &&
      data.matchIndex >= 0 &&
      data.matchIndex < candidates.length
    ) {
      return candidates[data.matchIndex];
    }
    if (data.matchedProductId) {
      return candidates.find((c) => c.id === data.matchedProductId) || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compares a new shelf photo with up to 6 existing shelves to assign it to the matching shelf.
 */
export async function matchShelfWithGemini(
  photoDataUrl: string,
  existingShelves: Shelf[]
): Promise<Shelf | null> {
  const candidates = existingShelves
    .filter((s) => Boolean(s.thumbnailDataUrl))
    .slice(0, 6);
  if (candidates.length === 0) return null;

  try {
    const res = await fetch('/api/match-shelf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photoDataUrl,
        shelves: candidates.map((s) => ({
          shelfId: s.id,
          imageDataUrl: s.thumbnailDataUrl,
        })),
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as MatchShelfResponse;
    if (
      typeof data.matchIndex === 'number' &&
      data.matchIndex >= 0 &&
      data.matchIndex < candidates.length
    ) {
      return candidates[data.matchIndex];
    }
    if (data.matchedShelfId) {
      return candidates.find((s) => s.id === data.matchedShelfId) || null;
    }
    return null;
  } catch {
    return null;
  }
}
