# Security Policy

`openrouter-media` is an MCP stdio server that exposes OpenRouter's image and
asynchronous video generation as tools. Because it handles an OpenRouter API key
and makes authenticated, billable requests on the operator's behalf, we take
security reports seriously.

## Supported Versions

Security fixes are provided for the latest released minor on the current major.
Older majors receive critical fixes on a best-effort basis only.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub Security Advisories:

➡️ https://github.com/HLLMR/openrouter-media/security/advisories/new

When reporting, please include where practical:

- A description of the vulnerability and its impact.
- Steps to reproduce or a proof of concept.
- Affected version(s) of the server and Node.js.
- Any relevant configuration (with secrets redacted).

### Response window

- **Acknowledgement:** within 3 business days of your report.
- **Triage and severity assessment:** within 7 business days.
- **Fix or mitigation plan:** communicated as soon as triage completes; timelines
  depend on severity and complexity.

We will keep you informed of progress and coordinate a disclosure date with you.

### Responsible disclosure

- Give us a reasonable opportunity to investigate and ship a fix before any
  public disclosure.
- Do not access, modify, or exfiltrate data that is not yours, and do not
  degrade service for other users while testing.
- Act in good faith and avoid privacy violations or destruction of data.

We are happy to credit reporters in the advisory unless you prefer to remain
anonymous.

## Security Model

### API key handling

- The OpenRouter API key is read **only** from the `OPENROUTER_API_KEY`
  environment variable in the server process.
- The key is used only to authenticate requests to OpenRouter
  (`https://openrouter.ai/api/v1`, or `OPENROUTER_BASE_URL` if overridden).
- The key is **never logged**. Diagnostic logging goes to stderr and never
  includes the key. Avoid pasting raw keys into issues, logs, or config
  snippets you share.
- The video `result_url` points back at the OpenRouter API and requires the
  bearer token to download. Treat that URL as sensitive while a valid token
  exists.

### Spend / billing

- Every generation tool makes **billable** requests. The server returns
  cost-relevant fields (real `usage.cost` for images and completed videos;
  per-second estimates for video submission) so an operator or spend governor
  can monitor and bound spend. There is no built-in hard spend cap — gating is
  the responsibility of the calling agent/governor.

### Untrusted input

- Prompts and parameters originate from a model/agent and should be treated as
  untrusted. The server validates tool inputs with zod schemas and constrains
  numeric ranges, but operators should still budget spend and review which
  agents can reach this server.

### Media bytes

- The server does **not** stream large media bytes through the MCP protocol; it
  returns URLs/refs and metadata. Image data URLs are only included inline when
  the caller explicitly opts in (`return_data_url: true`).

If you believe any of these boundaries can be bypassed, please report it via the
private advisory link above.
