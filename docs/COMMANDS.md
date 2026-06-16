# Command Plan

## Auth

```powershell
mir-cli auth status
mir-cli auth login
mir-cli auth logout
```

`auth login` is planned as a browser OAuth/PKCE flow. Until then, local development can use `MIRAIVFX_TOKEN` from the shell environment. Agents must not request or display raw tokens.

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

## Capabilities And Models

```powershell
mir-cli canvas capabilities --json
mir-cli canvas models --task image --json
mir-cli canvas models --task video --json
```

## Materials And Tasks

```powershell
mir-cli canvas upload --project-id <project_id> --file ./ref.png --allow-upload --json
mir-cli canvas status --task-id <task_id> --json
mir-cli canvas download --task-id <task_id> --out runs/<run-id>/05-execution
```

## Planning And Execution

```powershell
mir-cli canvas plan --input brief.md --project-id <project_id> --canvas-id <canvas_id>
mir-cli canvas deploy --plan runs/<run-id>/canvas-plan.json
mir-cli canvas deploy --plan runs/<run-id>/canvas-plan.json --yes
mir-cli canvas run --plan runs/<run-id>/canvas-plan.json --approved-task <task_id> --allow-generation
```
