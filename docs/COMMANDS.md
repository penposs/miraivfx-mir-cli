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
mir-cli canvas v-camera capabilities --json
mir-cli canvas v-camera create --canvas-id <canvas_id> --yes --json
mir-cli canvas v-camera inspect --canvas-id <canvas_id> --json
mir-cli canvas v-camera inspect --canvas-id <canvas_id> --node-id <node_id> --json
mir-cli canvas node add-v-camera --canvas-id <canvas_id> --yes --json
```

`v-camera capabilities --json` is the formal machine-readable contract. It is versioned, runs without login or network access, and reports every field, range, enum, default, reference, world rule, protected field, raw command, and compound helper.

When a canvas contains more than one Virtual Shoot node, pass `--node-id` on every inspect or mutation command.

MIR Virtual Shoot uses one global scene timeline; every path point, shot boundary, and camera cut time is an absolute scene time measured from project second `0`. Entity names may repeat, so automation should retain the stable entity ID returned by each create command and use IDs for later updates.

Raw commands are `project set`, actor/prop/camera `add|set|translate|delete|path`, actor `action`, prop `visibility`, `shot`, and `cut`. Raw `set` commands only change explicitly supplied fields. Expected lifecycle effects such as reference cleanup, active-camera selection, and Shot/Cut synchronization are listed under `rawCommandEffects` and returned by affected dry-runs. `camera follow` and `camera aim` are compound helpers whose effects are declared by capabilities. Raw commands are the stable automation interface.

The CLI enforces only the server's basic scene contract:

- numbers must be finite and inside the server range
- referenced actors, cameras, shots, assets, and path points must exist
- all timeline values are global seconds from `0` through `3600`
- path points, shots, and cuts are sorted by global time
- a follow or actor-aimed camera needs a tracking actor; point aim needs a look-at point
- asset props need an owned asset ID; main-timeline shots cannot overlap
- entity IDs are stable and unique; names are editable and may repeat
- writes require the current canvas revision and fail on a concurrent edit

### Virtual Shoot Parameter Reference

Every mutation accepts `--node-id`, `--dry-run`, `--yes`, and `--json`. Use `--node-id` when a canvas contains multiple Virtual Shoot nodes. `--dry-run` and `--yes` are mutually alternative write modes: dry-run prints the patch, while `--yes` authorizes the write.

`set --position` changes only the base position and never translates authored path points. Use `actor|prop|camera translate --delta x,y,z` to translate the base and the complete path together. If a zero-time path point exists, it is the canonical initial position; raw position set fails unless `--sync-origin` is explicitly supplied.

Project fields:

| Server field | CLI flag | Accepted value |
| --- | --- | --- |
| `name` | `--name` | non-empty text |
| `fps` | `--fps` | `1..120` |
| `duration` | `--duration` | greater than `0`, up to `3600`; the server derives the final scene end |
| `safeFrameRatio` | `--safe-frame` | `off`, `9:16`, `16:9`, `1:1` |
| `activeCameraId` | `--active-camera <id-or-name>` | existing camera ID or unambiguous name |
| `activeCameraId` | `--clear-active-camera` | stores `null` |

Actor fields:

| Server field | CLI flag | Accepted value |
| --- | --- | --- |
| `id` | `actor add --id` | optional stable ID; generated when omitted |
| `name` | `--name` | editable text; duplicates allowed |
| `position` | `--position` | `x,y,z` |
| `rotation` | `--rotation` | pitch,yaw,roll degrees |
| `height` | `--height` | `0.1..20` |
| `lookAtActorId` | `--look-at-actor <id-or-name>` | existing actor other than itself |
| `lookAtActorId` | `--clear-look-at-actor` | stores `null` |
| `lookAtPoint` | `--look-at-point` | `x,y,z` |
| `lookAtPoint` | `--clear-look-at-point` | stores `null` |
| both look-at fields | `--clear-look-at` | stores both as `null` |
| `actionMarkers[]` | `action add --time --action [--target-actor] [--target-point] [--id]` | semantic marker on global time |
| `actionMarkers[]` | `action set --marker <id> [fields]` | updates one marker without changing its ID |

Prop fields:

| Server field | CLI flag | Accepted value |
| --- | --- | --- |
| `id` | `prop add --id` | optional stable ID |
| `name` | `--name` | editable text |
| `position` | `--position` | `x,y,z` |
| `rotation` | `--rotation` | pitch,yaw,roll degrees |
| `scale` | `--scale` | width,height,depth; each value is `0.001..10000` |
| `visible` | `--visible` | `true` or `false` |
| `locked` | `--locked` | `true` or `false` |
| `propPreset` | `--preset` | `box`, `thin_wall`, `column`, `platform`, `obstacle`, `door_frame`, `stairs`, `slope` |
| `propPreset` | `--clear-preset` | removes the optional primitive preset |
| `stepCount` | `--steps` | integer `2..64` |
| `stepCount` | `--clear-steps` | removes the optional field |
| `sourceType` | `--source-type` | `primitive` or `asset` |
| `assetId` | `--asset-id` | owned model asset ID |
| `assetId` | `--clear-asset` | removes the field; source type must remain valid |
| `visibilityKeyframes[]` | `visibility add --time --visible [--id]` | global time and boolean visibility |
| `visibilityKeyframes[]` | `visibility set --keyframe <id> [--time] [--visible]` | updates one keyframe without changing its ID |

Camera fields:

| Server field | CLI flag | Accepted value |
| --- | --- | --- |
| `id` | `camera add --id` | optional stable ID |
| `name` | `--name` | editable text |
| `position` | `--position` | `x,y,z` |
| `rotation` | `--rotation` | pitch,yaw,roll degrees |
| `fov` | `--fov` | `1..179` degrees |
| `focusDistance` | `--focus-distance` | `0.05..1000000` |
| `duration` | `--duration` | greater than `0`, up to `3600` |
| `movementMode` | `--movement-mode` | `static`, `path`, `follow` |
| `aimMode` | `--aim-mode` | `manual`, `actor`, `point` |
| `trackingActorId` | `--tracking-actor <id-or-name>` | existing actor |
| `trackingActorId` | `--clear-tracking` | stores `null` when the resulting camera remains valid |
| `trackingPoint` | `--tracking-point` | `head`, `chest`, `center` |
| `lookAtPoint` | `--look-at-point` | `x,y,z` |
| `lookAtPoint` | `--clear-look-at` | stores `null` when the resulting camera remains valid |
| `followOffset` | `--follow-offset` | local `x,y,z` offset |
| `followSpeed` | `--follow-speed` | `0.01..100` |
| `motionPreset` | `--motion-preset` | accepted metadata name listed below, or `none` |
| `motionPreset` | `--clear-motion-preset` | stores `null` |

Path fields are written independently from camera mode and preset metadata. Adding, replacing, deleting, or clearing camera keyframes does not change `movementMode`, `aimMode`, or `motionPreset`; set those fields explicitly when required.

| Path field | CLI input | Applies to |
| --- | --- | --- |
| `id` | `--id` or JSON `id` | actor, prop, camera |
| `time` | `--time` or JSON `time` | actor, prop, camera; global seconds |
| `position` | `--position` or JSON `position` | actor, prop, camera |
| `yaw` | `--yaw` or JSON `yaw` | actor, prop, camera |
| `easing` | `--easing` or JSON `easing` | `smooth`, `linear`, `ease_in`, `ease_out`, `ease_in_out` |
| `rotation` | `--rotation` or JSON `rotation` | camera only |
| `fov` | `--fov` or JSON `fov` | camera only |
| `focusDistance` | `--focus-distance` or JSON `focusDistance` | camera only |

Use `path update --point <id>` with any supported field to update one path point while preserving its ID. Optional fields support `--clear-yaw`, `--clear-easing`, and, for camera points, `--clear-rotation`, `--clear-fov`, and `--clear-focus-distance`.

Shot fields:

| Server field | CLI flag | Accepted value |
| --- | --- | --- |
| `id` | `shot add --id` | optional stable ID |
| `name` | `--name` | editable text |
| `startTime` | `--start-time` | global seconds |
| `endTime` | `--end-time` | global seconds greater than start |
| duration shorthand | `--duration` | computes `endTime = startTime + duration` |
| `cameraId` | `--camera <id-or-name>` | existing camera |
| `locked` | `--locked` | `true` or `false` |
| `metadata` | `--metadata-json` | object with up to 50 scalar fields |

Camera cut fields are exposed through `cut add/set/delete/clear`: `--id`, `--time`, and `--camera` map to the stored ID, global time, and camera reference. Supplying `--actor` together with `--point` creates or updates an actor-path anchor and copies that point's global time. Use `cut set --clear-anchor [--time <seconds>]` to convert it to a normal cut. Shot-linked cuts remain managed by their shot.

Project settings:

```powershell
mir-cli canvas v-camera project set --canvas-id <canvas_id> --name "Stage A" --fps 24 --safe-frame 16:9 --active-camera "Camera A" --yes --json
```

Scene duration is derived from the latest actor, prop, or camera path point and the latest shot/cut time. Empty scenes keep a one-second editing range. `--duration` does not create fixed empty time beyond authored tracks.

Actors:

```powershell
mir-cli canvas v-camera actor add --canvas-id <canvas_id> --name "Hero" --position "0,0,0" --rotation "0,0,0" --height 1.75 --yes --json
mir-cli canvas v-camera actor set --canvas-id <canvas_id> --actor "Hero" --position "2,0,4" --rotation "0,45,0" --yes --json
mir-cli canvas v-camera actor set --canvas-id <canvas_id> --actor "Hero" --look-at-actor "Partner" --yes --json
mir-cli canvas v-camera actor action add --canvas-id <canvas_id> --actor "Hero" --time 6.5 --action turn_head --target-actor "Partner" --yes --json
mir-cli canvas v-camera actor action set --canvas-id <canvas_id> --actor "Hero" --marker <marker_id> --time 6.75 --clear-targets --yes --json
mir-cli canvas v-camera actor translate --canvas-id <canvas_id> --actor "Hero" --delta "2,0,1" --yes --json
mir-cli canvas v-camera actor delete --canvas-id <canvas_id> --actor "Hero" --yes --json
```

Props:

```powershell
mir-cli canvas v-camera prop add --canvas-id <canvas_id> --preset thin_wall --name "Back wall" --position "0,0.85,-3" --scale "4,1.7,0.12" --yes --json
mir-cli canvas v-camera prop add --canvas-id <canvas_id> --asset-id <uploaded_model_asset_id> --name "Hero car" --position "4,0,2" --yes --json
mir-cli canvas v-camera prop set --canvas-id <canvas_id> --prop "Back wall" --rotation "0,45,0" --visible true --locked false --preset thin_wall --source-type primitive --yes --json
mir-cli canvas v-camera prop visibility add --canvas-id <canvas_id> --prop "Hero car" --time 12.5 --visible false --yes --json
mir-cli canvas v-camera prop visibility set --canvas-id <canvas_id> --prop "Hero car" --keyframe <keyframe_id> --time 13 --visible true --yes --json
mir-cli canvas v-camera prop delete --canvas-id <canvas_id> --prop "Back wall" --yes --json
```

Supported prop presets are `box`, `thin_wall`, `column`, `platform`, `obstacle`, `door_frame`, `stairs`, and `slope`. Stairs accept `--steps 2..64` and default to `5`. Supplying `--asset-id` selects `sourceType=asset`, neutral scale `[1,1,1]`, and does not attach a primitive preset unless one is explicitly supplied. Arbitrary external model URLs are not accepted.

Cameras:

```powershell
mir-cli canvas v-camera camera add --canvas-id <canvas_id> --name "Camera A" --position "0,1.6,6" --rotation "0,180,0" --fov 35 --duration 8 --yes --json
mir-cli canvas v-camera camera set --canvas-id <canvas_id> --camera "Camera A" --position "1,1.8,5" --fov 45 --movement-mode path --aim-mode actor --tracking-actor "Hero" --tracking-point head --motion-preset push_in --yes --json
mir-cli canvas v-camera camera set --canvas-id <canvas_id> --camera "Camera A" --movement-mode follow --aim-mode actor --tracking-actor "Hero" --follow-offset "0,1.6,3" --follow-speed 6 --yes --json
mir-cli canvas v-camera camera set --canvas-id <canvas_id> --camera "Camera A" --aim-mode point --look-at-point "0,1.5,0" --yes --json
mir-cli canvas v-camera camera aim --canvas-id <canvas_id> --camera "Camera A" --point "0,1.5,0" --yes --json
mir-cli canvas v-camera camera follow --canvas-id <canvas_id> --camera "Camera A" --actor "Hero" --tracking-point chest --offset "0,1.6,3" --speed 6 --yes --json
mir-cli canvas v-camera camera delete --canvas-id <canvas_id> --camera "Camera A" --yes --json
```

Accepted `--motion-preset` metadata values are `push_in`, `pull_out`, `truck_left`, `truck_right`, `fixed_tracking`, `lead_follow`, `chase_follow`, `orbit_left`, `orbit_right`, `crane_up`, `crane_down`, `pan_left`, `pan_right`, `tilt_up`, `tilt_down`, `zoom_in`, `zoom_out`, `dolly_zoom_in`, and `dolly_zoom_out`. Use `none` to clear the field. This field is transported to the server exactly as metadata; it does not generate, merge, or alter camera keyframes.

Movement, timing, framing, and easing are supplied as exact camera fields and keyframes through `camera set` and `camera path set/add`.

`camera follow` requires an explicit `--offset`; `--derive-offset` opts into deriving it from current placement. It clears `motionPreset` only when `--clear-motion-preset` is supplied. `camera aim` changes only the fields declared for its selected mode. Both are compound helpers. `camera preset` is unavailable; use `camera set` plus `camera path set`.

Actor, prop, and camera paths share the same commands:

```powershell
mir-cli canvas v-camera actor path add --canvas-id <canvas_id> --actor "Hero" --time 2.125 --position "2,0,4" --yaw 45 --yes --json
mir-cli canvas v-camera camera path set --canvas-id <canvas_id> --camera "Camera A" --points-json '[{"time":8,"position":[0,1.6,6],"fov":35},{"time":13,"position":[2,1.6,3],"rotation":[0,12,0],"fov":52,"focusDistance":6,"easing":"ease_out"}]' --yes --json
mir-cli canvas v-camera camera path update --canvas-id <canvas_id> --camera "Camera A" --point <point_id> --time 13.125 --fov 48 --clear-focus-distance --yes --json
mir-cli canvas v-camera prop path delete --canvas-id <canvas_id> --prop "Platform 1" --point <point_id> --yes --json
mir-cli canvas v-camera actor path clear --canvas-id <canvas_id> --actor "Hero" --yes --json
```

`path set --points-json` always accepts absolute scene times. It never converts global times to camera-local or shot-local times.

Shots:

```powershell
mir-cli canvas v-camera shot add --canvas-id <canvas_id> --name "S02 Push in" --camera "Camera B" --start-time 8 --duration 5 --metadata-json '{"scriptRef":"S02"}' --yes --json
mir-cli canvas v-camera shot set --canvas-id <canvas_id> --shot "S02 Push in" --start-time 8.5 --end-time 13.5 --camera "Camera C" --yes --json
mir-cli canvas v-camera shot delete --canvas-id <canvas_id> --shot <shot_id> --yes --json
```

Shots are persisted scene-timeline ranges. Adding or changing a shot synchronizes its camera cut at `shot.startTime`. Main-timeline shots must not overlap. Locked shots must be unlocked before editing.

Camera cuts:

```powershell
mir-cli canvas v-camera cut add --canvas-id <canvas_id> --camera "Camera A" --time 4.5 --yes --json
mir-cli canvas v-camera cut add --canvas-id <canvas_id> --camera "Camera B" --actor "Hero" --point <path_point_id> --yes --json
mir-cli canvas v-camera cut set --canvas-id <canvas_id> --cut <cut_id> --time 7.25 --camera "Camera C" --yes --json
mir-cli canvas v-camera cut set --canvas-id <canvas_id> --cut <cut_id> --actor "Hero" --point <path_point_id> --yes --json
mir-cli canvas v-camera cut set --canvas-id <canvas_id> --cut <cut_id> --clear-anchor --time 8 --yes --json
mir-cli canvas v-camera cut delete --canvas-id <canvas_id> --cut <cut_id> --yes --json
mir-cli canvas v-camera cut clear --canvas-id <canvas_id> --yes --json
```

Anchored cuts derive their time from the selected actor path point. All mutations require `--yes`; use `--dry-run` instead to calculate and print the exact project patch without writing. The dedicated endpoint requires the inspected canvas revision and rejects concurrent web edits. It cannot change takes, recording uploads, media results, task ids, billing fields, or ordinary canvas nodes.

### Derived, Runtime, And Protected Fields

- Derived: project `version`, project `duration`, shot-owned cut `shotId`, and anchored cut time.
- Runtime-only: `currentTime` and `isPlaying`; these are not persistent authoring inputs.
- Protected: takes, saved scenes, recordings, uploaded media, generated results, task fields, and billing fields.
- Generic canvas node data updates cannot modify `vCameraProject`; use the dedicated Virtual Shoot endpoint and its revision check.

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
