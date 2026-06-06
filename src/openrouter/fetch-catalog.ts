/**
 * Live media-model catalog fetch — image-output models from `/models` plus the
 * video catalog from `/videos/models`, cached briefly so repeated tool calls
 * don't hammer the API. Composes the network client with the pure parsers in
 * ./catalog.ts.
 */

import type { OpenRouterClient } from "./client.js";
import { parseImageModels, parseVideoModels, type ImageModelInfo, type VideoModelInfo } from "./catalog.js";

/** The combined media catalog returned to the `list_media_models` tool. */
export interface MediaCatalog {
  imageModels: ImageModelInfo[];
  videoModels: VideoModelInfo[];
  fetchedAt: number;
}

// The media catalog changes slowly; cache for 5 minutes per process.
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let cache: MediaCatalog | null = null;

/** Test hook: clear the process-level catalog cache so tests start cold. */
export function resetCatalogCacheForTests(): void {
  cache = null;
}

/**
 * Fetch both catalogs. The two endpoints are independent, so we request them in
 * parallel; either failing degrades to an empty list for that half rather than
 * failing the whole call (so an agent can still see whichever catalog loaded).
 */
export async function fetchMediaCatalog(client: OpenRouterClient, force = false): Promise<MediaCatalog> {
  const now = Date.now();
  if (!force && cache && now - cache.fetchedAt < CATALOG_CACHE_TTL_MS) return cache;

  const [imageModels, videoModels] = await Promise.all([
    client
      .requestJson("GET", "/models", undefined, 30)
      .then(parseImageModels)
      .catch(() => [] as ImageModelInfo[]),
    client
      .requestJson("GET", "/videos/models", undefined, 30)
      .then(parseVideoModels)
      .catch(() => [] as VideoModelInfo[]),
  ]);

  const result: MediaCatalog = { imageModels, videoModels, fetchedAt: now };
  // Only cache when at least one catalog populated, so a transient double-failure
  // doesn't pin an empty result for 5 minutes.
  if (imageModels.length > 0 || videoModels.length > 0) cache = result;
  return result;
}
