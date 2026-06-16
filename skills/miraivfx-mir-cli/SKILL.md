# Miraivfx MIR CLI Skill

Use this skill when the user asks an agent to operate Miraivfx projects, canvases, canvas nodes, model discovery, uploads, task status, or result downloads through `mir-cli`.

## Required Flow

1. Check login with `mir-cli auth status`.
2. If not logged in, run `mir-cli auth login` and let the user finish browser login.
3. Use summary commands first:
   - `mir-cli project list --json`
   - `mir-cli canvas list --project-id <project_id> --json`
   - `mir-cli canvas inspect --canvas-id <canvas_id> --summary`
4. Read full node parameters only when the user explicitly asks:
   - `mir-cli canvas inspect --canvas-id <canvas_id> --json`
5. Before planning generation, read current capabilities and model metadata:
   - `mir-cli canvas capabilities --json`
   - `mir-cli canvas models --task image --json`
   - `mir-cli canvas models --task video --json`
6. Show a concise plan and risk summary before any mutation.
7. Run `deploy --yes` only after user confirmation.
8. Run generation only after separate confirmation with `--allow-generation`.

## Safety Rules

- Do not ask for the user's password.
- Do not ask the user to paste tokens.
- Do not read browser localStorage.
- Do not access the database directly.
- Do not trigger generation or retry tasks without explicit confirmation.
- Preserve run directories and execution logs.
