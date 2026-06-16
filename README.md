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

## Install

```powershell
npm i -g @miraivfx/mir-cli
```

Or run it without installing:

```powershell
npx @miraivfx/mir-cli --help
```

## Sign In

```powershell
mir-cli auth login
```

This opens a browser window. Sign in with your Miraivfx account, then return to your terminal or AI assistant.

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

Add a video generation node:

```powershell
mir-cli canvas node add --canvas-id <canvas_id> --type seedance2-rh-standard --prompt "Video prompt" --data-json "{\"ratio\":\"16:9\",\"duration\":\"12\"}" --yes --json
```

Upload a local file you selected:

```powershell
mir-cli canvas upload --project-id <project_id> --file ./character.png --allow-upload --json
```

Add an uploaded image as a reference node:

```powershell
mir-cli canvas node add-reference-image --canvas-id <canvas_id> --url <uploaded_image_url> --yes --json
```

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
mir-cli canvas node clone --canvas-id <canvas_id> --node-id <node_id> --copy-inputs --title "Shot 03 v2" --yes --json
```

Disconnect two nodes:

```powershell
mir-cli canvas node disconnect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
```

Delete a node:

```powershell
mir-cli canvas node delete --canvas-id <canvas_id> --node-id <node_id> --yes --json
```

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
- Generation, task progress, and result downloads stay in the Miraivfx web app.
- You should never give an AI assistant your password or raw tokens.
- Before changing existing nodes, the assistant should inspect the current canvas first.

## More Documentation

- `docs/COMMANDS.md`: full command reference.
- `skills/miraivfx-mir-cli/SKILL.md`: optional operating guide for AI assistants.
