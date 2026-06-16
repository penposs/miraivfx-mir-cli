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
mir-cli canvas node add-image --canvas-id <canvas_id> --prompt "A product photo" --model <model_id> --yes --json
mir-cli canvas node add-image --canvas-id <canvas_id> --prompt "A product photo" --model <model_id> --settings-json "{\"size\":\"1024x1024\"}" --yes --json
```

`canvas node add-image` creates a saved `image` generation node using the existing Miraivfx canvas schema. It checks the selected model against `/api/canvas/models?task=image`, writes the node with `status=idle`, and does not start generation.

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
mir-cli canvas status --task-id <task_id> --json
mir-cli canvas download --task-id <task_id> --out runs/<run-id>/05-execution
mir-cli canvas download --url <result_url> --out runs/<run-id>/05-execution
```

`canvas download` sends the saved user bearer token when downloading protected Miraivfx API URLs, only accepts trusted Miraivfx hosts by default, and will not overwrite an existing local file. If production media is served from an additional signed CDN host, add it explicitly with `MIRAIVFX_DOWNLOAD_HOSTS=cdn.example.com,media.example.com`.

## Planning And Execution

```powershell
mir-cli canvas plan --input brief.md --project-id <project_id> --canvas-id <canvas_id>
mir-cli canvas deploy --plan runs/<run-id>/canvas-plan.json
mir-cli canvas deploy --plan runs/<run-id>/canvas-plan.json --yes
mir-cli canvas run --plan runs/<run-id>/canvas-plan.json --approved-task <task_id> --allow-generation
```
