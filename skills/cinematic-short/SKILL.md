---
name: cinematic-short
description: >-
  Produce a short product cinematic (a hero clip for a launch, landing page, or
  social post) using the openrouter-media MCP tools. Covers model choice,
  prompt structure, resolution/duration budgeting, the submit-then-poll
  discipline, and attaching the finished clip to your work item. Use when the
  user asks for a "cinematic", "hero video", "product film", "launch trailer",
  or a polished short clip where look and (optionally) audio matter.
---

# Cinematic short

A cinematic short is a 4–8 second, high-craft clip: deliberate camera move,
strong lighting, a single clear subject. This skill takes you from brief to a
delivered video URL using `openrouter-media`.

## 1. Decide the brief before you spend anything

Video is billed **per output second**. Pin these down first:

- **Subject + action** in one sentence (e.g. "a glass perfume bottle on wet
  stone, slow dolly-in, sunrise light").
- **Aspect ratio**: `16:9` for web/landing, `9:16` for Reels/Shorts/TikTok.
- **Duration**: 4s is plenty for a hero loop; 8s if you need a beat of motion.
- **Audio?** Only Veo / Kling / some others generate synced audio, and audio
  costs more per second. For a silent hero loop, set `generate_audio: false`.

## 2. Choose the model (call `list_media_models` with `kind: "video"`)

Verified options and their tradeoffs:

| Need | Model | Why |
|---|---|---|
| Best look + native audio | `google/veo-3.1` | Highest quality; pricey ($0.20–0.40/s). |
| Great look, cheaper | `google/veo-3.1-fast` / `google/veo-3.1-lite` | Lite is ~$0.03/s (720p, no audio) — excellent value. |
| Fast + cheap, flexible aspect | `kwaivgi/kling-v3.0-std` | $0.084/s SKU, many aspect ratios; **note a per-clip minimum applies** (a 3s clip billed ~$0.63 in testing). |
| Premium Kling | `kwaivgi/kling-v3.0-pro` | Higher quality Kling tier. |

Heuristic: **Veo for the hero shot (look + audio); Kling/Grok for fast, cheap
iteration.** Read each model's `supported_resolutions`, `supported_durations`,
and `pricing_skus` from the catalog — passing an unsupported duration is a hard
error (e.g. Veo only allows 4/6/8s).

## 3. Budget the spend

Before generating, estimate: `est_cost_usd = usd_per_second × duration`. The
tools return this estimate on submit. **Be honest that it's a floor** — some
providers (Kling observed) add a per-clip minimum, so the real cost (returned on
completion) can be higher. If you have a spend cap, prefer `veo-3.1-lite` at
720p without audio and 4s (~$0.12) for first drafts, then upgrade the winning
prompt to a premium model.

## 4. Write a cinematic prompt

Structure: **subject → setting/light → camera move → mood/style**. Example:

> "A single matte-black wireless earbud resting on brushed concrete. Soft
> directional morning light from the left, shallow depth of field. Slow
> push-in dolly, subtle rack focus to the logo. Premium, minimal, Apple-style
> product film. No text."

Tips: name ONE subject; specify the camera move explicitly; add "no text/no
captions" so the model doesn't render garbled words; keep it to 2–4 sentences.

## 5. Submit and poll (the async discipline)

Two paths:

- **Simplest:** call `generate_video_sync` with your params and a `timeout_sec`
  (~300 is fine; 4–8s clips usually complete in under a minute). It submits and
  polls for you, returning `result_url` + the **real** `cost_usd` on success.
- **Manual control:** call `generate_video` to get a `job_id`, then poll
  `get_video` until `status` is `completed` (read `result_url`) or a terminal
  failure (`failed`/`cancelled`/`expired`). Don't poll faster than every few
  seconds.

If `generate_video_sync` times out it returns the `job_id` — resume by polling
`get_video`; the job keeps running server-side.

## 6. Deliver / attach

`result_url` points back at the OpenRouter API and **requires the
`OPENROUTER_API_KEY` bearer token to download**. The MCP server only returns the
URL — it does not stream the bytes. To attach the clip to a work item, download
it with the bearer header using **your own platform's file/attachment
capability**, then attach the downloaded MP4. Always report the real `cost_usd`
back to the user.

## Honest failure handling

- A `404` mentioning "data policy / guardrail" means your OpenRouter account
  blocks that provider — switch models or adjust settings at
  <https://openrouter.ai/settings/privacy>.
- If a job `failed`, report it plainly with the error; don't silently retry on
  an expensive model. Re-run on a cheap model first to validate the prompt.
