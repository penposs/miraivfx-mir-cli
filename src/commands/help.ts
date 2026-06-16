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

This scaffold contains command contracts. API-backed behavior is implemented next.`);
}
