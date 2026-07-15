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
For Suno nodes, `--title` is treated as the song title for compatibility. Node headers are visual labels; use `--node-title` only when you intentionally want to rename a canvas node header.

Common direct field mappings:

- Image/video nodes: `--aspect-ratio`/`--ratio`, `--resolution`/`--size`, `--duration`, `--negative-prompt`, `--video-service`, `--video-model`, `--video-size`, `--veo-mode`, `--veo-model`, `--veo-aspect-ratio`.
- LLM/agent/Seedance prompt nodes: `--mode`, `--system-prompt`, `--llm-model`, `--hide-output`.
- Seedance video nodes: `--ratio`, `--resolution`, `--duration`, `--api-key`, `--generate-audio`/`--no-audio`, `--watermark`/`--no-watermark`, `--real-person-mode`/`--no-real-person-mode`, `--return-last-frame`, `--conversion-slots`, `--seed`.
- Action nodes: `add-upscale --upscale-resolution`, `add-resize --resize-mode --resize-width --resize-height`, `add-frame-extractor --source-video-url --current-frame-time`, `add-smart-split --split-rows --split-cols --upscale2k`, `add-panorama-gen --supplement-prompt --quality`.
- RunningHub nodes: `--webapp-id`, `--api-key`, `--environment`, and `--values-json` map into `data.runninghub`.

Common aliases include `add-text`, `add-video`, `add-audio`, `add-video-reference`, `add-agent`, `add-suno`, `add-seedance`, `add-seedance-volc`, `add-seedance-rh`, `add-vibex`, `add-runninghub`, `add-pro-camera`, `add-panorama-gen`, `add-blocking-3d`, `add-drawing-board`, `add-frame-extractor`, `add-upscale`, `add-resize`, `add-smart-split`, `add-panorama-split`, and `add-relay`.

## Virtual Shoot

Create and inspect:

```powershell
mir-cli canvas v-camera create --canvas-id <canvas_id> --yes --json
mir-cli canvas v-camera inspect --canvas-id <canvas_id> --json
mir-cli canvas v-camera inspect --canvas-id <canvas_id> --node-id <node_id> --json
mir-cli canvas node add-v-camera --canvas-id <canvas_id> --yes --json
```

When a canvas contains more than one Virtual Shoot node, pass `--node-id` on every inspect or mutation command.

Project settings:

```powershell
mir-cli canvas v-camera project set --canvas-id <canvas_id> --name "Stage A" --fps 24 --duration 30 --safe-frame 16:9 --yes --json
```

Actors:

```powershell
mir-cli canvas v-camera actor add --canvas-id <canvas_id> --name "Hero" --position "0,0,0" --rotation "0,0,0" --height 1.75 --yes --json
mir-cli canvas v-camera actor set --canvas-id <canvas_id> --actor "Hero" --position "2,0,4" --rotation "0,45,0" --yes --json
mir-cli canvas v-camera actor delete --canvas-id <canvas_id> --actor "Hero" --yes --json
```

Props:

```powershell
mir-cli canvas v-camera prop add --canvas-id <canvas_id> --preset thin_wall --name "Back wall" --position "0,0.85,-3" --scale "4,1.7,0.12" --yes --json
mir-cli canvas v-camera prop set --canvas-id <canvas_id> --prop "Back wall" --rotation "0,45,0" --visible true --locked false --yes --json
mir-cli canvas v-camera prop delete --canvas-id <canvas_id> --prop "Back wall" --yes --json
```

Supported prop presets are `box`, `thin_wall`, `column`, `platform`, `obstacle`, `door_frame`, `stairs`, and `slope`. Stairs accept `--steps 2..64`.

Cameras:

```powershell
mir-cli canvas v-camera camera add --canvas-id <canvas_id> --name "Camera A" --position "0,1.6,6" --rotation "0,180,0" --fov 35 --duration 8 --yes --json
mir-cli canvas v-camera camera set --canvas-id <canvas_id> --camera "Camera A" --position "1,1.8,5" --fov 45 --yes --json
mir-cli canvas v-camera camera follow --canvas-id <canvas_id> --camera "Camera A" --actor "Hero" --tracking-point chest --offset "0,1.6,3" --speed 6 --yes --json
mir-cli canvas v-camera camera preset --canvas-id <canvas_id> --camera "Camera A" --actor "Hero" --preset push_in --duration 6 --yes --json
mir-cli canvas v-camera camera delete --canvas-id <canvas_id> --camera "Camera A" --yes --json
```

Motion presets are `push_in`, `pull_out`, `truck_left`, `truck_right`, `fixed_tracking`, `lead_follow`, `chase_follow`, `orbit_left`, and `orbit_right`. Presets generate the same path/follow fields used by the web editor.

Actor, prop, and camera paths share the same commands:

```powershell
mir-cli canvas v-camera actor path add --canvas-id <canvas_id> --actor "Hero" --time 2.125 --position "2,0,4" --yaw 45 --yes --json
mir-cli canvas v-camera camera path set --canvas-id <canvas_id> --camera "Camera A" --points-json '[{"time":0,"position":[0,1.6,6]},{"time":5.25,"position":[2,1.6,3]}]' --yes --json
mir-cli canvas v-camera prop path delete --canvas-id <canvas_id> --prop "Platform 1" --point <point_id> --yes --json
mir-cli canvas v-camera actor path clear --canvas-id <canvas_id> --actor "Hero" --yes --json
```

Camera cuts:

```powershell
mir-cli canvas v-camera cut add --canvas-id <canvas_id> --camera "Camera A" --time 4.5 --yes --json
mir-cli canvas v-camera cut add --canvas-id <canvas_id> --camera "Camera B" --actor "Hero" --point <path_point_id> --yes --json
mir-cli canvas v-camera cut delete --canvas-id <canvas_id> --cut <cut_id> --yes --json
mir-cli canvas v-camera cut clear --canvas-id <canvas_id> --yes --json
```

Anchored cuts derive their time from the selected actor path point. All mutations require `--yes`; use `--dry-run` instead to calculate and print the exact project patch without writing. The dedicated endpoint requires the inspected canvas revision and rejects concurrent web edits. It cannot change takes, recording uploads, media results, task ids, billing fields, or ordinary canvas nodes.

## Connect And Disconnect

```powershell
mir-cli canvas node connect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
mir-cli canvas node disconnect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
mir-cli canvas node disconnect --canvas-id <canvas_id> --connection-id <connection_id> --yes --json
```

Use connections to reuse shared assets across multiple generation nodes.

## Update Existing Nodes

```powershell
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --node-title "New node header" --yes --json
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --prompt "Updated prompt" --yes --json
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --data-json "{\"ratio\":\"16:9\",\"duration\":\"15\"}" --yes --json
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --x 900 --y 120 --width 420 --height 580 --yes --json
```

Before updating, agents should inspect the canvas and identify the exact node id. Prefer adding a new version with `clone` unless the user explicitly asks to edit the original node.

## Clone For Iteration

```powershell
mir-cli canvas node clone --canvas-id <canvas_id> --node-id <node_id> --node-title "Shot 03 v2" --copy-inputs --yes --json
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
