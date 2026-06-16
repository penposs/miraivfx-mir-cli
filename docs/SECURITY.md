# Security Model

`mir-cli` is a user-authorized client for Miraivfx APIs.

## Authentication

- `mir-cli auth login` opens a browser-based Miraivfx / Logto authorization flow with PKCE.
- The user enters credentials only in the browser.
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
- Generation requires `--allow-generation`.
- Uploading material requires `--allow-upload`.
- Downloading results requires an explicit `--task-id` or `--url`.
- Protected Miraivfx API downloads include the saved user bearer token.
- Download URLs are restricted to trusted Miraivfx hosts by default. Extra approved hosts must be added through `MIRAIVFX_DOWNLOAD_HOSTS`.
- Downloaded filenames are sanitized and existing files are not overwritten.
- Before writing a canvas, the CLI must compare `revision` and `clientModifiedAt` to avoid overwriting browser-side changes.

## Backend Responsibilities

- Resolve the current user from the bearer token.
- Validate project ownership for every `project_id`.
- Validate canvas ownership for every `canvas_id`.
- Validate upload ownership when a `project_id` is provided.
- Return only public model metadata to CLI clients.
