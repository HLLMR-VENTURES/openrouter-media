# openrouter-media

[![npm version](https://img.shields.io/npm/v/openrouter-media.svg)](https://www.npmjs.com/package/openrouter-media)
[![CI](https://github.com/HLLMR/openrouter-media/actions/workflows/ci.yml/badge.svg)](https://github.com/HLLMR/openrouter-media/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/openrouter-media.svg)](https://www.npmjs.com/package/openrouter-media)
[![node](https://img.shields.io/node/v/openrouter-media.svg)](https://www.npmjs.com/package/openrouter-media)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An **MCP server** that exposes [OpenRouter](https://openrouter.ai)'s **image** and
**asynchronous video** generation as tools — bundled with companion **`SKILL.md`
skills** that teach an agent the creative workflows (cinematic shorts, feature
demos, hero images, image-to-video).

It speaks the [Model Context Protocol](https://modelcontextprotocol.io) over
stdio, so any MCP-capable agent (Claude Code, Claude Desktop, etc.) can browse
the live media-model catalog, generate images, submit and poll video jobs, and
budget spend — without writing any OpenRouter glue code.

## Why this server

- **Image + video in one place.** Image output via OpenRouter's
  `chat/completions` (`modalities: ["image","text"]`) and the asynchronous video
  API (`/videos`) under one MCP surface.
- **Cost-aware by design.** Every tool returns cost-relevant fields: image tools
  report the **real** `usage.cost`; video tools return a per-second **estimate**
  up front and the **real** cost on completion — so a spend governor can see and
  bound spend. (Video is priced per output second; some providers add a per-clip
  minimum, so estimates are an honest lower-ish bound, never a guarantee.)
- **Robust async lifecycle.** `generate_video_sync` submits and polls with
  exponential backoff up to a timeout, then hands back the `job_id` to resume —
  it surfaces failed/partial/timeout states honestly instead of pretending.
- **No media bytes through the protocol.** Tools return URLs / compact references
  (mime + size) plus metadata, not multi-megabyte blobs inline.
- **Ships real skills.** The `skills/` directory contains practical, cost-honest
  `SKILL.md` procedures an agent can follow for real marketing/creative work.

## Tools

| Tool | What it does |
|---|---|
| `list_media_models` | Image + video catalog with per-model resolutions, aspect ratios, durations, frame-image (image-to-video) support, audio capability, and pricing SKUs. Use it to choose a model and budget. |
| `generate_image` | Generate an image from a prompt. Returns a data URL + compact ref (mime/size) and the **real** cost in USD. |
| `generate_video` | Submit an async video job. Returns `{ job_id, status, est_cost_usd, est_pricing_sku }`. |
| `get_video` | Poll a `job_id` → status; on completion returns `result_url` + real cost. |
| `generate_video_sync` | Submit + poll to completion within `timeout_sec`; returns the `result_url` + real cost, or the `job_id` to resume on timeout. |

## Skills

Bundled in `skills/` (and shipped in the npm package):

| Skill | Teaches |
|---|---|
| [`cinematic-short`](skills/cinematic-short/SKILL.md) | Produce a short product cinematic — model choice (Veo for hero/audio, Kling/Grok for fast/cheap), prompt structure, resolution/duration budgeting, submit→poll discipline. |
| [`feature-demo-short`](skills/feature-demo-short/SKILL.md) | A feature-explainer short via image-to-video from a screenshot (`frame_images`). |
| [`hero-image`](skills/hero-image/SKILL.md) | High-quality marketing image (gpt-5-image / Gemini 3 Pro Image) with aspect-ratio + brand-consistency guidance. |
| [`image-to-video`](skills/image-to-video/SKILL.md) | Animate a still image into a short clip. |

## Install

```sh
npm install -g openrouter-media   # or run via npx
```

Set your OpenRouter key in the server environment:

```sh
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### Use with Claude Code / Claude Desktop

Add it to your MCP server config (stdio):

```json
{
  "mcpServers": {
    "openrouter-media": {
      "command": "npx",
      "args": ["-y", "openrouter-media"],
      "env": { "OPENROUTER_API_KEY": "sk-or-v1-..." }
    }
  }
}
```

Or, for a global install: `"command": "openrouter-media"`.

## Configuration (environment)

| Variable | Default | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | — | **required** |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | override for proxies/gateways |
| `OPENROUTER_SITE_URL` | this repo | sent as `HTTP-Referer` for OpenRouter attribution |
| `OPENROUTER_SITE_TITLE` | `openrouter-media` | sent as `X-Title` for OpenRouter attribution |

## Notes on cost & honesty

- **Images** bill per token; image output dominates the completion-token cost.
  The real cost is returned in every `generate_image` result (`cost_usd`).
- **Video** bills per output second. `est_cost_usd` is computed from the model's
  pricing SKU × duration, but some providers (observed: Kling) charge a per-clip
  minimum above that, so the **authoritative** cost is the `cost_usd` returned by
  the completed job. Always read the real cost from `get_video` /
  `generate_video_sync`.
- Some video models can be blocked by your OpenRouter account's data/privacy
  policy and return a 404; the tools call this out with a hint. Adjust at
  <https://openrouter.ai/settings/privacy> or pick a different model.

## Develop

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # compiles + runs node:test unit tests (no network)
npm run build       # emits dist/
npm start           # run the stdio server locally
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security policy: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) — free for everyone, always.
