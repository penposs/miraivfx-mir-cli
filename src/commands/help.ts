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
  mir-cli canvas node add --canvas-id <canvas_id> --type text --content "Note" --yes --json
  mir-cli canvas node add --canvas-id <canvas_id> --type video --prompt "Prompt" --model <model_id> --yes --json
  mir-cli canvas node connect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
  mir-cli canvas node add-image --canvas-id <canvas_id> --prompt "Prompt" --model <model_id> --yes --open --json
  mir-cli canvas node add-reference-image --canvas-id <canvas_id> --url <image_url> --connect-to <node_id> --yes --json
  mir-cli canvas upload --project-id <project_id> --file ./ref.png --allow-upload --json

Canvas node commands append allowed nodes only. Use canvas capabilities for supported node types. Generation submission, task status, and downloads are manual web actions.`);
}
