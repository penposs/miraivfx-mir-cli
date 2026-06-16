import { getFlagValue, hasFlag } from "../core/args.js";
import { json, text } from "../core/output.js";

export async function handleCanvasCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = hasFlag(args, "--json");

  if (subcommand === "list") {
    const payload = {
      canvases: [],
      project_id: getFlagValue(args, "--project-id") ?? null,
      all: hasFlag(args, "--all"),
      note: "API-backed canvas listing is not implemented yet.",
    };
    asJson ? json(payload) : text("No canvases loaded. API-backed listing is not implemented yet.");
    return;
  }

  if (subcommand === "create") {
    const payload = {
      ok: false,
      project_id: getFlagValue(args, "--project-id") ?? null,
      name: getFlagValue(args, "--name") ?? null,
      reason: "canvas_create_not_implemented",
      safety: "Backend must validate project ownership.",
    };
    asJson ? json(payload) : text("Canvas creation is planned but not implemented yet.");
    return;
  }

  if (subcommand === "open") {
    const payload = {
      ok: false,
      canvas_id: getFlagValue(args, "--canvas-id") ?? null,
      project_id: getFlagValue(args, "--project-id") ?? null,
      name: getFlagValue(args, "--name") ?? null,
      reason: "canvas_open_not_implemented",
    };
    asJson ? json(payload) : text("Canvas open is planned but not implemented yet.");
    return;
  }

  if (subcommand === "capabilities") {
    const payload = {
      canvas_runtime: "miraivfx-canvas",
      node_types: [],
      material_actions: ["upload", "reuse", "download"],
      note: "Capabilities endpoint is not implemented yet.",
    };
    json(payload);
    return;
  }

  if (subcommand === "models") {
    const payload = {
      task: getFlagValue(args, "--task") ?? "all",
      models: [],
      note: "Model library endpoint is not implemented yet.",
    };
    json(payload);
    return;
  }

  if (subcommand === "inspect") {
    const payload = {
      canvas_id: getFlagValue(args, "--canvas-id") ?? null,
      mode: hasFlag(args, "--json") ? "full" : "summary",
      note: "Canvas inspect is not implemented yet.",
    };
    json(payload);
    return;
  }

  if (["upload", "plan", "deploy", "run", "status", "download"].includes(subcommand)) {
    const payload = {
      ok: false,
      command: `canvas ${subcommand}`,
      reason: "command_not_implemented",
    };
    asJson ? json(payload) : text(`canvas ${subcommand} is planned but not implemented yet.`);
    return;
  }

  text("Usage: mir-cli canvas <list|create|open|capabilities|models|inspect|upload|plan|deploy|run|status|download>");
}
