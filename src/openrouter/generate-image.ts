/**
 * Image generation — the network call, composing the client with the pure
 * response parser in ./images.ts.
 *
 * Verified live: image output comes back synchronously from
 * `POST /chat/completions` when the request sets `modalities: ["image","text"]`.
 * `image_config` carries optional aspect-ratio / size hints. The bytes arrive as
 * base64 data URLs inside choices[0].message.images[].image_url.url.
 */

import type { OpenRouterClient } from "./client.js";
import { parseImageResponse, type ParsedImageResponse } from "./images.js";

/** Parameters for an image generation request. */
export interface ImageGenParams {
  model: string;
  prompt: string;
  /** Aspect ratio hint, e.g. "16:9", "1:1" (forwarded via image_config). */
  aspectRatio?: string;
  /** Explicit size "WIDTHxHEIGHT" (forwarded via image_config). */
  size?: string;
  /** Number of images to request (defaults to 1). */
  n?: number;
}

/**
 * Generate one or more images. Builds the chat-completions request with the
 * image modality enabled and parses the response into the structured shape the
 * MCP tool reports (images + authoritative usage.cost).
 */
export async function generateImage(client: OpenRouterClient, params: ImageGenParams): Promise<ParsedImageResponse> {
  const body: Record<string, unknown> = {
    model: params.model,
    // Asking for both image + text output is the broadly-compatible form (Gemini
    // returns text alongside; OpenAI image models accept it too).
    modalities: ["image", "text"],
    messages: [{ role: "user", content: params.prompt }],
    // We don't need token/cost echoed via usage.include for image models — the
    // cost arrives in `usage.cost` regardless — but request it for completeness.
    usage: { include: true },
  };
  // image_config carries provider-agnostic generation hints. Only include it
  // when the caller actually specified something, so we don't override defaults.
  const imageConfig: Record<string, unknown> = {};
  if (params.aspectRatio) imageConfig.aspect_ratio = params.aspectRatio;
  if (params.size) imageConfig.size = params.size;
  if (Object.keys(imageConfig).length > 0) body.image_config = imageConfig;
  if (params.n && params.n > 1) body.n = params.n;

  const json = await client.requestJson("POST", "/chat/completions", body);
  return parseImageResponse(json);
}
