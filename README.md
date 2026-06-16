# Miraivfx MIR CLI

`mir-cli` is an agent-friendly command line interface for Miraivfx projects, canvases, model discovery, uploads, task status, and result downloads.

The primary users are Codex, Claude, Cursor Agent, and similar tools. The CLI exposes stable commands and machine-readable JSON so agents can help users list projects, open canvases, inspect canvas summaries, create plans, and execute confirmed canvas changes.

## Install

```powershell
npm i -g @miraivfx/mir-cli
```

Or run without installing:

```powershell
npx @miraivfx/mir-cli --help
```

## Typical Flow

```powershell
mir-cli auth status
mir-cli auth login
mir-cli project list --json
mir-cli canvas list --project-id <project_id> --json
mir-cli canvas open --canvas-id <canvas_id>
mir-cli canvas capabilities --json
mir-cli canvas models --task image --json
mir-cli canvas inspect --canvas-id <canvas_id> --summary
mir-cli canvas upload --project-id <project_id> --file ./ref.png --allow-upload --json
mir-cli canvas status --task-id <task_id> --json
mir-cli canvas download --task-id <task_id> --out ./downloads
```

During the first API integration phase, configure local API settings with environment variables:

```powershell
$env:MIRAIVFX_API_BASE = "https://miraivfx.com/api"
$env:MIRAIVFX_APP_BASE = "https://miraivfx.com"
$env:MIRAIVFX_TOKEN = "<local-only bearer token>"
```

`MIRAIVFX_TOKEN` is a temporary local bridge until browser OAuth/PKCE login is implemented. Do not paste tokens into agent chats and do not commit them.

Full node parameters require an explicit command:

```powershell
mir-cli canvas inspect --canvas-id <canvas_id> --json
```

## Safety Rules

- The CLI must not ask for user passwords.
- The CLI must not ask users to paste tokens into agent chats.
- The CLI must not read browser localStorage.
- The CLI must not access the database directly.
- Summary commands should be used before full node inspection.
- Uploads require `--allow-upload`.
- Mutations require explicit confirmation flags such as `--yes` or `--allow-generation`.
- Project and canvas access must be enforced by the Miraivfx backend.

## Repository Status

This is the initial scaffold. API calls and authentication are intentionally stubbed until the Miraivfx backend endpoints and auth flow are finalized.
