import assert from "node:assert/strict";
import { test } from "node:test";
import { generateVideoSync } from "./videos.js";
import type { OpenRouterClient } from "./client.js";

/**
 * A minimal fake OpenRouterClient that returns scripted JSON for the submit POST
 * and a sequence of poll GETs. Lets us drive the sync loop deterministically
 * with no network and an instant (no-op) sleep.
 */
function fakeClient(submit: unknown, polls: unknown[]): OpenRouterClient {
  let pollIndex = 0;
  const stub = {
    async requestJson(method: string, path: string): Promise<unknown> {
      if (method === "POST" && path === "/videos") return submit;
      // GET /videos/{id}: hand back the next scripted poll, repeating the last.
      const next = polls[Math.min(pollIndex, polls.length - 1)];
      pollIndex += 1;
      return next;
    },
  };
  // Cast through unknown: the loop only uses requestJson via submitVideo/getVideo.
  return stub as unknown as OpenRouterClient;
}

const instantSleep = async (): Promise<void> => {};

test("generateVideoSync completes when a poll returns completed", async () => {
  const client = fakeClient(
    { id: "job-1", polling_url: "https://openrouter.ai/api/v1/videos/job-1", status: "pending" },
    [
      { id: "job-1", status: "pending" },
      { id: "job-1", status: "in_progress" },
      {
        id: "job-1",
        status: "completed",
        unsigned_urls: ["https://openrouter.ai/api/v1/videos/job-1/content?index=0"],
        usage: { cost: 0.42 },
      },
    ],
  );
  const result = await generateVideoSync(
    client,
    { model: "kwaivgi/kling-v3.0-std", prompt: "test" },
    { timeoutSec: 300, pollIntervalSec: 1, sleep: instantSleep },
  );
  assert.equal(result.outcome, "completed");
  assert.equal(result.jobId, "job-1");
  assert.equal(result.resultUrl, "https://openrouter.ai/api/v1/videos/job-1/content?index=0");
  assert.equal(result.snapshot.costUsd, 0.42);
  assert.equal(result.polls, 3);
});

test("generateVideoSync surfaces a failed job honestly", async () => {
  const client = fakeClient({ id: "job-2", status: "pending" }, [{ id: "job-2", status: "failed", error: "provider error" }]);
  const result = await generateVideoSync(
    client,
    { model: "m", prompt: "x" },
    { timeoutSec: 300, pollIntervalSec: 1, sleep: instantSleep },
  );
  assert.equal(result.outcome, "failed");
  assert.equal(result.snapshot.error, "provider error");
  assert.equal(result.resultUrl, null);
});

test("generateVideoSync times out and returns the job_id to resume", async () => {
  // Never completes; timeout budget allows only a couple of polls.
  const client = fakeClient({ id: "job-3", status: "pending" }, [{ id: "job-3", status: "in_progress" }]);
  const result = await generateVideoSync(
    client,
    { model: "m", prompt: "x" },
    { timeoutSec: 12, pollIntervalSec: 6, sleep: instantSleep },
  );
  assert.equal(result.outcome, "timeout");
  assert.equal(result.jobId, "job-3");
  assert.equal(result.resultUrl, null);
});

test("generateVideoSync fails immediately when submit returns no id", async () => {
  const client = fakeClient({ error: "bad request" }, []);
  const result = await generateVideoSync(
    client,
    { model: "m", prompt: "x" },
    { timeoutSec: 300, pollIntervalSec: 1, sleep: instantSleep },
  );
  assert.equal(result.outcome, "failed");
  assert.equal(result.jobId, null);
  assert.equal(result.polls, 0);
});
