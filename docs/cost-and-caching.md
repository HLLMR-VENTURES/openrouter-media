# Cost

`openrouter-media` is built so a calling agent (or a spend governor) can always
see what a generation costs. Every billable tool returns cost-relevant fields.

## Images — bill per token, real cost returned

Image generation runs through `chat/completions` with
`modalities: ["image","text"]`. The image is emitted as a large block of "image
tokens" in the completion, so the cost is dominated by completion/image tokens.

- `generate_image` returns the **authoritative** `cost_usd` from the response's
  `usage.cost`, plus the token breakdown (`prompt_tokens`, `completion_tokens`,
  `image_tokens`).
- Observed live: a single ~1MP image on `google/gemini-3.1-flash-image-preview`
  cost ≈ **$0.068** (≈1,120 image tokens). Gemini 3 Pro Image and the GPT-5
  image models cost more.

There is no pre-flight token count for images (the model decides resolution), so
treat any pre-call image estimate as rough; the returned `cost_usd` is real.

## Videos — bill per output second, estimate then real cost

Video pricing comes from each model's `pricing_skus` map (see
`list_media_models`). SKU naming differs per provider:

- **Cents per second** (Grok): `cents_per_video_output_second_480p` (= $0.05/s),
  `_720p` (= $0.07/s).
- **Dollars per second** (Veo/Kling/Wan/...): `duration_seconds`,
  `duration_seconds_with_audio[_720p|_4k]`,
  `duration_seconds_without_audio[_720p]`,
  `text_to_video_duration_seconds_<res>`, etc.

`generate_video` and `generate_video_sync` return `est_cost_usd` (the matched
`usd_per_second × duration`) and the `est_pricing_sku` that produced it.

### The estimate is a floor, not a guarantee

Verified live: some providers add a **per-clip minimum / flat component** on top
of the per-second rate. A 3-second `kwaivgi/kling-v3.0-std` clip whose
`duration_seconds` SKU is $0.084/s (≈$0.25 expected) actually billed **$0.63**.
By contrast, `google/veo-3.1-lite` at 720p/no-audio billed **exactly** the
estimate ($0.03/s × 4s = $0.12).

**Always read the real cost from the completed job** (`cost_usd` in `get_video`
/ `generate_video_sync`). Use the estimate only to budget and to gate spend
before submitting.

## Budgeting guidance

- Draft on the cheapest viable model (e.g. `veo-3.1-lite` 720p no-audio, 4s ≈
  $0.12; Gemini Flash image ≈ $0.07), then upgrade the winning prompt.
- Keep video durations as short as the message allows — cost scales with
  seconds, and audio costs extra per second.
- A spend governor can read `est_cost_usd` before submission and the real
  `cost_usd` after completion to enforce caps.
