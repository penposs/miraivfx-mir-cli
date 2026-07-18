# Miraivfx MIR CLI

`mir-cli` helps you use AI assistants such as Codex, Claude, and Cursor Agent to organize your Miraivfx creative canvas.

You can ask an AI assistant to create projects, create canvases, upload your selected assets, read available models and parameters, add canvas nodes, connect references, and continue editing an existing canvas. The goal is simple: let the assistant build a clear Miraivfx canvas for you, then you open the website to review and run generation.

## What You Can Do

Use `mir-cli` when you want to:

- turn a script into a storyboard canvas
- prepare a video-generation workflow
- organize character, scene, prop, image, video, audio, or text assets
- create image, video, music, and text nodes
- connect multiple model nodes into a production flow
- continue from an existing canvas and add new versions
- read the currently available models and parameters
- create a new project or a new canvas
- keep complex creative work laid out clearly
- set Virtual Shoot actors, lightweight poses, props, camera fields, global paths, shots, and camera cuts

## Install

Current public install:

```powershell
npm i -g github:penposs/miraivfx-mir-cli
```

After the npm package is published, this shorter command will also work:

```powershell
npm i -g @miraivfx/mir-cli
```

## Sign In

```powershell
mir-cli auth login
```

This opens a browser window. Sign in with your Miraivfx account, then return to your terminal or AI assistant.

Keep CLI sign-in separate from your everyday website browser:

```powershell
mir-cli auth login --no-open
```

This prints a real sign-in URL and waits for the callback. Open that URL in another browser, an incognito window, or a separate browser profile if you want the CLI account to stay independent from the Miraivfx website session you use every day.

Open the sign-in page with a specific browser:

```powershell
mir-cli auth login --browser edge
mir-cli auth login --browser chrome
mir-cli auth login --browser firefox
```

You can also set `MIRAIVFX_AUTH_BROWSER=edge` or pass a custom launcher with `{url}`:

```powershell
mir-cli auth login --browser-command "msedge --inprivate {url}"
```

Switch to a different browser account:

```powershell
mir-cli auth switch
```

This clears the local CLI session and asks the browser sign-in page to prompt for account selection again. You can also run `mir-cli auth login --force`.

Check whether you are signed in:

```powershell
mir-cli auth status
```

## Start A Canvas

List your projects:

```powershell
mir-cli project list --json
```

Create a new project:

```powershell
mir-cli project create --name "My Video Project" --json
```

List canvases in a project:

```powershell
mir-cli canvas list --project-id <project_id> --json
```

Create a new canvas:

```powershell
mir-cli canvas create --project-id <project_id> --name "Storyboard" --json
```

Open a canvas in Miraivfx:

```powershell
mir-cli canvas open --canvas-id <canvas_id>
```

## Add And Arrange Nodes

Read supported canvas nodes, models, and parameters:

```powershell
mir-cli canvas capabilities --json
mir-cli canvas models --task video --json
```

Inspect an existing canvas:

```powershell
mir-cli canvas inspect --canvas-id <canvas_id> --summary
mir-cli canvas inspect --canvas-id <canvas_id> --json
```

Add a text note:

```powershell
mir-cli canvas node add --canvas-id <canvas_id> --type text --content "Planning note" --yes --json
```

Group existing nodes, or create a node and its group in one atomic canvas revision:

```powershell
mir-cli canvas group add --canvas-id <canvas_id> --node-ids <node_a>,<node_b> --title "Shot 01" --yes --json
mir-cli canvas node add --canvas-id <canvas_id> --type text --content "Shot note" --group-title "Shot 01" --group-with <existing_node_id> --yes --json
```

`canvas group add` uses strict revision protection. `node add --group-title` submits `add_node` and `add_group` in the same `/ops` request, so a failed member reference cannot leave a partial node or group behind. Use `--dry-run` instead of `--yes` to inspect the exact operations without writing.

Add a video generation node:

```powershell
mir-cli canvas node add-seedance-rh --canvas-id <canvas_id> --prompt "Video prompt" --ratio "16:9" --duration 12 --resolution 720p --yes --json
```

Add a Suno music generation node with custom lyrics:

```powershell
mir-cli canvas node add-suno --canvas-id <canvas_id> --song-title "Velvet Afterglow" --style "R&B, smooth soul, warm bass" --lyrics "[Verse]..." --yes --json
```

Use `add-suno` for music or song generation requests. The CLI writes lyrics into the Suno lyrics field, not a plain text note.
For Suno nodes, `--title` is treated as the song title for compatibility. Node headers are visual labels; use `--node-title` only when you intentionally want to rename a canvas node header.

Common generation node fields can be passed directly without `--data-json`:

```powershell
mir-cli canvas node add-video --canvas-id <canvas_id> --prompt "A cinematic shot" --duration 10 --video-service veo --yes --json
mir-cli canvas node add-upscale --canvas-id <canvas_id> --upscale-resolution 4K --yes --json
mir-cli canvas node add-smart-split --canvas-id <canvas_id> --split-rows 3 --split-cols 4 --upscale2k --yes --json
mir-cli canvas node add-runninghub --canvas-id <canvas_id> --webapp-id <app_id> --api-key <saved_key_name> --values-json "{\"node|field\":\"value\"}" --yes --json
```

Upload a local file you selected:

```powershell
mir-cli canvas upload --project-id <project_id> --file ./character.png --allow-upload --json
```

Uploads are cached by local file sha256 and project id, so repeating the same upload returns the previous URL. Use `--force-upload` when you intentionally need a new upload.

Add an uploaded image as a reference node:

```powershell
mir-cli canvas node add-reference-image --canvas-id <canvas_id> --url <uploaded_image_url> --yes --json
```

Reference image nodes reuse an existing node with the same URL by default. New nodes are placed into the next open canvas position when you omit `--x` and `--y`.

Connect a reference asset to a generation node:

```powershell
mir-cli canvas node connect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
```

## Continue Editing

Update an existing node:

```powershell
mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --prompt "Updated prompt" --yes --json
```

Clone a node for a new version:

```powershell
mir-cli canvas node clone --canvas-id <canvas_id> --node-id <node_id> --copy-inputs --node-title "Shot 03 v2" --yes --json
```

Disconnect two nodes:

```powershell
mir-cli canvas node disconnect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
```

Delete a node:

```powershell
mir-cli canvas node delete --canvas-id <canvas_id> --node-id <node_id> --yes --json
```

## Control Virtual Shoot

Create or inspect a Virtual Shoot node:

```powershell
mir-cli canvas v-camera capabilities --json
mir-cli canvas v-camera create --canvas-id <canvas_id> --yes --json
mir-cli canvas v-camera inspect --canvas-id <canvas_id> --json
```

`v-camera capabilities --json` is the versioned machine-readable contract (`contractVersion=3`, `projectVersion=4`) and works without login or network access. It is the authoritative entry point for fields, pose schemas, defaults, ranges, references, world rules, interpolation behavior, derived/runtime/protected data, raw lifecycle effects, and compound-helper effects.

Add an actor and give it a timed 3D path. Positions use `x,y,z`, and path times accept millisecond precision:

```powershell
mir-cli canvas v-camera actor add --canvas-id <canvas_id> --name "actor_a" --position "0,0,0" --pose-preset stand_neutral --yes --json
mir-cli canvas v-camera actor path add --canvas-id <canvas_id> --actor "actor_a" --time 2.125 --position "2,0,4" --yaw 45 --yes --json
mir-cli canvas v-camera actor pose add --canvas-id <canvas_id> --actor "actor_a" --time 4.5 --preset sit_neutral --seat-height 0.45 --easing smooth --yes --json
```

Add a camera, map its server-side tracking fields, and write an exact camera path:

```powershell
mir-cli canvas v-camera camera add --canvas-id <canvas_id> --name "camera_a" --position "0,1.6,6" --yes --json
mir-cli canvas v-camera camera set --canvas-id <canvas_id> --camera "camera_a" --movement-mode follow --aim-mode actor --tracking-actor "actor_a" --tracking-point chest --follow-offset "0,1.6,3" --follow-speed 6 --motion-preset chase_follow --yes --json
mir-cli canvas v-camera camera path set --canvas-id <canvas_id> --camera "camera_a" --points-json '[{"time":8,"position":[0,1.6,6],"fov":35},{"time":13,"position":[2,1.6,3],"rotation":[0,12,0],"fov":52,"easing":"ease_out"}]' --yes --json
```

Position paths use bounded piecewise eased-linear interpolation: easing changes only time progress, stationary axes remain exact, spatial overshoot is forbidden, and the final point is held exactly. Actor pose keyframes use the same global timeline; pose changes never move actor world position or path points. Camera placement, movement, framing, and timing are supplied through explicit scene fields and global-time keyframes. `motionPreset` is stored as metadata; camera paths are supplied through the path commands.

Raw `set` commands change only explicitly supplied fields. Setting a base position does not move authored path points; use `actor|prop|camera translate --delta x,y,z` when both the base and the complete path should move. A zero-time path point is the canonical origin and requires explicit `--sync-origin` when changing the base position.

Schedule a camera cut by time, or anchor it to an actor path point:

```powershell
mir-cli canvas v-camera cut add --canvas-id <canvas_id> --camera "camera_a" --time 4.5 --yes --json
mir-cli canvas v-camera cut add --canvas-id <canvas_id> --camera "camera_b" --actor "actor_a" --point <path_point_id> --yes --json
```

Anchored cuts inherit the actor path point time automatically. Every mutation supports `--dry-run`. The server rejects stale revisions, so simultaneous web edits cannot be silently overwritten. Virtual Shoot CLI commands do not edit recordings, takes, uploaded media, or generated results.

`camera preset` calls the node's public preset generator and produces ordinary editable global-time keyframes or explicit tracking settings. Raw `camera set` and `camera path add|set|update` remain the unrestricted automation interface. `camera follow` and `camera aim` are compound helpers and report their effects.

## Use It With An AI Assistant

You can ask your AI assistant something like:

```text
Use mir-cli to create a new Miraivfx canvas for this script.
Upload the character and scene references I provide.
Create one video node per shot, use 16:9, set the duration from each shot, and connect the right references to each node.
Open the canvas when it is ready for me to review.
```

For follow-up edits, you can say:

```text
Use mir-cli to inspect the current canvas.
Clone shot 3 as a new version, keep the same references, and change the prompt to make the camera movement slower.
```

## Safety And Control

- You sign in through the browser.
- Canvas-changing commands require explicit flags such as `--yes` or `--allow-upload`.
- The CLI edits your canvas with focused node operations.
- Virtual Shoot edits use a dedicated revision-protected API and preserve recording data.
- Generation submission stays in the Miraivfx web app.
- Result downloads are limited to completed final media from one explicit canvas.
- You should never give an AI assistant your password or raw tokens.
- Before changing existing nodes, the assistant should inspect the current canvas first.

## More Documentation

- `docs/COMMANDS.md`: full command reference.
- `skills/miraivfx-mir-cli/SKILL.md`: optional operating guide for AI assistants.
