import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseVideoJob,
  normalizeStatus,
  isSuccess,
  isFailure,
  isRunning,
  isTerminal,
  nextPollDelayMs,
  shouldTimeOut,
} from "./poll.js";

test("parseVideoJob reads the submit shape", () => {
  // Exact live submit body.
  const snap = parseVideoJob({ id: "abc123", polling_url: "https://openrouter.ai/api/v1/videos/abc123", status: "pending" });
  assert.equal(snap.id, "abc123");
  assert.equal(snap.status, "pending");
  assert.equal(snap.pollingUrl, "https://openrouter.ai/api/v1/videos/abc123");
  assert.equal(snap.costUsd, null);
  assert.deepEqual(snap.unsignedUrls, []);
});

test("parseVideoJob reads the completed shape with unsigned_urls + usage.cost", () => {
  // Exact live completed body.
  const snap = parseVideoJob({
    id: "abc123",
    generation_id: "gen-vid-1",
    polling_url: "https://openrouter.ai/api/v1/videos/abc123",
    status: "completed",
    unsigned_urls: ["https://openrouter.ai/api/v1/videos/abc123/content?index=0"],
    usage: { cost: 0.63, is_byok: false },
  });
  assert.equal(snap.status, "completed");
  assert.equal(snap.generationId, "gen-vid-1");
  assert.equal(snap.costUsd, 0.63);
  assert.equal(snap.unsignedUrls[0], "https://openrouter.ai/api/v1/videos/abc123/content?index=0");
});

test("parseVideoJob extracts error from string or { message }", () => {
  assert.equal(parseVideoJob({ status: "failed", error: "boom" }).error, "boom");
  assert.equal(parseVideoJob({ status: "failed", error: { message: "nested boom" } }).error, "nested boom");
});

test("normalizeStatus maps known statuses and falls back to unknown", () => {
  assert.equal(normalizeStatus("completed"), "completed");
  assert.equal(normalizeStatus("IN_PROGRESS"), "in_progress");
  assert.equal(normalizeStatus("weird"), "unknown");
  assert.equal(normalizeStatus(undefined), "unknown");
});

test("status classification buckets", () => {
  assert.ok(isSuccess("completed"));
  assert.ok(isFailure("failed") && isFailure("cancelled") && isFailure("expired"));
  assert.ok(isRunning("pending") && isRunning("in_progress"));
  // unknown is treated as still-running (don't abort a job that may complete).
  assert.ok(isRunning("unknown"));
  assert.ok(isTerminal("completed") && isTerminal("failed"));
  assert.ok(!isTerminal("pending") && !isTerminal("unknown"));
});

test("nextPollDelayMs uses base interval for the first two polls then backs off", () => {
  assert.equal(nextPollDelayMs({ attempt: 0, baseIntervalSec: 6 }), 6000);
  assert.equal(nextPollDelayMs({ attempt: 1, baseIntervalSec: 6 }), 6000);
  // attempt 2 → 6 * 1.5 = 9s.
  assert.equal(nextPollDelayMs({ attempt: 2, baseIntervalSec: 6 }), 9000);
  // Caps at the max interval.
  assert.equal(nextPollDelayMs({ attempt: 20, baseIntervalSec: 6, maxIntervalSec: 30 }), 30000);
});

test("shouldTimeOut stops when no time remains for another cycle", () => {
  // 290s elapsed, 6s next delay, 300s budget → 296 < 300 → keep going.
  assert.equal(shouldTimeOut({ elapsedMs: 290_000, timeoutSec: 300, nextDelayMs: 6000 }), false);
  // 296s elapsed + 6s ≥ 300s → stop.
  assert.equal(shouldTimeOut({ elapsedMs: 296_000, timeoutSec: 300, nextDelayMs: 6000 }), true);
});
