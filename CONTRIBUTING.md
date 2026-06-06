# Contributing to `openrouter-media`

Thanks for taking the time to contribute. This is an **MCP server** that exposes
[OpenRouter](https://openrouter.ai)'s image and asynchronous video generation as
tools, bundled with companion `SKILL.md` skills. It speaks the
[Model Context Protocol](https://modelcontextprotocol.io) over stdio.

This guide covers everything you need to get a development environment running,
make a change, and open a pull request that's easy to review and merge.

## Table of contents

- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Development workflow](#development-workflow)
- [How the test suite works](#how-the-test-suite-works)
- [Verifying against the live API](#verifying-against-the-live-api)
- [Coding conventions](#coding-conventions)
- [Commit messages](#commit-messages)
- [Pull request process](#pull-request-process)
- [Security](#security)
- [License](#license)

## Prerequisites

- **Node.js >= 20.** The package is ESM-only and targets modern Node.
- **npm** (ships with Node). The repo is committed with an npm lockfile.
- An **OpenRouter API key** (`OPENROUTER_API_KEY`) if you want to exercise the
  live catalog or actually generate media. Unit tests do **not** require a key
  or network access.

## Getting started

```sh
git clone https://github.com/HLLMR/openrouter-media.git
cd openrouter-media
npm install
npm run typecheck   # fast type-only pass, no emit
npm test            # compiles + runs the node:test unit tests
npm run build       # emits dist/
```

If all four commands pass on a clean clone, your environment is ready.

## Project layout

```
src/
  index.ts                  # constants + library re-exports (pure building blocks)
  server.ts                 # the MCP stdio server (the bin) — tool wiring
  openrouter/
    client.ts               # the only module that talks to the network
    fetch-catalog.ts         # live image + video catalog fetch (cached)
    catalog.ts              # pure parsers for /models (image) + /videos/models
    cost.ts                 # pure cost estimators (image tokens, video per-second SKUs)
    poll.ts                 # pure async-video poll-state machine
    images.ts               # pure image-response parser (data URL extraction)
    generate-image.ts        # image generation network call
    videos.ts               # video submit/poll + the sync poll-loop driver
    *.test.ts               # node:test unit tests, colocated with the code
skills/                     # companion SKILL.md procedures (shipped in the package)
scripts/
  run-tests.mjs             # cross-version node:test runner
  smoke-mcp.mjs             # live MCP smoke test (dev only; not published)
```

The public entrypoints are the two `exports` in `package.json`: `.` (the pure
library surface) and `./server` (the MCP server factory). The `bin`
(`openrouter-media`) runs `dist/server.js` as a stdio MCP server.

**Design rule:** only `openrouter/client.ts` performs network I/O. Everything
else is pure transforms over data, which is what keeps the unit tests hermetic.

## Development workflow

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — strict type check, no output. Run this constantly. |
| `npm test` | `tsc` (full compile to `dist/`) then `node` over the compiled tests. |
| `npm run build` | `tsc -p tsconfig.build.json` — production emit to `dist/` (no tests). |
| `npm start` | run the stdio server locally. |
| `npm run clean` | removes `dist/`. |

## How the test suite works

Tests use the built-in **`node:test`** runner and `node:assert` — no third-party
framework.

- Test files are colocated with the code they cover and named `*.test.ts`.
- `npm test` first runs `tsc` (compiling tests included into `dist/`), then runs
  the compiled `*.test.js` via `scripts/run-tests.mjs`. The runner executes the
  compiled JavaScript, so a type error fails `npm test` before any test runs.
- Keep unit tests **hermetic** — no network, no live OpenRouter calls. The async
  video loop is tested with a fake client and an injected no-op `sleep`; stub at
  the `OpenRouterClient` boundary so the suite stays fast and deterministic.

## Verifying against the live API

For changes that touch request/response shapes, verify against the real API
(never a mock you wrote from memory):

```sh
export OPENROUTER_API_KEY="sk-or-v1-..."
npm run build
node scripts/smoke-mcp.mjs list     # tools + live catalog
node scripts/smoke-mcp.mjs image    # a cheap live image
node scripts/smoke-mcp.mjs video    # cheapest viable live video (costs pennies)
```

Video is billed per second — keep live tests to the cheapest/shortest/lowest-res
option. The real cost is reported in the tool output.

## Coding conventions

- **TypeScript, strict.** `strict` and `noUncheckedIndexedAccess` are on. Don't
  loosen compiler options to compile; fix the types. Prefer `unknown` at
  boundaries and narrow.
- **ESM only.** `"type": "module"`, `verbatimModuleSyntax`. Use file extensions
  in relative imports (`Node16` resolution) and `import type` for types.
- **Comment thoroughly.** Explain *why*, not just *what* — modules here carry
  generous comments by design.
- **No secrets in logs.** Diagnostics go to **stderr** (stdout is the MCP
  channel) and never include the API key.
- **Keep the contracts stable.** Changes to the `.` / `./server` exports, the bin,
  or a tool's name/schema are breaking — flag them.

## Commit messages

This repo uses **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<optional scope>): <short summary>
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`,
`build`, `ci`. Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.

## Pull request process

1. Fork and branch off `main` (e.g. `feat/seedance-cost-sku`).
2. Make your change with accompanying tests and doc updates.
3. Ensure the full local gate passes: `npm run typecheck` and `npm test`.
4. Use a Conventional Commit PR title and fill out the PR template.
5. Link the issue (`Closes #123`). Keep PRs focused.

## Security

Never commit an API key. Report vulnerabilities privately — see
[SECURITY.md](SECURITY.md).

## License

By contributing you agree your contributions are licensed under the project's
[MIT License](LICENSE).
