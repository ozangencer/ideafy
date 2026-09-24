// Normalize SQLite INTEGER boolean columns (stored as 0/1 or NULL) to JS
// values. Null/undefined stays null so callers can distinguish "no override"
// from "explicit false".
export function normalizeUseWorktree(
  value: number | boolean | null | undefined
): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

// Reverse direction: JS boolean|null → SQLite INTEGER|NULL. null stays null
// (clears the override); true → 1; false → 0.
export function serializeUseWorktreeForDb(
  value: boolean | null
): 0 | 1 | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

// ============================================================================
// Image extraction
// ============================================================================

export interface ExtractedImage {
  id: string;
  data: string;
  mimeType: string;
  fieldName: string;
  index: number;
}

export function extractImagesFromHtml(html: string, fieldName: string): {
  cleanedHtml: string;
  images: ExtractedImage[];
} {
  const images: ExtractedImage[] = [];
  let index = 0;

  const imgRegex = /<img[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*>/gi;

  const cleanedHtml = html.replace(imgRegex, (match, mimeType, data) => {
    const id = `${fieldName}_image_${index}`;
    images.push({ id, data, mimeType, fieldName, index });
    index++;
    return `[IMAGE: ${id}]`;
  });

  return { cleanedHtml, images };
}

// The Tiptap HTML fields that can carry pasted base64 images. Each is swapped
// for an [IMAGE: <field>_image_<n>] marker so the JSON stays small and the
// image travels as its own content block.
const IMAGE_FIELDS = ["description", "solutionSummary", "testScenarios", "aiOpinion"] as const;

type ImageField = (typeof IMAGE_FIELDS)[number];

export function extractCardImages<T extends Partial<Record<ImageField, string | null>>>(card: T): {
  cleanedCard: T;
  images: ExtractedImage[];
} {
  const allImages: ExtractedImage[] = [];
  const cleanedCard = { ...card };

  for (const field of IMAGE_FIELDS) {
    const html = card[field];
    if (!html) continue;
    const { cleanedHtml, images } = extractImagesFromHtml(html, field);
    (cleanedCard as Record<ImageField, string>)[field] = cleanedHtml;
    allImages.push(...images);
  }

  return { cleanedCard, images: allImages };
}
