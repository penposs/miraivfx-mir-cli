import { getFlagValue, hasFlag } from "../core/args.js";
import { json, text } from "../core/output.js";

export async function handleProjectCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = hasFlag(args, "--json");

  if (subcommand === "list") {
    const payload = {
      projects: [],
      note: "API-backed project listing is not implemented yet.",
    };
    asJson ? json(payload) : text("No projects loaded. API-backed listing is not implemented yet.");
    return;
  }

  if (subcommand === "create") {
    const name = getFlagValue(args, "--name");
    const payload = {
      ok: false,
      requested_name: name ?? null,
      reason: "project_create_not_implemented",
      safety: "Backend must bind the project to the authenticated user.",
    };
    asJson ? json(payload) : text("Project creation is planned but not implemented yet.");
    return;
  }

  if (subcommand === "open") {
    const projectId = getFlagValue(args, "--project-id");
    const payload = {
      ok: false,
      project_id: projectId ?? null,
      reason: "project_open_not_implemented",
    };
    asJson ? json(payload) : text("Project open is planned but not implemented yet.");
    return;
  }

  text("Usage: mir-cli project <list|create|open>");
}
