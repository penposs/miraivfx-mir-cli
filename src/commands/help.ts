export function printHelp(): void {
  console.log(`mir-cli

Usage:
  mir-cli auth status
  mir-cli auth login
  mir-cli auth login --no-open
  mir-cli auth login --browser edge
  mir-cli auth switch
  mir-cli project list --json
  mir-cli project create --name "Project name" --json
  mir-cli project open --project-id <project_id>
  mir-cli canvas list --project-id <project_id> --json
  mir-cli canvas create --project-id <project_id> --name "Canvas name" --json
  mir-cli canvas open --canvas-id <canvas_id>
  mir-cli canvas capabilities --json
  mir-cli canvas models --task image --json
  mir-cli canvas inspect --canvas-id <canvas_id> --summary
  mir-cli canvas results list --canvas-id <canvas_id> --json
  mir-cli canvas results download --canvas-id <canvas_id> --output ./downloads --json
  mir-cli canvas results watch --canvas-id <canvas_id> --output ./downloads --json
  mir-cli canvas node add --canvas-id <canvas_id> --type text --content "Note" --yes --json
  mir-cli canvas node update --canvas-id <canvas_id> --node-id <node_id> --prompt "Updated prompt" --yes --json
  mir-cli canvas node clone --canvas-id <canvas_id> --node-id <node_id> --copy-inputs --yes --json
  mir-cli canvas node delete --canvas-id <canvas_id> --node-id <node_id> --yes --json
  mir-cli canvas node add --canvas-id <canvas_id> --type video --prompt "Prompt" --model <model_id> --yes --json
  mir-cli canvas node add-suno --canvas-id <canvas_id> --song-title "Song title" --style "R&B, soul" --lyrics "[Verse]..." --yes --json
  mir-cli canvas node add-suno --canvas-id <canvas_id> --title "Song title" --style "R&B, soul" --lyrics "[Verse]..." --yes --json
  mir-cli canvas node add-seedance-rh --canvas-id <canvas_id> --prompt "Video prompt" --ratio 16:9 --duration 10 --resolution 720p --yes --json
  mir-cli canvas node add-resize --canvas-id <canvas_id> --resize-mode longest --resize-width 1024 --yes --json
  mir-cli canvas node add-vibex --canvas-id <canvas_id> --yes --json
  mir-cli canvas node add-runninghub --canvas-id <canvas_id> --webapp-id <app_id> --api-key <saved_key_name> --values-json '{"node|field":"value"}' --yes --json
  mir-cli canvas node connect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
  mir-cli canvas node disconnect --canvas-id <canvas_id> --from-node <asset_node_id> --to-node <generation_node_id> --yes --json
  mir-cli canvas node add-image --canvas-id <canvas_id> --prompt "Prompt" --model <model_id> --yes --open --json
  mir-cli canvas node add-reference-image --canvas-id <canvas_id> --url <image_url> --connect-to <node_id> --yes --json
  mir-cli canvas v-camera capabilities --json
  mir-cli canvas v-camera create --canvas-id <canvas_id> --yes --json
  mir-cli canvas v-camera inspect --canvas-id <canvas_id> --json
  mir-cli canvas v-camera actor add --canvas-id <canvas_id> --name "Hero" --position "0,0,0" --yes --json
  mir-cli canvas v-camera actor path add --canvas-id <canvas_id> --actor "Hero" --time 2.125 --position "2,0,4" --yes --json
  mir-cli canvas v-camera camera set --canvas-id <canvas_id> --camera "Camera A" --movement-mode path --aim-mode actor --tracking-actor "Hero" --motion-preset orbit_left --yes --json
  mir-cli canvas v-camera camera preset --canvas-id <canvas_id> --camera "Camera A" --actor "Hero" --preset push_in --start-time 8 --duration 5 --yes --json
  mir-cli canvas v-camera camera path set --canvas-id <canvas_id> --camera "Camera A" --points-json '[{"time":8,"position":[0,1.6,6]},{"time":13,"position":[2,1.6,3],"fov":52}]' --yes --json
  mir-cli canvas v-camera shot add --canvas-id <canvas_id> --name "S02 Push in" --camera "Camera A" --start-time 8 --duration 5 --yes --json
  mir-cli canvas v-camera cut add --canvas-id <canvas_id> --camera "Camera A" --time 4.5 --yes --json
  mir-cli canvas upload --project-id <project_id> --file ./ref.png --allow-upload --json

Canvas result commands only read completed final media from one explicit canvas. Generation submission remains a manual web action.`);
}
