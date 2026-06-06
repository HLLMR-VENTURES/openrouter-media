import assert from "node:assert/strict";
import { test } from "node:test";
import { parseImageModels, parseVideoModels } from "./catalog.js";

// A trimmed sample mirroring the live GET /models shape: a chat model (no image
// output) alongside two image-output models, one with a dedicated `image` rate.
const MODELS_PAYLOAD = {
  data: [
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o mini",
      architecture: { output_modalities: ["text"] },
      pricing: { prompt: "0.00000015", completion: "0.0000006" },
    },
    {
      id: "google/gemini-3.1-flash-image-preview",
      name: "Nano Banana 2",
      architecture: { output_modalities: ["image", "text"] },
      pricing: { prompt: "0.0000005", completion: "0.000003" },
    },
    {
      id: "google/gemini-3-pro-image-preview",
      name: "Nano Banana Pro",
      architecture: { output_modalities: ["image", "text"] },
      pricing: { prompt: "0.000002", completion: "0.000012", image: "0.000002" },
    },
  ],
};

test("parseImageModels keeps only image-output models", () => {
  const models = parseImageModels(MODELS_PAYLOAD);
  assert.equal(models.length, 2);
  // gpt-4o-mini (text-only) must be filtered out.
  assert.ok(!models.some((m) => m.id === "openai/gpt-4o-mini"));
  assert.ok(models.some((m) => m.id === "google/gemini-3.1-flash-image-preview"));
});

test("parseImageModels parses string pricing into numbers", () => {
  const models = parseImageModels(MODELS_PAYLOAD);
  const pro = models.find((m) => m.id === "google/gemini-3-pro-image-preview");
  assert.ok(pro);
  assert.equal(pro?.promptPerToken, 0.000002);
  assert.equal(pro?.completionPerToken, 0.000012);
  assert.equal(pro?.imagePerToken, 0.000002);
  const flash = models.find((m) => m.id === "google/gemini-3.1-flash-image-preview");
  // Flash has no dedicated `image` rate → null.
  assert.equal(flash?.imagePerToken, null);
});

test("parseImageModels tolerates malformed input", () => {
  assert.deepEqual(parseImageModels(null), []);
  assert.deepEqual(parseImageModels({}), []);
  assert.deepEqual(parseImageModels({ data: "nope" }), []);
});

// A trimmed sample mirroring the live GET /videos/models shape.
const VIDEOS_PAYLOAD = {
  data: [
    {
      id: "x-ai/grok-imagine-video",
      name: "Grok Imagine Video",
      supported_resolutions: ["480p", "720p"],
      supported_aspect_ratios: ["16:9", "9:16"],
      supported_sizes: ["854x480"],
      supported_durations: [3, 1, 2],
      supported_frame_images: ["first_frame"],
      generate_audio: null,
      pricing_skus: { cents_per_video_output_second_480p: "5", cents_per_video_output_second_720p: "7" },
    },
    {
      id: "kwaivgi/kling-v3.0-std",
      name: "Kling v3.0 Standard",
      supported_resolutions: ["720p"],
      supported_aspect_ratios: ["16:9"],
      supported_sizes: ["1280x720"],
      supported_durations: [5, 10],
      supported_frame_images: ["first_frame", "last_frame"],
      generate_audio: true,
      pricing_skus: { duration_seconds: "0.084", duration_seconds_with_audio: "0.126" },
    },
  ],
};

test("parseVideoModels normalizes capabilities and sorts durations", () => {
  const models = parseVideoModels(VIDEOS_PAYLOAD);
  assert.equal(models.length, 2);
  const grok = models.find((m) => m.id === "x-ai/grok-imagine-video");
  assert.ok(grok);
  // Durations sorted ascending.
  assert.deepEqual(grok?.supportedDurations, [1, 2, 3]);
  assert.equal(grok?.generateAudio, null);
  assert.deepEqual(grok?.pricingSkus, {
    cents_per_video_output_second_480p: "5",
    cents_per_video_output_second_720p: "7",
  });
  const kling = models.find((m) => m.id === "kwaivgi/kling-v3.0-std");
  assert.equal(kling?.generateAudio, true);
  assert.deepEqual(kling?.supportedFrameImages, ["first_frame", "last_frame"]);
});

test("parseVideoModels tolerates malformed input", () => {
  assert.deepEqual(parseVideoModels(null), []);
  assert.deepEqual(parseVideoModels({ data: [{ name: "no id" }] }), []);
});
