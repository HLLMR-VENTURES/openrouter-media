/**
 * openrouter-media — library entry point.
 *
 * This package ships primarily as an MCP **stdio server** (the `openrouter-media`
 * bin → `dist/server.js`). This module re-exports the pure, unit-tested building
 * blocks so the package can also be consumed as a library: the model-catalog
 * parsers, the cost estimators, and the async video poll-state machine. None of
 * these touch the network or the process — they are deterministic transforms over
 * data the caller fetches, which is exactly what makes them testable.
 *
 * The shared constants here (base URL, default models, attribution headers,
 * timeouts) are the single source of truth used by both the server and the
 * library surface.
 */

// ---------------------------------------------------------------------------
// Endpoint + attribution constants
// ---------------------------------------------------------------------------

/**
 * OpenRouter's API root. The media endpoints live under this prefix:
 *   - POST /chat/completions          (image output, via modalities:["image","text"])
 *   - GET  /models                    (full model catalog; image-output models are filtered out of it)
 *   - GET  /videos/models             (video model capability catalog)
 *   - POST /videos                    (submit an async video job)
 *   - GET  /videos/{id}               (poll a video job)
 * A trailing slash is normalized away wherever this is consumed.
 */
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter uses HTTP-Referer + X-Title purely for attribution on its
 * dashboards/rankings. We default both to this package's identity; the server
 * lets the operator override them via env (OPENROUTER_SITE_URL / OPENROUTER_SITE_TITLE).
 */
export const DEFAULT_SITE_URL = "https://github.com/HLLMR/openrouter-media";
export const DEFAULT_SITE_TITLE = "openrouter-media";

// ---------------------------------------------------------------------------
// Sensible default model ids (verified available against the live API)
// ---------------------------------------------------------------------------

/**
 * Default image model when the caller does not specify one. Gemini 3.1 Flash
 * Image ("Nano Banana 2") is fast, broadly available, and the cheapest of the
 * verified image-output models on the prompt side.
 */
export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";

/**
 * Default video model when the caller does not specify one. Kling v3.0 Standard
 * is the lowest-cost-per-second of the video models that this account's data
 * policy actually permits (some providers, e.g. grok/hailuo, can be blocked by
 * the account's privacy/guardrail settings and return a 404). Callers should
 * still pass an explicit model after consulting `list_media_models`.
 */
export const DEFAULT_VIDEO_MODEL = "kwaivgi/kling-v3.0-std";

// ---------------------------------------------------------------------------
// Timeouts / polling defaults
// ---------------------------------------------------------------------------

/** Per-HTTP-request timeout (seconds) for image generation + catalog calls. */
export const DEFAULT_REQUEST_TIMEOUT_SEC = 180;

/**
 * generate_video_sync defaults. Video jobs are genuinely asynchronous and can
 * take tens of seconds to a few minutes; we poll with a fixed interval up to an
 * overall timeout, after which the caller is handed the job_id to resume later.
 */
export const DEFAULT_SYNC_TIMEOUT_SEC = 300;
export const DEFAULT_POLL_INTERVAL_SEC = 6;

// Re-export the pure, testable building blocks for library consumers.
export * from "./openrouter/catalog.js";
export * from "./openrouter/cost.js";
export * from "./openrouter/poll.js";
export * from "./openrouter/images.js";
