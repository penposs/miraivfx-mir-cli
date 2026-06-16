export function printHelp(): void {
  console.log(`mir-cli

Usage:
  mir-cli auth status
  mir-cli auth login
  mir-cli project list --json
  mir-cli project create --name "Project name" --json
  mir-cli project open --project-id <project_id>
  mir-cli canvas list --project-id <project_id> --json
  mir-cli canvas create --project-id <project_id> --name "Canvas name" --json
  mir-cli canvas open --canvas-id <canvas_id>
  mir-cli canvas capabilities --json
  mir-cli canvas models --task image --json
  mir-cli canvas inspect --canvas-id <canvas_id> --summary
  mir-cli canvas node add-image --canvas-id <canvas_id> --prompt "Prompt" --model <model_id> --yes --open --json
  mir-cli canvas upload --project-id <project_id> --file ./ref.png --allow-upload --json
  mir-cli canvas status --task-id <task_id> --json
  mir-cli canvas download --task-id <task_id> --out ./downloads

Canvas node commands write saved canvas JSON only. They do not start generation unless a command explicitly says so and requires --allow-generation.`);
}
