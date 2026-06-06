/**
 * Image-generation response parsing — pure logic, no network.
 *
 * Verified live against `POST /chat/completions` with modalities ["image","text"]:
 *   choices[0].message.images = [ { type: "image_url", image_url: { url } } ]
 * where `url` is a BASE64 DATA URL (e.g. "data:image/png;base64,iVBOR...").
 * Token usage + the authoritative cost come back in `usage` (usage.cost in USD,
 * with completion_tokens_details.image_tokens describing the image-token count).
 *
 * The MCP server must NOT stream large media bytes through the protocol, so the
 * server hands back a compact reference (mime type + byte size + a short prefix)
 * plus the usage/cost — never the multi-megabyte base64 blob inline. This module
 * extracts everything needed to build that reference.
 */

import { asRecord, asString, asNumber } from "./catalog.js";

/** One extracted image from a chat-completions image-output response. */
export interface ExtractedImage {
  /** The raw data URL (or hosted URL) exactly as returned. */
  url: string;
  /** True when `url` is a base64 data URL (the common case for image output). */
  isDataUrl: boolean;
  /** MIME type parsed from a data URL (e.g. "image/png"), else null. */
  mimeType: string | null;
  /** Decoded byte size of a data URL's payload, else null. */
  byteSize: number | null;
}

/** Parsed image-generation response: the images plus usage/cost/metadata. */
export interface ParsedImageResponse {
  id: string | null;
  model: string | null;
  finishReason: string | null;
  images: ExtractedImage[];
  /** Any assistant text accompanying the image(s). */
  text: string | null;
  /** Authoritative cost in USD from usage.cost. */
  costUsd: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  imageTokens: number | null;
}

/**
 * Inspect a URL string: if it is a data URL, parse its MIME type and compute the
 * decoded byte size from the base64 payload length. Hosted (http) URLs return
 * isDataUrl=false with null size/mime.
 */
export function inspectImageUrl(url: string): ExtractedImage {
  // data:[<mediatype>][;base64],<data>
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) {
    return { url, isDataUrl: false, mimeType: null, byteSize: null };
  }
  const mimeType = match[1] ?? null;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  // Base64 decodes to 3 bytes per 4 chars, minus padding "=" characters.
  let byteSize: number | null = null;
  if (isBase64) {
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    byteSize = Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  } else {
    byteSize = payload.length;
  }
  return { url, isDataUrl: true, mimeType, byteSize };
}

/** Flatten assistant message content (string, or array of text parts) to text. */
function readText(message: Record<string, unknown>): string | null {
  const direct = asString(message.content);
  if (direct) return direct;
  if (Array.isArray(message.content)) {
    const parts: string[] = [];
    for (const item of message.content) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      const rec = asRecord(item);
      const t = asString(rec?.text) ?? asString(rec?.value);
      if (t) parts.push(t);
    }
    const joined = parts.join("");
    return joined.length > 0 ? joined : null;
  }
  return null;
}

/** Extract the images array (`message.images[].image_url.url`). */
function readImages(message: Record<string, unknown>): ExtractedImage[] {
  const arr = Array.isArray(message.images) ? message.images : [];
  const out: ExtractedImage[] = [];
  for (const item of arr) {
    const rec = asRecord(item);
    if (!rec) continue;
    const imageUrl = asRecord(rec.image_url);
    const url = asString(imageUrl?.url) ?? asString(rec.url);
    if (!url) continue;
    out.push(inspectImageUrl(url));
  }
  return out;
}

/**
 * Parse a chat-completions image-output response into the structured shape the
 * server reports. Never throws — a malformed body yields empty images + nulls.
 */
export function parseImageResponse(payload: unknown): ParsedImageResponse {
  const root = asRecord(payload);
  const fallback: ParsedImageResponse = {
    id: null,
    model: null,
    finishReason: null,
    images: [],
    text: null,
    costUsd: null,
    promptTokens: null,
    completionTokens: null,
    imageTokens: null,
  };
  if (!root) return fallback;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = firstChoice ? asRecord(firstChoice.message) : null;
  const usage = asRecord(root.usage);
  const completionDetails = asRecord(usage?.completion_tokens_details);
  return {
    id: asString(root.id),
    model: asString(root.model),
    finishReason: firstChoice ? asString(firstChoice.finish_reason) : null,
    images: message ? readImages(message) : [],
    text: message ? readText(message) : null,
    costUsd: asNumber(usage?.cost),
    promptTokens: asNumber(usage?.prompt_tokens),
    completionTokens: asNumber(usage?.completion_tokens),
    imageTokens: asNumber(completionDetails?.image_tokens),
  };
}
