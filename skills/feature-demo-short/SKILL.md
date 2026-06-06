---
name: feature-demo-short
description: >-
  Create a short feature-explainer video by animating a product screenshot into
  motion (image-to-video via frame_images) using the openrouter-media MCP tools.
  Use when the user wants a "feature demo", "explainer clip", "animated
  screenshot", "release highlight", or a short video that shows a UI/feature
  coming to life from a still image.
---

# Feature demo short

A feature-demo short turns a static screenshot (a dashboard, a new button, a
chart) into a brief animated clip — a subtle zoom/pan or a tasteful motion
reveal — for a changelog, release post, or onboarding step. It uses
**image-to-video**: you give the model a first frame and a motion prompt.

## 1. Start from a clean screenshot

- Capture the exact UI state you want to feature, at a generous resolution.
- Crop to the area that matters. Image-to-video preserves the frame, so noise in
  the screenshot becomes noise in the video.
- Encode it as a **data URL** (`data:image/png;base64,...`) or host it at a URL
  the model can fetch. You will pass this as a `frame_images` entry.

## 2. Pick a model that supports `first_frame`

Call `list_media_models` (`kind: "video"`) and check `supported_frame_images`.
Good image-to-video choices (all support `first_frame`):

- `kwaivgi/kling-v3.0-std` / `-pro` — also support `last_frame` for a start→end
  transition; many aspect ratios.
- `google/veo-3.1-lite` / `-fast` — clean motion, optional audio.
- `bytedance/seedance-2.0` — flexible aspect ratios and durations.

For a UI demo you usually want **no audio** and **720p**, `16:9` (or `9:16` for
mobile). Keep it short — 4–5 seconds reads as a polished loop.

## 3. Prompt for *motion*, not content

The image already supplies the content; the prompt should describe how it
**moves**. Examples:

> "Slow, smooth zoom-in toward the highlighted Save button; everything else
> stays still. Clean, professional, no added text."

> "Gentle parallax pan across the dashboard from left to right; cards subtly
> rise into place. Crisp, modern SaaS product motion."

Avoid asking it to invent new UI — that produces hallucinated, garbled
interface. Anchor motion to what's already in the frame.

## 4. Submit with `frame_images`

Call `generate_video_sync` (or `generate_video` + `get_video`) with:

```json
{
  "model": "kwaivgi/kling-v3.0-std",
  "prompt": "Slow zoom-in toward the highlighted button; no text.",
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "duration": 4,
  "generate_audio": false,
  "frame_images": [
    { "frame_type": "first_frame", "image_url": "data:image/png;base64,..." }
  ]
}
```

Budget the same way as any video (per-second pricing; the tool returns
`est_cost_usd` on submit and the real `cost_usd` on completion).

## 5. Deliver

On `completed`, take `result_url` (download it with the
`Authorization: Bearer <OPENROUTER_API_KEY>` header — the MCP server returns the
URL, not the bytes) and attach the MP4 to the changelog/release item using your
platform's attachment capability. Report the real cost.

## Tips

- If the motion drifts or warps the UI, shorten the duration and make the motion
  prompt smaller ("very subtle", "slow", "minimal").
- A `last_frame` (on Kling) lets you animate from one screen state to another —
  great for "before → after" feature reveals.
