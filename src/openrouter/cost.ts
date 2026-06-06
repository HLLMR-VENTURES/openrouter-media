/**
 * Cost estimation — pure functions over the catalog's pricing data.
 *
 * Two very different pricing shapes exist in the live API and this module
 * normalizes both:
 *
 *  - **Images** bill per token (prompt + completion, with completion dominated by
 *    "image tokens"). We can only ESTIMATE pre-flight because the number of image
 *    tokens depends on the resolution the model chooses. The authoritative cost
 *    always comes back in the response's `usage.cost`, so `generate_image` reports
 *    the real cost and uses these estimates only as a hint.
 *
 *  - **Videos** bill per output second, but the SKU naming differs per provider:
 *      • Grok:  `cents_per_video_output_second_480p` / `_720p`  (CENTS per second)
 *      • Veo:   `duration_seconds_with_audio` / `_without_audio[_720p|_4k]` (USD/sec)
 *      • Kling: `duration_seconds` / `duration_seconds_with_audio` /
 *               `text_to_video_duration_seconds_720p` ...               (USD/sec)
 *    We pick the most specific SKU that matches the requested resolution + audio,
 *    multiply by duration, and return both the number and the SKU we used so the
 *    estimate is auditable.
 *
 *  IMPORTANT HONESTY NOTE (verified live): some providers (Kling observed)
 *  charge MORE than `usd_per_second × duration` — there appears to be a per-clip
 *  minimum/flat component. A 3s Kling-std clip whose `duration_seconds` SKU was
 *  $0.084/s (≈$0.25 expected) actually billed $0.63. So the video estimate is a
 *  LOWER-BOUND-ish guide, not a guarantee. The true cost is returned by the poll
 *  response's `usage.cost` once the job completes, and the tools surface that.
 */

import type { VideoModelInfo } from "./catalog.js";

// ---------------------------------------------------------------------------
// Image cost estimation
// ---------------------------------------------------------------------------

/**
 * Rough pre-flight estimate for one generated image. Image generators emit a
 * large block of "image tokens" as completion output; a single ~1MP image lands
 * around ~1,100 image tokens on Gemini Flash (observed live). We use a
 * conservative default token count and the model's completion (or dedicated
 * image) per-token rate. This is intentionally labeled an estimate everywhere it
 * surfaces — `usage.cost` from the live response is authoritative.
 */
export function estimateImageCostUsd(input: {
  completionPerToken: number | null;
  imagePerToken: number | null;
  /** Approximate image-output tokens; defaults to a single ~1MP image. */
  assumedImageTokens?: number;
  /** Number of images requested. */
  n?: number;
}): number | null {
  const n = Math.max(1, input.n ?? 1);
  const tokens = input.assumedImageTokens ?? 1200;
  // Prefer the dedicated per-image-token rate when a provider bills it
  // separately; otherwise image output is folded into the completion rate.
  const perToken = input.imagePerToken ?? input.completionPerToken;
  if (perToken === null || perToken <= 0) return null;
  return perToken * tokens * n;
}

// ---------------------------------------------------------------------------
// Video cost estimation
// ---------------------------------------------------------------------------

/** Result of a video cost estimate, including which SKU drove it (auditable). */
export interface VideoCostEstimate {
  /** Estimated USD for the whole clip, or null when no matching SKU was found. */
  estUsd: number | null;
  /** The SKU key used, e.g. "cents_per_video_output_second_480p" or "duration_seconds". */
  sku: string | null;
  /** Per-second USD rate derived from that SKU. */
  usdPerSecond: number | null;
  /** Human note about estimate reliability (e.g. provider minimums). */
  note: string;
}

/**
 * Build the ordered list of candidate SKU keys to try for a given request,
 * most-specific first. We look for resolution- and audio-qualified variants
 * before falling back to generic per-second rates.
 */
function candidateSkuKeys(resolution: string, withAudio: boolean): string[] {
  const res = resolution.toLowerCase(); // "480p" | "720p" | "1080p" | "4k" | ...
  const keys: string[] = [];
  // Grok-style: cents per output second, resolution-qualified.
  keys.push(`cents_per_video_output_second_${res}`);
  // Veo/Kling-style: dollars per second, audio + resolution qualified.
  if (withAudio) {
    keys.push(`duration_seconds_with_audio_${res}`);
    keys.push(`text_to_video_duration_seconds_${res}`); // some Kling variants
    keys.push(`duration_seconds_with_audio`);
  } else {
    keys.push(`duration_seconds_without_audio_${res}`);
    keys.push(`text_to_video_duration_seconds_${res}`);
    keys.push(`duration_seconds_without_audio`);
  }
  // Generic per-second fallbacks (Kling exposes a flat `duration_seconds`).
  keys.push(`text_to_video_duration_seconds_${res}`);
  keys.push(`image_to_video_duration_seconds_${res}`);
  keys.push(`duration_seconds`);
  // De-duplicate while preserving the most-specific-first order.
  return [...new Set(keys)];
}

/** Convert a SKU key + its raw value into a per-second USD rate. */
function skuToUsdPerSecond(key: string, rawValue: string): number | null {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  // "cents_per_..." SKUs are in CENTS; everything else is already in dollars.
  return key.startsWith("cents_per_") ? value / 100 : value;
}

/**
 * Estimate the cost of a video generation from a model's `pricing_skus`, the
 * requested resolution/duration, and whether audio is generated. Returns the
 * estimate plus the SKU that produced it, so callers can show their work.
 */
export function estimateVideoCostUsd(input: {
  model: Pick<VideoModelInfo, "pricingSkus" | "generateAudio">;
  resolution: string;
  durationSec: number;
  /** Whether audio is being generated; defaults to the model's audio capability. */
  withAudio?: boolean;
}): VideoCostEstimate {
  const withAudio = input.withAudio ?? input.model.generateAudio === true;
  const skus = input.model.pricingSkus;
  const note =
    "Estimate from the model's per-second pricing SKU. Some providers add a per-clip " +
    "minimum/flat fee, so the real cost (returned in the completed job's usage.cost) " +
    "can be higher. Treat this as a budgeting guide, not a guarantee.";

  for (const key of candidateSkuKeys(input.resolution, withAudio)) {
    const raw = skus[key];
    if (raw === undefined) continue;
    const usdPerSecond = skuToUsdPerSecond(key, raw);
    if (usdPerSecond === null) continue;
    return {
      estUsd: usdPerSecond * input.durationSec,
      sku: key,
      usdPerSecond,
      note,
    };
  }

  // No matching SKU — surface that honestly rather than guessing zero.
  return {
    estUsd: null,
    sku: null,
    usdPerSecond: null,
    note: "No matching pricing SKU found for the requested resolution/audio; cost unknown until the job completes.",
  };
}
