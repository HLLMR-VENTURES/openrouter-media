---
name: image-to-video
description: >-
  Animate a still image into a short video clip (image-to-video) using the
  openrouter-media MCP tools and frame_images conditioning. Use when the user
  has an existing image — a product shot, illustration, logo, or photo — and
  wants it to move ("animate this", "make it a video", "bring this still to
  life", "add motion to this image").
---

# Image to video

Image-to-video keeps your existing still as the starting (and optionally ending)
frame and adds motion described by a prompt. This is the right tool when the
content already exists as an image and you want movement, not a brand-new scene.

## 1. Prepare the source frame

- Use the highest-quality version of the image you have; the model preserves and
  extends it, so compression artifacts will animate too.
- Provide it as a **data URL** (`data:image/png;base64,...`) or a fetchable URL.
- Match the image's aspect ratio to a `supported_aspect_ratios` value of the
  model you choose (don't force a 1:1 image into a 16:9 clip — crop first).

## 2. Choose a model that supports frame images

Call `list_media_models` (`kind: "video"`) and look at
`supported_frame_images`:

- `first_frame` — the model animates *forward* from your image. Supported by
  Kling (`kwaivgi/kling-v3.0-std`/`-pro`), Veo (`google/veo-3.1*`), Seedance,
  Wan, Grok, and others.
- `last_frame` — supported by Kling/Veo/Seedance; combine a `first_frame` and
  `last_frame` to animate a transition between two stills.

Pick based on cost and look (see the `cinematic-short` skill's model table).
For most "animate this" requests, **Kling Standard** (cheap, flexible aspect
ratios) or **Veo 3.1 Lite** (clean motion, very cheap at 720p/no-audio) are good
defaults.

## 3. Describe motion, anchored to the image

The image supplies the content; describe only the **movement and camera**, and
keep it modest so the still isn't distorted:

> "Gentle drifting motion: the steam from the coffee cup rises and curls slowly;
> subtle camera push-in. Everything else stays still. Photorealistic, calm."

> "Slow 3D parallax rotation of the product, soft studio light sweeping across
> the surface. No new objects, no text."

Smaller, slower motion = fewer artifacts. Avoid asking it to add new objects or
text not present in the image.

## 4. Submit with `frame_images`

```json
{
  "model": "kwaivgi/kling-v3.0-std",
  "prompt": "Subtle camera push-in; gentle ambient motion. No new objects.",
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "duration": 4,
  "generate_audio": false,
  "frame_images": [
    { "frame_type": "first_frame", "image_url": "data:image/png;base64,..." }
  ]
}
```

Use `generate_video_sync` to submit and wait (returns `result_url` + real
`cost_usd`), or `generate_video` + `get_video` for manual polling. For a
two-state transition, add a second `frame_images` entry with
`frame_type: "last_frame"`.

## 5. Budget and deliver

Video is per-second; the tool returns `est_cost_usd` on submit and the real
`cost_usd` on completion. Download `result_url` with the
`Authorization: Bearer <OPENROUTER_API_KEY>` header (the MCP server returns the
URL, not the bytes) and attach the MP4 via your platform. Report the real cost.

## Troubleshooting

- **Warping / morphing artifacts:** shorten the duration, slow the motion, and
  simplify the prompt.
- **Unsupported duration/resolution error:** check the model's
  `supported_durations` / `supported_resolutions` in `list_media_models`.
- **404 "data policy":** the provider is blocked for your account — switch
  models or adjust <https://openrouter.ai/settings/privacy>.
