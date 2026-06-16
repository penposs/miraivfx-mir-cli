# Security Model

`mir-cli` is a user-authorized client for Miraivfx APIs.

## Authentication

- `mir-cli auth login` opens a browser-based Miraivfx / Logto authorization flow with PKCE.
- The user enters credentials only in the browser.
- The CLI defaults to the dedicated `Miraivfx MIR CLI` Logto single-page app id `kdj75szqjfbqcn6pzbtzu`.
- Deployments can override the application id through `MIRAIVFX_LOGTO_APP_ID` or `MIRAIVFX_AUTH_CLIENT_ID`.
- The CLI must not silently reuse the website Logto application id.
- The CLI stores local authorization data under the user's home directory as a first implementation. A system keychain backend should replace this before broad distribution.
- Agent tools must never receive passwords or raw tokens.
- `MIRAIVFX_TOKEN` is allowed only as a local development bridge.

## Data Access

- `project list` and `canvas list` return summaries by default.
- `canvas open` only opens the website.
- `canvas inspect --summary` returns metadata and node statistics.
- `canvas inspect --json` returns full node parameters and should be called only when the user explicitly asks for it.
- `canvas models` uses the CLI-safe `/api/canvas/models` endpoint, which omits internal endpoints, upstream model IDs, status endpoint patterns, base URL overrides, and API key pool fields.

## Mutations

- Creating or updating canvas nodes requires explicit confirmation.
- `canvas node add-image` requires `--yes`, validates the requested image model against the CLI-safe model endpoint, writes `status=idle`, and does not submit a generation task.
- Node creation commands call backend canvas ops so they append nodes and connections to the latest server canvas instead of PUT-ing a full stale canvas snapshot.
- Uploading material requires `--allow-upload`.
- Generation submission, task status inspection, and result downloads are web-only actions in the first release.
- `canvas status`, `canvas download`, `canvas plan`, `canvas deploy`, and `canvas run` return `manual_web_only` and do not call task or download APIs.
- Full-canvas saves are for the website and must be protected by backend `baseRevision` checks. CLI node mutations should use ops endpoints.

## Backend Responsibilities

- Restrict the dedicated CLI Logto app id to the allowed API route list.
- Resolve the current user from the bearer token.
- Validate project ownership for every `project_id`.
- Validate canvas ownership for every `canvas_id`.
- Validate upload ownership when a `project_id` is provided.
- Return only public model metadata to CLI clients.
- Validate canvas ops by node type, status, and safe data fields so CLI clients cannot write task, billing, upstream, or internal result fields.
