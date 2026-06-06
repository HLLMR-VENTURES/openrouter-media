# Configuration

`openrouter-media` is an MCP **stdio** server. It is configured entirely through
environment variables — there is no config file.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENROUTER_API_KEY` | **yes** | — | Your OpenRouter API key (`sk-or-v1-...`). Read once at request time. Never logged. |
| `OPENROUTER_BASE_URL` | no | `https://openrouter.ai/api/v1` | Override for a proxy or self-hosted gateway. A trailing slash is normalized away. |
| `OPENROUTER_SITE_URL` | no | `https://github.com/HLLMR/openrouter-media` | Sent as the `HTTP-Referer` header for OpenRouter dashboard attribution. |
| `OPENROUTER_SITE_TITLE` | no | `openrouter-media` | Sent as the `X-Title` header for OpenRouter dashboard attribution. |

## Wiring it into an MCP client

The server runs as a stdio subprocess. Most clients take a `command` + `args` +
`env` block:

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

For a global install (`npm i -g openrouter-media`), use `"command":
"openrouter-media"` with no `-y` arg.

## Logging

- **stdout** is the MCP JSON-RPC channel — never written to by application code.
- **stderr** carries human-readable diagnostics (server ready, poll progress,
  errors). The API key is never included in any log line.

## Timeouts

- Image generation + catalog calls use a 180s per-request timeout.
- Video polls use a short (30s) per-poll timeout; the overall
  `generate_video_sync` wait is governed by its `timeout_sec` argument (default
  300s), with exponential backoff between polls.
