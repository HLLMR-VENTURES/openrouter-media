/**
 * Video generation — submit, poll, and a robust sync poll-loop driver.
 *
 * Composes the network client with the pure poll-state machine in ./poll.ts.
 * The async lifecycle (verified live):
 *   POST /videos          → { id, polling_url, status: "pending" }
 *   GET  /videos/{id}      → { ..., status, unsigned_urls?, usage?: { cost } }
 *
 * `generateVideoSync` polls with exponential backoff up to an overall timeout
 * and surfaces failed/partial/timeout states HONESTLY rather than pretending a
 * job succeeded — on timeout it returns the job_id so the caller can resume.
 */

import type { OpenRouterClient } from "./client.js";
import {
  parseVideoJob,
  isSuccess,
  isFailure,
  isTerminal,
  nextPollDelayMs,
  shouldTimeOut,
  type VideoJobSnapshot,
} from "./poll.js";

/** A reference image for image-to-video (first/last frame). */
export interface FrameImage {
  /** "first_frame" | "last_frame" — must be one the model supports. */
  frame_type: string;
  /** A data URL or hosted image URL. */
  image_url: string;
}

/** Parameters for submitting a video job. Mirrors the live POST /videos body. */
export interface VideoSubmitParams {
  model: string;
  prompt: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string;
  generate_audio?: boolean;
  seed?: number;
  /** Image-to-video: first/last frame conditioning images. */
  frame_images?: FrameImage[];
  /** Provider-specific passthrough options. */
  provider?: Record<string, unknown>;
}

/** Build the request body, omitting undefined fields so we never send nulls. */
function buildSubmitBody(params: VideoSubmitParams): Record<string, unknown> {
  const body: Record<string, unknown> = { model: params.model, prompt: params.prompt };
  if (params.resolution) body.resolution = params.resolution;
  if (typeof params.duration === "number") body.duration = params.duration;
  if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio;
  if (typeof params.generate_audio === "boolean") body.generate_audio = params.generate_audio;
  if (typeof params.seed === "number") body.seed = params.seed;
  if (params.frame_images && params.frame_images.length > 0) {
    // The live API expects each frame image as { type: "image_url", frame_type, image_url: { url } }.
    body.frame_images = params.frame_images.map((f) => ({
      type: "image_url",
      frame_type: f.frame_type,
      image_url: { url: f.image_url },
    }));
  }
  if (params.provider) body.provider = params.provider;
  return body;
}

/** Submit a video job. Returns the parsed snapshot (id + status "pending"). */
export async function submitVideo(client: OpenRouterClient, params: VideoSubmitParams): Promise<VideoJobSnapshot> {
  const json = await client.requestJson("POST", "/videos", buildSubmitBody(params));
  return parseVideoJob(json);
}

/** Poll a single video job by id. Returns the parsed snapshot. */
export async function getVideo(client: OpenRouterClient, jobId: string): Promise<VideoJobSnapshot> {
  // Use a short per-poll timeout: a poll should be quick; long jobs are handled
  // by repeated polls, not by one long-hanging request.
  const json = await client.requestJson("GET", `/videos/${encodeURIComponent(jobId)}`, undefined, 30);
  return parseVideoJob(json);
}

/** Outcome of a sync poll loop. `outcome` makes the terminal state explicit. */
export interface SyncVideoResult {
  outcome: "completed" | "failed" | "timeout";
  jobId: string | null;
  /** The final snapshot observed (terminal state, or the last poll before timeout). */
  snapshot: VideoJobSnapshot;
  /** First result URL when completed (needs the bearer token to download). */
  resultUrl: string | null;
  /** Number of poll attempts made. */
  polls: number;
  /** Wall-clock elapsed time (ms). */
  elapsedMs: number;
}

/**
 * Submit a video and poll it to completion within `timeoutSec`. On timeout the
 * job_id is returned so the caller can resume via `get_video`. Uses gentle
 * exponential backoff between polls (responsive early, easier on the API later).
 *
 * `sleep` is injectable so tests can drive the loop deterministically without
 * real timers.
 */
export async function generateVideoSync(
  client: OpenRouterClient,
  params: VideoSubmitParams,
  options: {
    timeoutSec: number;
    pollIntervalSec: number;
    maxPollIntervalSec?: number;
    sleep?: (ms: number) => Promise<void>;
    /** Called after each poll with the latest snapshot (for progress logging). */
    onPoll?: (snapshot: VideoJobSnapshot, attempt: number) => void;
  },
): Promise<SyncVideoResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const startedAt = Date.now();

  // 1) Submit.
  const submitted = await submitVideo(client, params);
  const jobId = submitted.id;
  // If submission already failed or returned no id, bail immediately and honestly.
  if (!jobId) {
    return {
      outcome: "failed",
      jobId: null,
      snapshot: submitted,
      resultUrl: null,
      polls: 0,
      elapsedMs: Date.now() - startedAt,
    };
  }
  if (isFailure(submitted.status)) {
    return { outcome: "failed", jobId, snapshot: submitted, resultUrl: null, polls: 0, elapsedMs: Date.now() - startedAt };
  }

  // 2) Poll loop.
  let attempt = 0;
  let last = submitted;
  for (;;) {
    const delayMs = nextPollDelayMs({
      attempt,
      baseIntervalSec: options.pollIntervalSec,
      maxIntervalSec: options.maxPollIntervalSec,
    });
    // Stop before sleeping if there isn't enough time left for another cycle.
    if (shouldTimeOut({ elapsedMs: Date.now() - startedAt, timeoutSec: options.timeoutSec, nextDelayMs: delayMs })) {
      return { outcome: "timeout", jobId, snapshot: last, resultUrl: null, polls: attempt, elapsedMs: Date.now() - startedAt };
    }
    await sleep(delayMs);

    last = await getVideo(client, jobId);
    attempt += 1;
    options.onPoll?.(last, attempt);

    if (isTerminal(last.status)) {
      if (isSuccess(last.status)) {
        return {
          outcome: "completed",
          jobId,
          snapshot: last,
          resultUrl: last.unsignedUrls[0] ?? null,
          polls: attempt,
          elapsedMs: Date.now() - startedAt,
        };
      }
      return { outcome: "failed", jobId, snapshot: last, resultUrl: null, polls: attempt, elapsedMs: Date.now() - startedAt };
    }
  }
}
