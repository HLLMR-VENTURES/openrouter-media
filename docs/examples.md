# Examples

These show the tool inputs/outputs as an MCP client would send/receive them. All
outputs below are abbreviated real responses verified against the live
OpenRouter API.

## List the video catalog

`list_media_models` with `{ "kind": "video" }` →

```json
{
  "video_models": [
    {
      "id": "google/veo-3.1-lite",
      "supported_resolutions": ["720p", "1080p"],
      "supported_durations_sec": [4, 6, 8],
      "generate_audio": true,
      "pricing_skus": {
        "duration_seconds_without_audio_720p": "0.03",
        "duration_seconds_with_audio_720p": "0.05"
      }
    }
  ],
  "note": "Video pricing SKUs are per output second ..."
}
```

## Generate an image

`generate_image`:

```json
{
  "prompt": "A single matte-black earbud on brushed concrete, soft morning light, premium product photography, no text",
  "model": "google/gemini-3.1-flash-image-preview",
  "aspect_ratio": "16:9"
}
```

→ (compact reference by default)

```json
{
  "model": "google/gemini-3.1-flash-image-preview-20260226",
  "cost_usd": 0.06819,
  "usage": { "prompt_tokens": 12, "completion_tokens": 1448, "image_tokens": 1120 },
  "images": [{ "mime_type": "image/jpeg", "byte_size": 455939, "is_data_url": true, "url_prefix": "data:image/jpeg;base64,..." }],
  "note": "Compact reference only. Re-run with return_data_url=true to retrieve the bytes ..."
}
```

Pass `"return_data_url": true` to also receive the full base64 data URL.

## Generate a video (submit + wait)

`generate_video_sync`:

```json
{
  "prompt": "A red ball rolling slowly across a white table",
  "model": "google/veo-3.1-lite",
  "resolution": "720p",
  "duration": 4,
  "aspect_ratio": "16:9",
  "generate_audio": false,
  "timeout_sec": 300
}
```

→ (completed in ~48s in testing)

```json
{
  "job_id": "yToVQlf4ry63XoKV4uxD",
  "model": "google/veo-3.1-lite",
  "outcome": "completed",
  "polls": 4,
  "elapsed_ms": 48526,
  "est_cost_usd": 0.12,
  "status": "completed",
  "result_url": "https://openrouter.ai/api/v1/videos/yToVQlf4ry63XoKV4uxD/content?index=0",
  "cost_usd": 0.12,
  "download_note": "result_url requires an 'Authorization: Bearer <OPENROUTER_API_KEY>' header to download. Then attach it to your work item."
}
```

## Submit then poll manually

`generate_video` →

```json
{ "job_id": "XfdAv5SBjLdo2PNT3oAN", "status": "pending", "est_cost_usd": 0.42, "est_pricing_sku": "duration_seconds", "polling_url": "https://openrouter.ai/api/v1/videos/XfdAv5SBjLdo2PNT3oAN" }
```

then `get_video` with `{ "job_id": "XfdAv5SBjLdo2PNT3oAN" }` until →

```json
{ "job_id": "XfdAv5SBjLdo2PNT3oAN", "status": "completed", "result_url": "https://openrouter.ai/api/v1/videos/XfdAv5SBjLdo2PNT3oAN/content?index=0", "cost_usd": 0.63 }
```

## Image-to-video

`generate_video_sync` with a `frame_images` first frame:

```json
{
  "prompt": "Slow zoom-in toward the highlighted button; no text",
  "model": "kwaivgi/kling-v3.0-std",
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "duration": 4,
  "generate_audio": false,
  "frame_images": [
    { "frame_type": "first_frame", "image_url": "data:image/png;base64,iVBORw0..." }
  ]
}
```

## Downloading the result

`result_url` lives on the OpenRouter API and requires the bearer token:

```sh
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  "https://openrouter.ai/api/v1/videos/<job_id>/content?index=0" -o clip.mp4
```
