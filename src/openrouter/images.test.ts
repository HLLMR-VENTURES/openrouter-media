import assert from "node:assert/strict";
import { test } from "node:test";
import { parseImageResponse, inspectImageUrl } from "./images.js";

// A 1x1 transparent PNG as a base64 data URL (tiny, real).
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("inspectImageUrl parses mime + byte size from a base64 data URL", () => {
  const info = inspectImageUrl(TINY_PNG);
  assert.equal(info.isDataUrl, true);
  assert.equal(info.mimeType, "image/png");
  assert.ok(info.byteSize && info.byteSize > 0);
});

test("inspectImageUrl handles hosted (non-data) URLs", () => {
  const info = inspectImageUrl("https://example.com/img.png");
  assert.equal(info.isDataUrl, false);
  assert.equal(info.mimeType, null);
  assert.equal(info.byteSize, null);
});

test("parseImageResponse extracts images, usage, and cost", () => {
  // Mirrors the live chat-completions image-output shape.
  const parsed = parseImageResponse({
    id: "gen-1",
    model: "google/gemini-3.1-flash-image-preview",
    choices: [
      {
        message: { role: "assistant", content: null, images: [{ type: "image_url", image_url: { url: TINY_PNG } }] },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 9,
      completion_tokens: 1120,
      cost: 0.0672045,
      completion_tokens_details: { image_tokens: 1120 },
    },
  });
  assert.equal(parsed.id, "gen-1");
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0]?.mimeType, "image/png");
  assert.equal(parsed.costUsd, 0.0672045);
  assert.equal(parsed.imageTokens, 1120);
  assert.equal(parsed.finishReason, "stop");
});

test("parseImageResponse returns empty images on a refusal/no-image body", () => {
  const parsed = parseImageResponse({
    choices: [{ message: { role: "assistant", content: "I can't do that." }, finish_reason: "stop" }],
  });
  assert.equal(parsed.images.length, 0);
  assert.equal(parsed.text, "I can't do that.");
});

test("parseImageResponse tolerates malformed input", () => {
  const parsed = parseImageResponse(null);
  assert.equal(parsed.images.length, 0);
  assert.equal(parsed.costUsd, null);
});
