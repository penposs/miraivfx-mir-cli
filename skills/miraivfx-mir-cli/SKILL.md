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
   - `mir-cli canvas models --task audio --json` when creating music or song nodes.
6. Show a concise plan and risk summary before any mutation.
7. Use `mir-cli canvas upload --allow-upload` only when the user explicitly asked to upload a local asset.
8. Use `mir-cli canvas node add --type <node-type> ... --yes` only to append allowed nodes and connections. Read `mir-cli canvas capabilities --json` for supported node types.
9. For music, song, R&B, lyrics, Suno, or audio generation requests, use `mir-cli canvas node add-suno --song-title ... --style ... --lyrics ... --yes --json`. Do not create a plain `text` node for lyrics unless the user explicitly asks for a note only.
10. Use `mir-cli canvas node connect --from-node <asset_node_id> --to-node <generation_node_id> --yes` to reuse an existing asset node across multiple generation nodes.
11. For second versions or creative iteration, prefer `mir-cli canvas node clone --copy-inputs --yes` unless the user explicitly asks to edit the original node.
12. Use `mir-cli canvas node update --node-id <node_id> ... --yes` only after inspecting the canvas and identifying the exact node id.
13. Use `mir-cli canvas node delete --node-id <node_id> --yes` only for exact user-confirmed node ids.
14. Open the canvas for the user to review and run generation in Miraivfx.

## Virtual Shoot Flow

1. Inspect with `mir-cli canvas v-camera inspect --canvas-id <canvas_id> --json`. If multiple nodes are returned, identify the exact `--node-id` before changing anything.
2. Prefer named domain commands over generic `node update --data-json`: `project`, `actor`, `prop`, `camera`, and `cut`.
3. Use `--dry-run` first for multi-entity paths, tracking setups, motion presets, and camera-cut schedules.
4. Use `position` and `rotation` values in `x,y,z` form. Path times are seconds and may use millisecond precision.
5. Use actor/prop/camera `path add`, `path set`, `path delete`, and `path clear` for timed movement.
6. Use `camera follow` for continuous tracking and `camera preset` for push, pull, truck, fixed tracking, lead/chase follow, or orbit shots.
7. Use `cut add --time` for timeline switching. For actor-path switching, pass both `--actor` and `--point`; the CLI derives the cut time from that point.
8. Never use generic node data updates to change `vCameraProject`; the dedicated endpoint preserves takes and rejects stale canvas revisions.

## Direct Field Mapping

- Prefer direct flags over `--data-json` for common generation fields.
- Treat node headers, width, height, and positions as visual appearance. Do not change them while filling node form fields unless the user explicitly asks for a layout or visual-label change.
- Use `--node-title` only for intentional node header renames. Do not use `--title` for node headers.
- Suno: `--lyrics`, `--song-title`, `--title`, `--style`/`--tags`, `--negative-tags`, `--description`, `--version`, `--mode`, `--instrumental`. For Suno, `--title` means song title; use `--node-title` only when intentionally renaming the canvas node header.
- Image/video: `--ratio`/`--aspect-ratio`, `--resolution`/`--size`, `--duration`, `--negative-prompt`, `--video-service`, `--video-model`, `--video-size`.
- Seedance video: `--ratio`, `--resolution`, `--duration`, `--api-key`, `--generate-audio`/`--no-audio`, `--real-person-mode`/`--no-real-person-mode`, `--conversion-slots`, `--seed`.
- RunningHub: `--webapp-id`, `--api-key`, `--environment`, `--values-json`.
- Action nodes: use `--upscale-resolution`, `--resize-mode`, `--resize-width`, `--resize-height`, `--split-rows`, `--split-cols`, `--source-video-url`, `--current-frame-time`, `--supplement-prompt`, and `--quality` when applicable.

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
- Do not trigger generation, retry tasks, poll task status, or download results from the CLI.
- Do not control anything outside the user's Miraivfx canvas workflow.
- Do not write hidden system fields or completed statuses for generation/action nodes.
- Do not edit Virtual Shoot takes, recording uploads, result nodes, task ids, or billing data. The Virtual Shoot command group is scene-control only.
- Preserve run directories and execution logs.
