# Miraivfx MIR CLI Skill

Use this skill when the user asks an agent to operate Miraivfx projects, canvases, canvas nodes, model discovery, uploads, or safe canvas setup through `mir-cli`.

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
7. Use `mir-cli canvas upload --allow-upload` only when the user explicitly asked to upload a local asset.
8. Use `mir-cli canvas node add --type <node-type> ... --yes` only to append allowed nodes and connections. Read `mir-cli canvas capabilities --json` for supported node types.
9. Use `mir-cli canvas node connect --from-node <asset_node_id> --to-node <generation_node_id> --yes` to reuse an existing asset node across multiple generation nodes.
10. Open the canvas for the user to manually submit generation, inspect task status, and download results.

## Canvas Layout And Asset Reuse Rules

- In one canvas-building operation, upload each unique local asset once and create at most one visible material node for that asset. Reuse it by adding connections to every generation/action node that needs it.
- Treat the left side of the layout as the shared asset library: place role, scene, prop, audio, and file reference nodes in compact columns with stable spacing.
- Treat the right side as the generation lane: place image/video/audio/Seedance/RunningHub/action nodes in timeline order, with enough horizontal space to their right or lower-right for future result nodes.
- For storyboard or multi-shot work, do not duplicate identical asset nodes inside every shot group. Create one shared asset node and connect it to multiple shot nodes.
- Keep groups readable but compact: avoid overlapping nodes, avoid excessive blank space, and reserve a small gap between shot groups so generated result nodes can be added later without covering prompts or references.
- Prefer deterministic coordinates in grids or lanes. Agents should compute positions before mutating the canvas instead of relying on manual drag cleanup.

## Safety Rules

- Do not ask for the user's password.
- Do not ask the user to paste tokens.
- Do not read browser localStorage.
- Do not access the database directly.
- Do not trigger generation, retry tasks, poll task status, or download results from the CLI.
- Do not write task IDs, result URLs, billing fields, API keys, endpoints, admin flags, or completed statuses for generation/action nodes.
- Preserve run directories and execution logs.
