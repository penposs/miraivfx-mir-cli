import { getFlagValue, hasFlag } from "../core/args.js";
import { ApiClient } from "../api/client.js";
import { loadRuntimeConfig } from "../core/config.js";
import { openUrl } from "../core/open.js";
import { json, text } from "../core/output.js";

export async function handleProjectCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = hasFlag(args, "--json");
  const config = await loadRuntimeConfig();
  const api = new ApiClient({ baseUrl: config.apiBase, token: config.token });

  if (subcommand === "list") {
    const response = await api.getJson<ProjectListResponse>("/projects");
    const projects = (response.data ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      updatedAt: item.updatedAt,
      canvasCount: item.canvasCount,
      itemCount: item.itemCount,
    }));
    asJson ? json({ projects }) : text(formatProjectList(projects));
    return;
  }

  if (subcommand === "create") {
    const name = getFlagValue(args, "--name");
    if (!name) {
      throw new Error("Missing --name");
    }
    const response = await api.postJson<CreateProjectResponse>("/projects", {
      project_name: name,
    });
    const payload = {
      ok: response.status === "success",
      project_id: response.project_id ?? response.data?.id,
      default_canvas_id: response.default_canvas_id ?? response.data?.default_canvas_id,
      name: response.data?.name ?? name,
    };
    asJson ? json(payload) : text(`Created project ${payload.name}: ${payload.project_id}`);
    return;
  }

  if (subcommand === "open") {
    const projectId = getFlagValue(args, "--project-id");
    if (!projectId) {
      throw new Error("Missing --project-id");
    }
    const url = `${config.appBase}/workspace/${encodeURIComponent(projectId)}`;
    await openUrl(url);
    asJson ? json({ ok: true, url, project_id: projectId }) : text(`Opened ${url}`);
    return;
  }

  text("Usage: mir-cli project <list|create|open>");
}

interface ProjectListResponse {
  status: string;
  data?: Array<{
    id: string;
    name: string;
    updatedAt?: string;
    canvasCount?: number;
    itemCount?: number;
  }>;
}

interface CreateProjectResponse {
  status: string;
  project_id?: string;
  default_canvas_id?: string;
  data?: {
    id: string;
    name: string;
    default_canvas_id?: string;
  };
}

function formatProjectList(projects: Array<{ id: string; name: string; updatedAt?: string }>): string {
  if (projects.length === 0) return "No projects found.";
  return projects
    .map((item) => `${item.name}\t${item.id}${item.updatedAt ? `\t${item.updatedAt}` : ""}`)
    .join("\n");
}
