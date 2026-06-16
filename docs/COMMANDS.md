# Command Plan

## Auth

```powershell
mir-cli auth status
mir-cli auth login
mir-cli auth logout
```

`auth login` uses browser OAuth/PKCE and listens on `MIRAIVFX_AUTH_REDIRECT_URI`, defaulting to `http://127.0.0.1:39173/callback`. The default Logto app id is `kdj75szqjfbqcn6pzbtzu` for the dedicated `Miraivfx MIR CLI` single-page app. Local development can still use `MIRAIVFX_TOKEN` from the shell environment. Agents must not request or display raw tokens.

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

## Canvas Node Mutations

```powershell
mir-cli canvas node add --canvas-id <canvas_id> --type text --content "Planning note" --yes --json
mir-cli canvas node add --canvas-id <canvas_id> --type video --prompt "A cinematic shot" --model <model_id> --yes --json
mir-cli canvas node add --canvas-id <canvas_id> --type suno --prompt "Song idea" --data-json "{\"sunoMode\":\"description\"}" --yes --json
mir-cli canvas node add --canvas-id <canvas_id> --type seedance2-rh-standard --prompt "Video prompt" --data-json "{\"ratio\":\"16:9\",\"duration\":\"5\"}" --yes --json
mir-cli canvas node add-image --canvas-id <canvas_id> --prompt "A product photo" --model <model_id> --yes --json
mir-cli canvas node add-image --canvas-id <canvas_id> --prompt "A product photo" --model <model_id> --yes --open --json
mir-cli canvas node add-image --canvas-id <canvas_id> --prompt "A product photo" --model <model_id> --settings-json "{\"size\":\"1024x1024\"}" --yes --json
mir-cli canvas node add-reference-image --canvas-id <canvas_id> --url <uploaded_image_url> --connect-to <image_node_id> --yes --json
```

`canvas node add --type <node-type>` is the generic safe node creation command. Supported types come from `mir-cli canvas capabilities --json` and currently cover the Miraivfx canvas `NodeType` set, including sidebar nodes such as `image`, `image-item`, `video`, `pro-camera`, `text`, `agent`, `suno`, `seedance`, `seedance-volc`, `seedance2-rh-standard`, `runninghub`, `panorama-gen`, and `blocking-3d`.

Common aliases are also available: `add-text`, `add-video`, `add-audio`, `add-video-reference`, `add-agent`, `add-suno`, `add-seedance`, `add-seedance-volc`, `add-seedance-rh`, `add-runninghub`, `add-pro-camera`, `add-panorama-gen`, `add-blocking-3d`, `add-drawing-board`, `add-frame-extractor`, `add-upscale`, `add-resize`, `add-smart-split`, `add-panorama-split`, and `add-relay`.

`canvas node add-image` creates a saved `image` generation node using the existing Miraivfx canvas schema. It checks the selected model against `/api/canvas/models?task=image`, writes the node with `status=idle`, and does not start generation. Add `--open` to open the Miraivfx canvas page after the node is saved.

`canvas node add-reference-image` creates a visible `image-item` node from an uploaded or trusted image URL. Use `--connect-to` when the reference image should feed a generation node on the canvas.

Node mutation commands use the backend canvas ops endpoint. They append nodes and connections to the latest server canvas and do not PUT a complete `nodes/connections` snapshot.

## Capabilities And Models

```powershell
mir-cli canvas capabilities --json
mir-cli canvas models --task image --json
mir-cli canvas models --task video --json
```

`canvas models` reads the CLI-safe `/api/canvas/models` endpoint. It should not use the broader website `/api/models` registry because that response may contain internal routing fields used by the web app.

## Materials And Tasks

```powershell
mir-cli canvas upload --project-id <project_id> --file ./ref.png --allow-upload --json
```

Uploads are allowed only after the caller passes `--allow-upload`. When a `project_id` is provided, the backend verifies that the project belongs to the current logged-in user before storing the file under that project.

`canvas status` and `canvas download` are intentionally disabled in the first release. Users inspect task state and download results from the Miraivfx web canvas.

## Planning And Execution

```powershell
mir-cli canvas plan --json
mir-cli canvas deploy --json
mir-cli canvas run --json
```

`canvas plan`, `canvas deploy`, and `canvas run` currently return `manual_web_only`. The first release is a safe canvas builder: it can log in, list/create projects, list/create/open/inspect canvases, discover CLI-safe model metadata, upload assets, and append allowed canvas nodes. Generation submission remains a manual web action.
