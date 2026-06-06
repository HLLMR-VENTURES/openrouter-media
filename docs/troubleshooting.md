# Troubleshooting

## `missing_api_key`

`OPENROUTER_API_KEY` is not set in the server's environment. Set it and restart
the MCP server (the key is read from the server process env, not from tool
arguments).

## `404` with "No endpoints available matching your guardrail restrictions and data policy"

Your OpenRouter account's privacy/data policy blocks that provider. This is
common for some video providers (e.g. `x-ai/grok-imagine-video`,
`minimax/hailuo-2.3` were blocked on a default-policy test key). Fix by either:

- choosing a different model (Kling and Veo were reachable on the same key), or
- adjusting your data policy at <https://openrouter.ai/settings/privacy>.

The tool surfaces a `hint` field with this guidance.

## "Duration Ns is not supported for this model"

The model only accepts specific durations (e.g. Veo allows 4/6/8s). Check
`supported_durations_sec` in `list_media_models` and pass an allowed value. The
same applies to `resolution` (`supported_resolutions`) and `aspect_ratio`.

## `no_image_returned`

The model produced no image. Causes: a non-image model id (confirm the id has
`"image"` in its output modalities via `list_media_models` with `kind: "image"`),
or a content refusal (the `text` field may explain). Pick a valid image model.

## `generate_video_sync` returned `outcome: "timeout"`

The job didn't finish within `timeout_sec`. It is **still running** server-side —
resume by polling `get_video` with the returned `job_id`. Increase `timeout_sec`
for longer/high-res clips, or submit with `generate_video` and poll yourself.

## A video `failed` / `cancelled` / `expired`

Terminal failure from the provider. The `error` field (when present) explains.
Validate your prompt on a cheap model (e.g. `veo-3.1-lite`) before retrying on an
expensive one. Don't auto-retry expensive generations blindly.

## I get the URL but can't download the video

`result_url` points back at the OpenRouter API and requires the bearer token.
Download with `-H "Authorization: Bearer $OPENROUTER_API_KEY"`. The MCP server
intentionally returns the URL rather than streaming megabytes of MP4 through the
protocol.

## Diagnostics

Server diagnostics (startup, poll progress, errors) are written to **stderr**,
never stdout (stdout is the MCP channel). The API key is never logged.
