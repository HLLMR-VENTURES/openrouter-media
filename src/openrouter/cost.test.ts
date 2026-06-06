import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateImageCostUsd, estimateVideoCostUsd } from "./cost.js";

test("estimateImageCostUsd prefers the dedicated image per-token rate", () => {
  // image rate present → used over completion rate.
  const cost = estimateImageCostUsd({ completionPerToken: 0.000012, imagePerToken: 0.000002, assumedImageTokens: 1000 });
  assert.equal(cost, 0.002);
});

test("estimateImageCostUsd falls back to completion rate, and scales by n", () => {
  const cost = estimateImageCostUsd({ completionPerToken: 0.000003, imagePerToken: null, assumedImageTokens: 1000, n: 2 });
  assert.equal(cost, 0.006);
});

test("estimateImageCostUsd returns null when no usable rate", () => {
  assert.equal(estimateImageCostUsd({ completionPerToken: null, imagePerToken: null }), null);
  assert.equal(estimateImageCostUsd({ completionPerToken: 0, imagePerToken: 0 }), null);
});

test("estimateVideoCostUsd handles Grok cents-per-second SKUs", () => {
  const est = estimateVideoCostUsd({
    model: { pricingSkus: { cents_per_video_output_second_480p: "5", cents_per_video_output_second_720p: "7" }, generateAudio: null },
    resolution: "480p",
    durationSec: 4,
  });
  // 5 cents/sec → $0.05/sec × 4s = $0.20.
  assert.equal(est.usdPerSecond, 0.05);
  assert.equal(est.estUsd, 0.2);
  assert.equal(est.sku, "cents_per_video_output_second_480p");
});

test("estimateVideoCostUsd picks audio vs no-audio Veo SKUs", () => {
  const model = {
    pricingSkus: {
      duration_seconds_with_audio_720p: "0.10",
      duration_seconds_without_audio_720p: "0.08",
    },
    generateAudio: true,
  };
  const withAudio = estimateVideoCostUsd({ model, resolution: "720p", durationSec: 6, withAudio: true });
  assert.equal(withAudio.usdPerSecond, 0.1);
  assert.equal(withAudio.sku, "duration_seconds_with_audio_720p");
  const noAudio = estimateVideoCostUsd({ model, resolution: "720p", durationSec: 6, withAudio: false });
  assert.equal(noAudio.usdPerSecond, 0.08);
  assert.equal(noAudio.sku, "duration_seconds_without_audio_720p");
});

test("estimateVideoCostUsd falls back to the flat duration_seconds SKU", () => {
  const est = estimateVideoCostUsd({
    model: { pricingSkus: { duration_seconds: "0.084" }, generateAudio: false },
    resolution: "720p",
    durationSec: 5,
  });
  assert.equal(est.sku, "duration_seconds");
  // 0.084 × 5 — compare with tolerance to avoid IEEE-754 float noise.
  assert.ok(est.estUsd !== null && Math.abs(est.estUsd - 0.42) < 1e-9);
});

test("estimateVideoCostUsd reports unknown when no SKU matches", () => {
  const est = estimateVideoCostUsd({ model: { pricingSkus: {}, generateAudio: null }, resolution: "720p", durationSec: 5 });
  assert.equal(est.estUsd, null);
  assert.equal(est.sku, null);
});
