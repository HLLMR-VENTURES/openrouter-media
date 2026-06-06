/**
 * Async video poll-state machine — pure logic, no network.
 *
 * Verified live against `GET /api/v1/videos/{id}`:
 *   - submit returns: { id, polling_url, status: "pending" }
 *   - poll returns:   { id, generation_id, polling_url, status, ... }
 *   - on completion:  status "completed" + unsigned_urls: [ ".../content?index=0" ]
 *                     + usage: { cost, is_byok }
 *   - status enum:    pending | in_progress | completed | failed | cancelled | expired
 *
 * The content URL points back at the OpenRouter API and REQUIRES the bearer
 * token to download (verified: HEAD returned 200 video/mp4 ~3MB only with auth).
 *
 * This module turns a raw poll body into a typed snapshot and classifies the
 * status into terminal-success / terminal-failure / still-running buckets so the
 * server's poll loop stays a simple, honest driver.
 */

import { asRecord, asString, asStringArray, asNumber } from "./catalog.js";

/** The canonical status values OpenRouter reports for a video job. */
export type VideoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  // Defensive catch-all for any future/unknown status string.
  | "unknown";

/** Statuses that mean the job finished successfully. */
const SUCCESS_STATUSES = new Set<VideoStatus>(["completed"]);
/** Statuses that mean the job stopped without a usable result. */
const FAILURE_STATUSES = new Set<VideoStatus>(["failed", "cancelled", "expired"]);
/** Statuses that mean we should keep polling. */
const RUNNING_STATUSES = new Set<VideoStatus>(["pending", "in_progress"]);

/** A normalized snapshot of a video job's poll response. */
export interface VideoJobSnapshot {
  id: string | null;
  generationId: string | null;
  pollingUrl: string | null;
  status: VideoStatus;
  /** Provider-side result URLs (need the bearer token to download). */
  unsignedUrls: string[];
  /** Authoritative cost in USD once the job completes. */
  costUsd: number | null;
  /** Error message when the job failed. */
  error: string | null;
}

/** Coerce an arbitrary string into a known VideoStatus (or "unknown"). */
export function normalizeStatus(value: unknown): VideoStatus {
  const s = asString(value)?.toLowerCase();
  switch (s) {
    case "pending":
    case "in_progress":
    case "completed":
    case "failed":
    case "cancelled":
    case "expired":
      return s;
    default:
      return "unknown";
  }
}

/**
 * Parse a raw submit/poll response body into a VideoJobSnapshot. Tolerant of
 * partial payloads (the submit body has fewer fields than a completed poll).
 */
export function parseVideoJob(payload: unknown): VideoJobSnapshot {
  const rec = asRecord(payload);
  if (!rec) {
    return {
      id: null,
      generationId: null,
      pollingUrl: null,
      status: "unknown",
      unsignedUrls: [],
      costUsd: null,
      error: "Malformed (non-object) video job response.",
    };
  }
  const usage = asRecord(rec.usage);
  // `error` may be a bare string or a nested { message } object.
  const errorRec = asRecord(rec.error);
  const error = asString(rec.error) ?? asString(errorRec?.message);
  return {
    id: asString(rec.id),
    generationId: asString(rec.generation_id),
    pollingUrl: asString(rec.polling_url),
    status: normalizeStatus(rec.status),
    unsignedUrls: asStringArray(rec.unsigned_urls),
    costUsd: asNumber(usage?.cost),
    error,
  };
}

/** True when the job finished successfully. */
export function isSuccess(status: VideoStatus): boolean {
  return SUCCESS_STATUSES.has(status);
}

/** True when the job stopped without producing a result. */
export function isFailure(status: VideoStatus): boolean {
  return FAILURE_STATUSES.has(status);
}

/** True when polling should continue. "unknown" is treated as still-running so a transient/odd status doesn't abort a job that may yet complete. */
export function isRunning(status: VideoStatus): boolean {
  return RUNNING_STATUSES.has(status) || status === "unknown";
}

/** True when the status is terminal (no further polling will change it). */
export function isTerminal(status: VideoStatus): boolean {
  return isSuccess(status) || isFailure(status);
}

/**
 * Compute the next poll delay (ms) with gentle exponential backoff capped at a
 * ceiling. Keeps early polls responsive (short clips can finish fast) while
 * easing off the API for long-running jobs. attempt is 0-based.
 */
export function nextPollDelayMs(input: {
  attempt: number;
  baseIntervalSec: number;
  maxIntervalSec?: number;
}): number {
  const base = Math.max(1, input.baseIntervalSec);
  const max = Math.max(base, input.maxIntervalSec ?? 30);
  // 1x, 1x, then grow ~1.5x per attempt up to the cap. The first two polls use
  // the base interval so short jobs are caught quickly.
  const factor = input.attempt <= 1 ? 1 : Math.pow(1.5, input.attempt - 1);
  const seconds = Math.min(max, base * factor);
  return Math.round(seconds * 1000);
}

/**
 * Decide whether a sync-poll loop should stop given elapsed time vs. the overall
 * timeout. Returns true when there is not enough time left for another poll
 * cycle, so the caller can hand back the job_id for the user to resume.
 */
export function shouldTimeOut(input: {
  elapsedMs: number;
  timeoutSec: number;
  nextDelayMs: number;
}): boolean {
  return input.elapsedMs + input.nextDelayMs >= input.timeoutSec * 1000;
}
