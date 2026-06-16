# Security Model

`mir-cli` is a user-authorized client for Miraivfx APIs.

## Authentication

- `mir-cli auth login` should open a browser-based Miraivfx / Logto authorization flow.
- The user enters credentials only in the browser.
- The CLI stores local authorization data in a secure local store.
- Agent tools must never receive passwords or raw tokens.

## Data Access

- `project list` and `canvas list` return summaries by default.
- `canvas open` only opens the website.
- `canvas inspect --summary` returns metadata and node statistics.
- `canvas inspect --json` returns full node parameters and should be called only when the user explicitly asks for it.

## Mutations

- Creating or updating canvas nodes requires explicit confirmation.
- Generation requires `--allow-generation`.
- Uploading material requires `--allow-upload`.
- Before writing a canvas, the CLI must compare `revision` and `clientModifiedAt` to avoid overwriting browser-side changes.

## Backend Responsibilities

- Resolve the current user from the bearer token.
- Validate project ownership for every `project_id`.
- Validate canvas ownership for every `canvas_id`.
- Validate upload ownership when a `project_id` is provided.
- Return only public model metadata to CLI clients.
