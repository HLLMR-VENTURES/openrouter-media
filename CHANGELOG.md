# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-06

Initial release.

### Added

- **MCP stdio server** (`openrouter-media` bin) exposing OpenRouter's image +
  asynchronous video generation as tools:
  - `list_media_models` — live image-output (`/models` filter) + video
    (`/videos/models`) catalog with per-model resolutions, aspect ratios,
    durations, frame-image support, audio capability, and pricing SKUs.
  - `generate_image` — synchronous image generation via `chat/completions`
    (`modalities: ["image","text"]`); returns a data URL + compact reference
    (mime/size) and the real `usage.cost`.
  - `generate_video` — submit an async job (`POST /videos`); returns
    `{ job_id, status, est_cost_usd, est_pricing_sku }`.
  - `get_video` — poll a job (`GET /videos/{id}`) → status, and on completion the
    `result_url` + real cost.
  - `generate_video_sync` — submit + poll to completion within a timeout, with
    exponential backoff; returns the result URL + real cost, or the `job_id` to
    resume on timeout. Surfaces failed/partial/timeout states honestly.
- **Companion skills** (`skills/`, shipped in the package): `cinematic-short`,
  `feature-demo-short`, `hero-image`, `image-to-video`.
- **Cost awareness** in every tool output: real `usage.cost` for images and
  completed videos; per-second estimates (with the driving SKU) for video
  submission, so a spend governor can budget.
- Unit tests (`node:test`) for the pure logic: catalog parsing, cost estimation,
  the poll-state machine, image-response parsing, and the sync poll loop.

[Unreleased]: https://github.com/HLLMR/openrouter-media/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HLLMR/openrouter-media/releases/tag/v0.1.0
