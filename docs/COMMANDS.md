# Command Reference

## Auth

```powershell
mir-cli auth status
mir-cli auth login
mir-cli auth login --no-open
mir-cli auth login --browser edge
mir-cli auth login --force
mir-cli auth switch
mir-cli auth logout
```

Use `auth login` to sign in through the browser. Agents must not ask users for passwords or raw tokens.
Use `auth login --no-open` to print a real sign-in URL and wait for the callback; open the URL in another browser, incognito window, or browser profile to keep CLI sign-in separate from the website session.
Use `auth login --browser edge`, `--browser chrome`, `--browser firefox`, `MIRAIVFX_AUTH_BROWSER`, or `--browser-command "msedge --inprivate {url}"` to choose where the sign-in page opens.
Use `auth switch` or `auth login --force` to change accounts; this clears the local session and sends `prompt=login` to the browser authorization flow.

## Projects

```powershell
mir-cli project list --json
mir-cli project create --name "Project name" --json
mir-cli project open --project-id <project_id>
```

## Canvases

```powershell
mir-cli canvas list --project-id <project_id> --json
mir-cli canvas list --all --json
mir-cli canvas create --project-id <project_id> --name "Canvas name" --json
mir-cli canvas open --canvas-id <canvas_id>
mir-cli canvas inspect --canvas-id <canvas_id> --summary
mir-cli canvas inspect --canvas-id <canvas_id> --json
```

Use `--summary` first. Use full JSON inspection only when the user asks to read or edit canvas details.

## Models And Capabilities

```powershell
mir-cli canvas capabilities --json
mir-cli canvas models --task image --json
mir-cli canvas models --task video --json
mir-cli canvas models --task audio --json
mir-cli canvas models --task llm --json
```

Agents should read model metadata before choosing model names or parameters.

## Uploads

```powershell
mir-cli canvas upload --project-id <project_id> --file ./ref.png --allow-upload --json
```

Upload each unique local asset once per canvas-building operation. Reuse it with connections instead of creating duplicate material nodes.
The CLI caches uploads by local file sha256 and project id. Use `--force-upload` only when you intentionally need to upload the same file again.

## Add Nodes

```powershell
mir-cli canvas node add --canvas-id <canvas_id> --type text --content "Planning note" --yes --json
mir-cli canvas node add --canvas-id <canvas_id> --type video --prompt "A cinematic shot" --model <model_id> --yes --json
mir-cli canvas node add-seedance-rh --canvas-id <canvas_id> --prompt "Video prompt" --ratio "16:9" --duration 12 --resolution 720p --yes --json
mir-cli canvas node add-suno --canvas-id <canvas_id> --song-title "Velvet Afterglow" --style "R&B, smooth soul" --lyrics "[Verse]..." --yes --json
mir-cli canvas node add-reference-image --canvas-id <canvas_id> --url <uploaded_image_url> --yes --json
```

Supported node types are reported by `mir-cli canvas capabilities --json`.
When `--x`/`--y` are omitted, the CLI picks a non-overlapping position from the current canvas. `add-reference-image` reuses an existing material node with the same URL by default; use `--force-new` or `--duplicate` only when a second visible copy is intentional.
Use `add-suno` for music or song generation. It accepts `--lyrics`, `--song-title`, `--style`/`--tags`, `--negative-tags`, `--description`, `--version`, `--mode`, and `--instrumental`, and maps them to the Suno node fields used by the web canvas.

Common direct field mappings:

- Image/video nodes: `--aspect-ratio`/`--ratio`, `--resolution`/`--size`, `--duration`, `--negative-prompt`, `--video-service`, `--video-model`, `--video-size`, `--veo-mode`, `--veo-model`, `--veo-aspect-ratio`.
- LLM/agent/Seedance prompt nodes: `--mode`, `--system-prompt`, `--llm-model`, `--hide-output`.
- Seedance video nodes: `--ratio`, `--resolution`, `--duration`, `--api-key`, `--generate-audio`/`--no-audio`, `--watermark`/`--no-watermark`, `--real-person-mode`/`--no-real-person-mode`, `--return-last-frame`, `--conversion-slots`, `--seed`.
- Action nodes: `add-upscale --upscale-resolution`, `add-resize --resize-mode --resize-width --resize-height`, `add-frame-extractor --source-video-url --current-frame-time`, `add-smart-split --split-rows --split-cols --upscale2k`, `add-panorama-gen --supplement-prompt --quality`.
- RunningHub nodes: `--webapp-id`, `--api-key`, `--environment`, and `--values-json` map into `data.runninghub`.

Common aliases include `add-text`, `add-video`, `add-audio`, `add-video-reference`, `add-agent`, `add-suno`, `add-seedance`, `add-seedance-volc`, `add-seedance-rh`, `add-vibex`, `add-runninghub`, `add-pro-camera`, `add-panorama-gen`, `add-blocking-3d`, `add-drawing-board`, `add-frame-extractor`, `add-upscale`, `add-resize`, `add-smart-split`, `add-panorama-split`, and `add-relay`.

## Connect And Disconnect

```powershell
mir-cli canvas node connect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
mir-cli canvas node disconnect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
mir-cli canvas node disconnect --canvas-id <canvas_id> --connection-id <connection_id> --yes --json
```

Use connections to reuse shared assets across multiple generation nodes.

## Update Existing Nodes

```powershell
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --title "New title" --yes --json
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --prompt "Updated prompt" --yes --json
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --data-json "{\"ratio\":\"16:9\",\"duration\":\"15\"}" --yes --json
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --x 900 --y 120 --width 420 --height 580 --yes --json
```

Before updating, agents should inspect the canvas and identify the exact node id. Prefer adding a new version with `clone` unless the user explicitly asks to edit the original node.

## Clone For Iteration

```powershell
mir-cli canvas node clone --canvas-id <canvas_id> --node-id <node_id> --title "Shot 03 v2" --copy-inputs --yes --json
mir-cli canvas node clone --canvas-id <canvas_id> --node-id <node_id> --prompt "More cinematic version" --x 1400 --y 600 --copy-inputs --yes --json
```

Use `clone` for second versions, alternate prompts, or parameter experiments. `--copy-inputs` reuses the source node's incoming asset connections.

## Delete Nodes

```powershell
mir-cli canvas node delete --canvas-id <canvas_id> --node-id <node_id> --yes --json
```

Delete only exact node ids. Agents should summarize what will be deleted before running the command when several nodes are involved.

## Layout Rules

- Put shared assets on the left side of the canvas.
- Put generation/action nodes on the right side in workflow order.
- Leave room beside generation nodes for future result nodes.
- Do not duplicate identical asset nodes in one operation.
- Keep spacing readable: no overlapping nodes and no excessive blank space.

## Canvas Results

```powershell
mir-cli canvas results list --canvas-id <canvas_id> --json
mir-cli canvas results download --canvas-id <canvas_id> --output ./downloads --json
mir-cli canvas results watch --canvas-id <canvas_id> --output ./downloads --interval 15 --timeout 7200 --json
```

Result commands only read completed final media from the explicit canvas id. They do not download all projects, all canvases, history records, source assets, provider responses, storage keys, or internal task data.

## Web-Only Actions

```powershell
mir-cli canvas status --json
mir-cli canvas download --json
mir-cli canvas run --json
```

These broad commands are intentionally web-only. Users review the Miraivfx canvas and run generation in the browser.
