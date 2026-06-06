#!/usr/bin/env node
/**
 * openrouter-media — MCP stdio server.
 *
 * Exposes OpenRouter's image + async-video generation as MCP tools so any
 * MCP-capable agent (Claude Code, etc.) can create marketing/cinematic media.
 * The bundled SKILL.md skills (../skills) teach an agent HOW and WHEN to use
 * these tools for real creative work.
 *
 * Tools:
 *   - list_media_models    image + video catalog with resolutions/durations/pricing
 *   - generate_image       synchronous image; returns a compact ref + real cost
 *   - generate_video       submit an async job; returns { job_id, status, est_cost_usd }
 *   - get_video            poll a job_id → status (+ result url when complete)
 *   - generate_video_sync  submit + poll to completion with a timeout
 *
 * Design rules (per the spec):
 *   - Read OPENROUTER_API_KEY from env. Never log it.
 *   - Do NOT stream large media bytes through MCP — return URLs/refs + metadata.
 *   - Keep cost-relevant fields in every tool's output so a spend governor can
 *     see and bound spend.
 *   - Be honest about async/failed/partial/timeout states.
 *
 * Transport: stdio (the standard for local MCP servers). Because stdout is the
 * JSON-RPC channel, ALL human/diagnostic logging must go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_POLL_INTERVAL_SEC,
  DEFAULT_SYNC_TIMEOUT_SEC,
  DEFAULT_VIDEO_MODEL,
} from "./index.js";
import { OpenRouterClient, OpenRouterHttpError } from "./openrouter/client.js";
import { fetchMediaCatalog } from "./openrouter/fetch-catalog.js";
import { generateImage } from "./openrouter/generate-image.js";
import { submitVideo, getVideo, generateVideoSync } from "./openrouter/videos.js";
import { estimateImageCostUsd, estimateVideoCostUsd } from "./openrouter/cost.js";
import type { VideoModelInfo } from "./openrouter/catalog.js";

// ---------------------------------------------------------------------------
// Diagnostics (stderr only — stdout is the MCP JSON-RPC channel)
// ---------------------------------------------------------------------------

/** Log a line to stderr. Never include the API key. */
function logDiag(message: string): void {
  process.stderr.write(`[openrouter-media] ${message}\n`);
}

// ---------------------------------------------------------------------------
// MCP content helpers
// ---------------------------------------------------------------------------

/** Wrap a JSON-serializable value as a single MCP text-content result. */
function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Wrap an error as an MCP error result (isError flags it to the caller). */
function errorResult(value: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: true };
}

/** Turn any thrown value (esp. OpenRouterHttpError) into a structured error payload. */
function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof OpenRouterHttpError) {
    // A 404 with this body means the account's privacy/data-policy settings block
    // the provider — a common, actionable cause, so we call it out explicitly.
    const dataPolicyBlocked = err.status === 404 && /data policy|guardrail/i.test(err.body);
    return {
      error: "openrouter_http_error",
      status: err.status,
      message: err.message,
      ...(dataPolicyBlocked
        ? { hint: "This model is blocked by your OpenRouter account data/privacy policy. Adjust it at https://openrouter.ai/settings/privacy or choose a different model." }
        : {}),
    };
  }
  if (err instanceof Error && err.name === "AbortError") {
    return { error: "timeout", message: "The request timed out." };
  }
  return { error: "unexpected_error", message: err instanceof Error ? err.message : String(err) };
}

// ---------------------------------------------------------------------------
// Credentials + client construction
// ---------------------------------------------------------------------------

/**
 * Build the OpenRouter client from environment. The API key is required; the
 * base URL and attribution headers are optional overrides. Returns null (and
 * logs to stderr) when the key is absent so each tool can fail with a clear
 * message rather than crashing the server.
 */
function makeClient(): OpenRouterClient | null {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return new OpenRouterClient({
    apiKey,
    baseUrl: process.env.OPENROUTER_BASE_URL?.trim() || undefined,
    siteUrl: process.env.OPENROUTER_SITE_URL?.trim() || undefined,
    siteTitle: process.env.OPENROUTER_SITE_TITLE?.trim() || undefined,
  });
}

/** Standard "no key" error payload shared by every tool. */
const NO_KEY_ERROR = {
  error: "missing_api_key",
  message: "OPENROUTER_API_KEY is not set in the server environment. Set it and restart the MCP server.",
};

// ---------------------------------------------------------------------------
// Server assembly
// ---------------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer({
    name: "openrouter-media",
    version: "0.1.0",
  });

  // ===== Tool: list_media_models =====================================
  // Returns the image + video catalogs so an agent can choose a model and
  // budget. Per-model resolutions/durations/pricing are included verbatim.
  server.registerTool(
    "list_media_models",
    {
      title: "List media models",
      description:
        "List OpenRouter's image-output and video-generation models, with each model's " +
        "supported resolutions, aspect ratios, durations, frame-image (image-to-video) " +
        "support, audio capability, and pricing SKUs. Use this first to choose a model " +
        "and budget a generation. Video is priced per output second.",
      inputSchema: {
        kind: z
          .enum(["all", "image", "video"])
          .optional()
          .describe("Filter the catalog to image models, video models, or all (default)."),
      },
    },
    async ({ kind }) => {
      const client = makeClient();
      if (!client) return errorResult(NO_KEY_ERROR);
      try {
        const catalog = await fetchMediaCatalog(client);
        const want = kind ?? "all";
        const payload: Record<string, unknown> = {};
        if (want === "all" || want === "image") {
          payload.image_models = catalog.imageModels.map((m) => ({
            id: m.id,
            name: m.name,
            output_modalities: m.outputModalities,
            pricing_usd_per_token: {
              prompt: m.promptPerToken,
              completion: m.completionPerToken,
              image: m.imagePerToken,
            },
          }));
        }
        if (want === "all" || want === "video") {
          payload.video_models = catalog.videoModels.map((m) => ({
            id: m.id,
            name: m.name,
            supported_resolutions: m.supportedResolutions,
            supported_aspect_ratios: m.supportedAspectRatios,
            supported_durations_sec: m.supportedDurations,
            supported_frame_images: m.supportedFrameImages,
            generate_audio: m.generateAudio,
            pricing_skus: m.pricingSkus,
          }));
        }
        payload.note =
          "Video pricing SKUs are per output second (cents_per_* are in cents; duration_seconds* are in USD). " +
          "Some providers add a per-clip minimum, so the real cost can exceed rate*duration; the authoritative " +
          "cost is returned in the completed job's usage. Image models bill per token and the real cost is " +
          "returned by generate_image.";
        return jsonResult(payload);
      } catch (err) {
        logDiag(`list_media_models failed: ${err instanceof Error ? err.message : String(err)}`);
        return errorResult(describeError(err));
      }
    },
  );

  // ===== Tool: generate_image ========================================
  // Synchronous-ish image generation. Returns a COMPACT reference (mime + size +
  // a short data-URL prefix), the model, and the REAL cost from usage.cost — not
  // the multi-megabyte base64 blob inline.
  server.registerTool(
    "generate_image",
    {
      title: "Generate image",
      description:
        "Generate an image from a text prompt using an OpenRouter image-output model " +
        "(e.g. google/gemini-3-pro-image-preview, openai/gpt-5-image). Returns the image " +
        "as a data URL plus a compact reference (mime/size) and the REAL cost in USD. " +
        "Large image bytes are NOT inlined into the protocol beyond the data URL itself.",
      inputSchema: {
        prompt: z.string().min(1).describe("What to generate. Be specific about subject, style, lighting, and composition."),
        model: z
          .string()
          .optional()
          .describe(`Image model id from list_media_models. Defaults to ${DEFAULT_IMAGE_MODEL}.`),
        aspect_ratio: z.string().optional().describe('Aspect ratio hint, e.g. "16:9", "1:1", "9:16".'),
        size: z.string().optional().describe('Explicit size "WIDTHxHEIGHT", e.g. "1024x1024".'),
        n: z.number().int().min(1).max(4).optional().describe("Number of images to generate (default 1)."),
        return_data_url: z
          .boolean()
          .optional()
          .describe("When true, include the full base64 data URL(s) in the result. Default false (compact ref only) to keep the payload small."),
      },
    },
    async ({ prompt, model, aspect_ratio, size, n, return_data_url }) => {
      const client = makeClient();
      if (!client) return errorResult(NO_KEY_ERROR);
      const chosenModel = model?.trim() || DEFAULT_IMAGE_MODEL;
      try {
        const parsed = await generateImage(client, { model: chosenModel, prompt, aspectRatio: aspect_ratio, size, n });
        if (parsed.images.length === 0) {
          // The model returned no image (e.g. a refusal or a non-image model id).
          return errorResult({
            error: "no_image_returned",
            model: parsed.model ?? chosenModel,
            message: "The model returned no image. Confirm the model supports image output via list_media_models.",
            text: parsed.text,
          });
        }
        return jsonResult({
          model: parsed.model ?? chosenModel,
          finish_reason: parsed.finishReason,
          cost_usd: parsed.costUsd,
          usage: {
            prompt_tokens: parsed.promptTokens,
            completion_tokens: parsed.completionTokens,
            image_tokens: parsed.imageTokens,
          },
          text: parsed.text,
          images: parsed.images.map((img) => ({
            mime_type: img.mimeType,
            byte_size: img.byteSize,
            is_data_url: img.isDataUrl,
            // Always include a short prefix for verification; the full data URL
            // only when explicitly requested (it can be megabytes long).
            url_prefix: img.url.slice(0, 64),
            ...(return_data_url ? { data_url: img.url } : {}),
          })),
          note: return_data_url
            ? "Full data URL(s) included. Decode and attach to your work item using your platform's attachment capability."
            : "Compact reference only. Re-run with return_data_url=true to retrieve the bytes, then attach them via your platform.",
        });
      } catch (err) {
        logDiag(`generate_image failed (${chosenModel}): ${err instanceof Error ? err.message : String(err)}`);
        return errorResult({ ...describeError(err), model: chosenModel });
      }
    },
  );

  // Shared zod shape for the frame_images param (image-to-video conditioning).
  const frameImageSchema = z
    .array(
      z.object({
        frame_type: z.string().describe('"first_frame" or "last_frame" (must be supported by the model).'),
        image_url: z.string().describe("A data URL or hosted image URL to condition on."),
      }),
    )
    .optional()
    .describe("Image-to-video conditioning frames. Use for animating a still (e.g. a screenshot).");

  // ===== Tool: generate_video ========================================
  // Submit an async video job. Returns { job_id, status, est_cost_usd }. The
  // caller polls with get_video (or uses generate_video_sync).
  server.registerTool(
    "generate_video",
    {
      title: "Generate video (async submit)",
      description:
        "Submit an asynchronous video-generation job. Returns a job_id, the initial " +
        "status, and an ESTIMATED cost in USD (video is billed per output second; some " +
        "providers add a per-clip minimum). Poll with get_video, or use " +
        "generate_video_sync to submit and wait. Supports image-to-video via frame_images.",
      inputSchema: {
        prompt: z.string().min(1).describe("The scene/action to generate."),
        model: z.string().optional().describe(`Video model id from list_media_models. Defaults to ${DEFAULT_VIDEO_MODEL}.`),
        resolution: z.string().optional().describe('e.g. "480p", "720p", "1080p". Must be supported by the model.'),
        duration: z.number().int().min(1).optional().describe("Clip length in seconds. Must be a supported duration."),
        aspect_ratio: z.string().optional().describe('e.g. "16:9", "9:16", "1:1".'),
        generate_audio: z.boolean().optional().describe("Generate synchronized audio (only models that support it)."),
        seed: z.number().int().optional().describe("Optional seed for reproducibility (model-dependent)."),
        frame_images: frameImageSchema,
      },
    },
    async (args) => {
      const client = makeClient();
      if (!client) return errorResult(NO_KEY_ERROR);
      const chosenModel = args.model?.trim() || DEFAULT_VIDEO_MODEL;
      try {
        // Compute a cost estimate up front so a spend governor can gate the call.
        const est = await estimateForVideo(client, chosenModel, args.resolution, args.duration, args.generate_audio);
        const snapshot = await submitVideo(client, {
          model: chosenModel,
          prompt: args.prompt,
          resolution: args.resolution,
          duration: args.duration,
          aspect_ratio: args.aspect_ratio,
          generate_audio: args.generate_audio,
          seed: args.seed,
          frame_images: args.frame_images,
        });
        if (!snapshot.id) {
          return errorResult({ error: "submit_failed", model: chosenModel, message: snapshot.error ?? "No job id returned." });
        }
        return jsonResult({
          job_id: snapshot.id,
          status: snapshot.status,
          model: chosenModel,
          est_cost_usd: est.estUsd,
          est_pricing_sku: est.sku,
          est_usd_per_second: est.usdPerSecond,
          cost_note: est.note,
          polling_url: snapshot.pollingUrl,
          next: "Poll get_video with this job_id until status is 'completed' (then read result_url) or a terminal failure.",
        });
      } catch (err) {
        logDiag(`generate_video failed (${chosenModel}): ${err instanceof Error ? err.message : String(err)}`);
        return errorResult({ ...describeError(err), model: chosenModel });
      }
    },
  );

  // ===== Tool: get_video =============================================
  // Poll a single job. On completion, returns the result URL + real cost.
  server.registerTool(
    "get_video",
    {
      title: "Get video job status",
      description:
        "Poll a video job by job_id. Returns the current status; when 'completed', also " +
        "returns result_url (the generated video) and the REAL cost in USD. The result " +
        "URL points back at the OpenRouter API and requires the OPENROUTER_API_KEY bearer " +
        "token to download.",
      inputSchema: {
        job_id: z.string().min(1).describe("The job_id returned by generate_video / generate_video_sync."),
      },
    },
    async ({ job_id }) => {
      const client = makeClient();
      if (!client) return errorResult(NO_KEY_ERROR);
      try {
        const snapshot = await getVideo(client, job_id);
        return jsonResult({
          job_id: snapshot.id ?? job_id,
          status: snapshot.status,
          result_url: snapshot.unsignedUrls[0] ?? null,
          all_result_urls: snapshot.unsignedUrls,
          cost_usd: snapshot.costUsd,
          error: snapshot.error,
          download_note: snapshot.unsignedUrls.length
            ? "result_url requires an 'Authorization: Bearer <OPENROUTER_API_KEY>' header to download."
            : undefined,
        });
      } catch (err) {
        logDiag(`get_video failed (${job_id}): ${err instanceof Error ? err.message : String(err)}`);
        return errorResult({ ...describeError(err), job_id });
      }
    },
  );

  // ===== Tool: generate_video_sync ===================================
  // Submit + poll to completion within a timeout. On timeout, returns the
  // job_id so the caller can resume via get_video.
  server.registerTool(
    "generate_video_sync",
    {
      title: "Generate video (submit + wait)",
      description:
        "Submit a video job and poll it to completion within timeout_sec (default " +
        `${DEFAULT_SYNC_TIMEOUT_SEC}s). Returns the result_url + real cost on success; on ` +
        "timeout returns the job_id so you can resume with get_video; on failure surfaces " +
        "the error honestly. Uses exponential backoff between polls.",
      inputSchema: {
        prompt: z.string().min(1).describe("The scene/action to generate."),
        model: z.string().optional().describe(`Video model id. Defaults to ${DEFAULT_VIDEO_MODEL}.`),
        resolution: z.string().optional().describe('e.g. "480p", "720p".'),
        duration: z.number().int().min(1).optional().describe("Clip length in seconds (must be supported)."),
        aspect_ratio: z.string().optional().describe('e.g. "16:9", "9:16".'),
        generate_audio: z.boolean().optional().describe("Generate synchronized audio (supported models only)."),
        seed: z.number().int().optional().describe("Optional seed."),
        frame_images: frameImageSchema,
        timeout_sec: z
          .number()
          .int()
          .min(10)
          .max(1800)
          .optional()
          .describe(`Overall wait budget in seconds (default ${DEFAULT_SYNC_TIMEOUT_SEC}).`),
        poll_interval_sec: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe(`Base poll interval (default ${DEFAULT_POLL_INTERVAL_SEC}); backs off exponentially.`),
      },
    },
    async (args) => {
      const client = makeClient();
      if (!client) return errorResult(NO_KEY_ERROR);
      const chosenModel = args.model?.trim() || DEFAULT_VIDEO_MODEL;
      try {
        const est = await estimateForVideo(client, chosenModel, args.resolution, args.duration, args.generate_audio);
        const result = await generateVideoSync(
          client,
          {
            model: chosenModel,
            prompt: args.prompt,
            resolution: args.resolution,
            duration: args.duration,
            aspect_ratio: args.aspect_ratio,
            generate_audio: args.generate_audio,
            seed: args.seed,
            frame_images: args.frame_images,
          },
          {
            timeoutSec: args.timeout_sec ?? DEFAULT_SYNC_TIMEOUT_SEC,
            pollIntervalSec: args.poll_interval_sec ?? DEFAULT_POLL_INTERVAL_SEC,
            onPoll: (snap, attempt) => logDiag(`generate_video_sync poll #${attempt}: status=${snap.status}`),
          },
        );
        const base = {
          job_id: result.jobId,
          model: chosenModel,
          outcome: result.outcome,
          polls: result.polls,
          elapsed_ms: result.elapsedMs,
          est_cost_usd: est.estUsd,
        };
        if (result.outcome === "completed") {
          return jsonResult({
            ...base,
            status: result.snapshot.status,
            result_url: result.resultUrl,
            cost_usd: result.snapshot.costUsd,
            download_note: "result_url requires an 'Authorization: Bearer <OPENROUTER_API_KEY>' header to download. Then attach it to your work item.",
          });
        }
        if (result.outcome === "timeout") {
          return errorResult({
            ...base,
            status: result.snapshot.status,
            message: `Did not complete within the timeout. The job is still running — resume by polling get_video with job_id "${result.jobId}".`,
          });
        }
        // failed
        return errorResult({
          ...base,
          status: result.snapshot.status,
          error: result.snapshot.error ?? "Video generation failed.",
        });
      } catch (err) {
        logDiag(`generate_video_sync failed (${chosenModel}): ${err instanceof Error ? err.message : String(err)}`);
        return errorResult({ ...describeError(err), model: chosenModel });
      }
    },
  );

  return server;
}

/**
 * Helper shared by generate_video / generate_video_sync: look up the model in
 * the (cached) catalog and estimate cost. Falls back to a model-less estimate
 * when the catalog can't be reached, so a transient catalog failure doesn't
 * block a generation.
 */
async function estimateForVideo(
  client: OpenRouterClient,
  modelId: string,
  resolution: string | undefined,
  duration: number | undefined,
  withAudio: boolean | undefined,
): Promise<ReturnType<typeof estimateVideoCostUsd>> {
  let model: Pick<VideoModelInfo, "pricingSkus" | "generateAudio"> = { pricingSkus: {}, generateAudio: null };
  try {
    const catalog = await fetchMediaCatalog(client);
    const found = catalog.videoModels.find((m) => m.id === modelId);
    if (found) model = found;
  } catch {
    // Ignore — estimate with no SKUs (returns estUsd: null with an honest note).
  }
  return estimateVideoCostUsd({
    model,
    resolution: resolution ?? "720p",
    durationSec: duration ?? 0,
    withAudio,
  });
}

// ---------------------------------------------------------------------------
// Entry point: connect over stdio.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logDiag("MCP server ready on stdio (tools: list_media_models, generate_image, generate_video, get_video, generate_video_sync).");
}

// Only run when executed directly (the bin), not when imported by tests.
// import.meta.url vs argv[1] is the standard ESM "is main module" check.
import { fileURLToPath } from "node:url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    logDiag(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}

export { main };
