# Miraivfx MIR CLI

`mir-cli` lets AI assistants such as Codex, Claude, and Cursor Agent help users organize Miraivfx projects and canvases from the command line.

Use it to create projects, create canvases, upload assets, read available models, add canvas nodes, connect assets to generation nodes, and keep creative workflows tidy. The CLI is designed for agent-assisted canvas setup and iteration. Users still review the canvas in Miraivfx before running generation.

## Install

```powershell
npm i -g @miraivfx/mir-cli
```

Or run without installing:

```powershell
npx @miraivfx/mir-cli --help
```

## Quick Start

```powershell
mir-cli auth status
mir-cli auth login
mir-cli project list --json
mir-cli canvas list --project-id <project_id> --json
mir-cli canvas create --project-id <project_id> --name "Storyboard" --json
mir-cli canvas open --canvas-id <canvas_id>
```

## Common Canvas Actions

```powershell
mir-cli canvas capabilities --json
mir-cli canvas models --task video --json
mir-cli canvas inspect --canvas-id <canvas_id> --summary
mir-cli canvas inspect --canvas-id <canvas_id> --json
```

Add nodes and connect references:

```powershell
mir-cli canvas node add --canvas-id <canvas_id> --type text --content "Planning note" --yes --json
mir-cli canvas node add --canvas-id <canvas_id> --type seedance2-rh-standard --prompt "Video prompt" --data-json "{\"ratio\":\"16:9\",\"duration\":\"12\"}" --yes --json
mir-cli canvas upload --project-id <project_id> --file ./character.png --allow-upload --json
mir-cli canvas node add-reference-image --canvas-id <canvas_id> --url <uploaded_image_url> --yes --json
mir-cli canvas node connect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
```

Iterate on existing work:

```powershell
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --prompt "Updated prompt" --yes --json
mir-cli canvas node clone --canvas-id <canvas_id> --node-id <node_id> --copy-inputs --title "Shot 03 v2" --yes --json
mir-cli canvas node disconnect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
mir-cli canvas node delete --canvas-id <canvas_id> --node-id <node_id> --yes --json
```

## Agent Workflow

A good agent flow is:

1. Confirm the user is logged in.
2. List or create the target project and canvas.
3. Inspect the canvas before editing existing nodes.
4. Read current model and node capabilities.
5. Upload each unique local asset once.
6. Place shared assets on the left side of the canvas.
7. Place generation or action nodes on the right side in workflow order.
8. Reuse assets by connecting the same asset node to multiple generation nodes.
9. Prefer cloning a node for a new version unless the user explicitly asks to overwrite the original.
10. Open the Miraivfx canvas so the user can review and run generation manually.

## Safety And Control

- The user logs in through the browser.
- Commands that change the canvas require explicit flags such as `--yes` or `--allow-upload`.
- The CLI edits canvases with small operations instead of replacing the whole canvas.
- Generation submission, task polling, and result downloads are handled in the Miraivfx web app.
- Agents should not ask users for passwords or raw tokens.
- Agents should inspect the current canvas before editing existing nodes.

## More Documentation

- `docs/COMMANDS.md`: command reference.
- `skills/miraivfx-mir-cli/SKILL.md`: agent operating rules.
