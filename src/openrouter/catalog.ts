/**
 * Model-catalog parsing — pure transforms over the raw OpenRouter JSON.
 *
 * Two distinct catalogs feed `list_media_models`:
 *
 *  1. Image-output models come from the general `GET /models` endpoint. They are
 *     identified by `architecture.output_modalities` including `"image"`. Their
 *     pricing is the standard chat pricing object (per-token strings), with an
 *     extra `image` per-output-token rate on some providers. Verified live: 7
 *     such models (Gemini 3.x Image, GPT-5/5.4 Image, gemini-2.5-flash-image).
 *
 *  2. Video models come from the dedicated `GET /videos/models` endpoint. Each
 *     entry advertises `supported_resolutions`, `supported_aspect_ratios`,
 *     `supported_durations`, `supported_frame_images`, `generate_audio`, and a
 *     `pricing_skus` map keyed by billing dimension (e.g.
 *     `cents_per_video_output_second_480p`, or `duration_seconds`).
 *
 * Everything here is defensive: the input is untyped JSON that may drift, so we
 * narrow field-by-field and skip malformed entries rather than throwing.
 */

// ---------------------------------------------------------------------------
// Small JSON-narrowing helpers (shared shape with the rest of the codebase)
// ---------------------------------------------------------------------------

/** Narrow to a plain object (excludes arrays and null) for safe field access. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Trimmed, non-empty string, or null. */
export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Finite number or null (rejects NaN/Infinity so downstream math stays sane). */
export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Array of trimmed, non-empty strings (drops junk entries). Always returns an array. */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const s = asString(entry);
    if (s) out.push(s);
  }
  return out;
}

/** Array of finite numbers (used for `supported_durations`). Always returns an array. */
export function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const entry of value) {
    const n = asNumber(entry);
    if (n !== null) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Image-model catalog
// ---------------------------------------------------------------------------

/**
 * A normalized image-output model entry for `list_media_models`. Pricing fields
 * are dollars-per-token (OpenRouter expresses these as decimal strings in the
 * raw payload; we parse them to numbers). `imagePerToken` is the per-output-token
 * image rate when a provider charges image output separately (Gemini 3 Pro does;
 * Gemini Flash folds it into `completion`).
 */
export interface ImageModelInfo {
  id: string;
  name: string;
  /** Output modalities reported by the model (will include "image"). */
  outputModalities: string[];
  /** USD per prompt (input) token. */
  promptPerToken: number | null;
  /** USD per completion (output) token. */
  completionPerToken: number | null;
  /** USD per image output token, when billed separately. */
  imagePerToken: number | null;
}

/**
 * Parse the raw `GET /models` payload, keeping only models whose
 * `architecture.output_modalities` includes "image". This is exactly how the
 * live API distinguishes the (small) set of image generators from the 300+
 * text/chat models.
 */
export function parseImageModels(payload: unknown): ImageModelInfo[] {
  const root = asRecord(payload);
  const data = root && Array.isArray(root.data) ? root.data : [];
  const out: ImageModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const id = asString(rec.id);
    if (!id || seen.has(id)) continue;
    // Filter on output modalities — the defining trait of an image generator.
    const arch = asRecord(rec.architecture);
    const outputModalities = asStringArray(arch?.output_modalities);
    if (!outputModalities.includes("image")) continue;
    seen.add(id);
    const pricing = asRecord(rec.pricing);
    out.push({
      id,
      name: asString(rec.name) ?? id,
      outputModalities,
      // Pricing values arrive as decimal STRINGS (e.g. "0.000002"); Number()
      // parses them, and asNumber rejects anything that isn't finite.
      promptPerToken: asNumber(Number(pricing?.prompt)),
      completionPerToken: asNumber(Number(pricing?.completion)),
      imagePerToken: asNumber(Number(pricing?.image)),
    });
  }
  // Stable, numeric-aware sort so the catalog is deterministic in output.
  out.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
  return out;
}

// ---------------------------------------------------------------------------
// Video-model catalog
// ---------------------------------------------------------------------------

/**
 * A normalized video model entry. `pricingSkus` is preserved as a raw map of
 * SKU-name → USD-string because billing dimensions differ wildly per provider
 * (Grok bills `cents_per_video_output_second_480p`; Kling/Veo bill
 * `duration_seconds`-style dollar-per-second rates, sometimes with audio
 * variants). `cost.ts` interprets this map; we keep it lossless here.
 */
export interface VideoModelInfo {
  id: string;
  name: string;
  supportedResolutions: string[];
  supportedAspectRatios: string[];
  supportedSizes: string[];
  supportedDurations: number[];
  /** Which frame-image positions the model accepts for image-to-video (first_frame/last_frame). */
  supportedFrameImages: string[];
  /** Whether the model can produce synchronized audio (null = unknown/unsupported). */
  generateAudio: boolean | null;
  /** Raw SKU map: billing-dimension name → USD amount as a string. */
  pricingSkus: Record<string, string>;
}

/** Coerce the raw `pricing_skus` object into a clean string→string map. */
function parsePricingSkus(value: unknown): Record<string, string> {
  const rec = asRecord(value);
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    // Values may be strings ("5", "0.112") or numbers depending on the SKU; we
    // normalize to a string so downstream parsing has one shape to handle.
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
}

/** Parse the raw `GET /videos/models` payload into normalized video model info. */
export function parseVideoModels(payload: unknown): VideoModelInfo[] {
  const root = asRecord(payload);
  const data = root && Array.isArray(root.data) ? root.data : [];
  const out: VideoModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const id = asString(rec.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: asString(rec.name) ?? id,
      supportedResolutions: asStringArray(rec.supported_resolutions),
      supportedAspectRatios: asStringArray(rec.supported_aspect_ratios),
      supportedSizes: asStringArray(rec.supported_sizes),
      // Durations come back unsorted in the live payload; sort ascending so the
      // smallest (cheapest) option is first and the catalog reads cleanly.
      supportedDurations: asNumberArray(rec.supported_durations).sort((a, b) => a - b),
      supportedFrameImages: asStringArray(rec.supported_frame_images),
      generateAudio: typeof rec.generate_audio === "boolean" ? rec.generate_audio : null,
      pricingSkus: parsePricingSkus(rec.pricing_skus),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
  return out;
}
