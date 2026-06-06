---
name: hero-image
description: >-
  Generate a high-quality marketing/hero image (for a landing page, social
  card, app store, or ad) using the openrouter-media generate_image tool. Covers
  model choice (gpt-5-image / Gemini 3 Pro Image), prompt structure, aspect
  ratio, and brand-consistency guidance. Use when the user wants a "hero image",
  "marketing image", "og image", "banner", "key visual", or any single polished
  still.
---

# Hero image

A hero image is the single most prominent visual on a page or post. This skill
produces one with `openrouter-media`'s `generate_image` tool.

## 1. Choose the model (call `list_media_models` with `kind: "image"`)

Verified image-output models and when to use them:

| Model | Best for |
|---|---|
| `google/gemini-3-pro-image-preview` ("Nano Banana Pro") | Highest-quality, detail-rich hero images; supports a dedicated image rate. |
| `google/gemini-3.1-flash-image-preview` ("Nano Banana 2") | Fast, inexpensive iteration and good quality (a single ~1MP image cost ≈ $0.07 in testing). |
| `openai/gpt-5-image` / `openai/gpt-5-image-mini` / `openai/gpt-5.4-image-2` | Strong text rendering and prompt adherence; good when the image must include legible words. |
| `google/gemini-2.5-flash-image` | Cheaper fallback. |

Heuristic: **draft on Gemini Flash (cheap), finalize the winning prompt on
Gemini 3 Pro Image or a GPT-5 image model.** Cost is returned on every call
(`cost_usd`), so you always know what you spent.

## 2. Pick the aspect ratio for the placement

- Landing hero / OG card: `16:9` (or `1.91:1` if supported via `size`).
- Square social: `1:1`.
- Story / mobile hero: `9:16`.

Pass `aspect_ratio` (e.g. `"16:9"`) or an explicit `size` (e.g. `"1536x1024"`).

## 3. Write a marketing-grade prompt

Structure: **subject → composition → lighting/material → style → negative
constraints**. Example:

> "A sleek titanium smartwatch floating against a deep navy gradient. Centered,
> generous negative space on the right for headline text. Soft studio rim
> lighting, crisp reflections, premium product photography. Minimal, modern,
> high contrast. No text, no watermark, no hands."

Brand-consistency tips:

- **State your palette** explicitly ("deep navy and warm gold", or give hex
  values) so multiple generations stay on-brand.
- **Reserve space for copy** ("negative space on the left for a headline") so a
  designer can drop text in later.
- **Forbid baked-in text** ("no text") unless you specifically need a word
  rendered — image models still garble long text; if you need legible words,
  prefer a GPT-5 image model and keep the text short.
- To match an existing look, describe the recurring style the same way each
  time (lighting, angle, material, mood) — treat the description as a reusable
  style token.

## 4. Generate and retrieve

Call `generate_image` with `prompt`, `model`, and `aspect_ratio`. By default the
tool returns a **compact reference** (mime type + byte size + a short prefix) plus
the real `cost_usd` — not the full blob. When you actually need the pixels, call
again (or pass) `return_data_url: true` to get the base64 data URL, then decode
and attach it to your work item via your platform's attachment capability.

Generate 2–3 variations of the strong prompt (vary `n` or re-run), pick the
best, and report the total cost.

## Honesty

- The cost in the result is the **real** billed cost. Report it.
- If the model returns no image (a refusal, or a non-image model id), the tool
  says so — fix the model id (confirm it via `list_media_models`) rather than
  retrying blindly.
