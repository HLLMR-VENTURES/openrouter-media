/**
 * Thin OpenRouter HTTP client.
 *
 * Centralizes auth + attribution headers, base-URL normalization, per-request
 * timeouts (AbortController), and JSON parsing. The pure parsers in the sibling
 * modules consume the JSON this returns; this file is the ONLY place that talks
 * to the network, which keeps the rest of the package unit-testable.
 *
 * Auth: Authorization: Bearer <key>, plus HTTP-Referer + X-Title for OpenRouter
 * dashboard attribution (mirrors the paperclip-openrouter adapter's convention).
 */

import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_SEC,
  DEFAULT_SITE_TITLE,
  DEFAULT_SITE_URL,
} from "../index.js";

/** Options for constructing the client. */
export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  siteUrl?: string;
  siteTitle?: string;
  /** Default per-request timeout (seconds); overridable per call. */
  timeoutSec?: number;
}

/** Error thrown for non-2xx responses, carrying status + body for the caller. */
export class OpenRouterHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    // Truncate the body in the message so logs/tool errors stay readable.
    super(`OpenRouter ${status} ${statusText}: ${body.slice(0, 300)}`);
    this.name = "OpenRouterHttpError";
  }
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly siteUrl: string;
  private readonly siteTitle: string;
  private readonly timeoutSec: number;

  constructor(opts: OpenRouterClientOptions) {
    this.apiKey = opts.apiKey;
    // Strip a trailing slash so we can safely append "/videos" etc.
    this.baseUrl = (opts.baseUrl?.trim() || DEFAULT_OPENROUTER_BASE_URL).replace(/\/$/, "");
    this.siteUrl = opts.siteUrl?.trim() || DEFAULT_SITE_URL;
    this.siteTitle = opts.siteTitle?.trim() || DEFAULT_SITE_TITLE;
    this.timeoutSec = opts.timeoutSec && opts.timeoutSec > 0 ? opts.timeoutSec : DEFAULT_REQUEST_TIMEOUT_SEC;
  }

  /** The normalized base URL (no trailing slash). */
  get base(): string {
    return this.baseUrl;
  }

  /** The bearer token — needed by callers that build authenticated download URLs. */
  get key(): string {
    return this.apiKey;
  }

  /** Standard headers for every request: auth + attribution. */
  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "HTTP-Referer": this.siteUrl,
      "X-Title": this.siteTitle,
      ...extra,
    };
  }

  /**
   * Perform a request and return the parsed JSON. Applies a timeout via
   * AbortController and throws OpenRouterHttpError on non-2xx so callers can
   * classify failures (the tool layer turns these into honest error results).
   */
  async requestJson(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutSec?: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const ms = Math.max(5, timeoutSec ?? this.timeoutSec) * 1000;
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(body !== undefined ? { "Content-Type": "application/json" } : undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new OpenRouterHttpError(res.status, res.statusText, text);
      }
      // Empty body → null; otherwise parse JSON (throws on malformed, which the
      // caller surfaces as an error result).
      return text.length > 0 ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch a binary resource (e.g. a completed video's content URL, which lives
   * back on the OpenRouter API and needs the bearer token). Returns the bytes +
   * content type. Used only when a caller explicitly asks to download; the MCP
   * tools default to returning the URL, not the bytes.
   */
  async fetchBinary(url: string, timeoutSec?: number): Promise<{ bytes: ArrayBuffer; contentType: string | null }> {
    const controller = new AbortController();
    const ms = Math.max(5, timeoutSec ?? this.timeoutSec) * 1000;
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: controller.signal });
      const buf = await res.arrayBuffer();
      if (!res.ok) {
        throw new OpenRouterHttpError(res.status, res.statusText, `(${buf.byteLength} bytes binary)`);
      }
      return { bytes: buf, contentType: res.headers.get("content-type") };
    } finally {
      clearTimeout(timer);
    }
  }
}
