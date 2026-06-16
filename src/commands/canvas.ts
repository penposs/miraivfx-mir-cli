import { getFlagValue, hasFlag } from "../core/args.js";
import { ApiClient } from "../api/client.js";
import { loadRuntimeConfig } from "../core/config.js";
import { openUrl } from "../core/open.js";
import { json, text } from "../core/output.js";

export async function handleCanvasCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = hasFlag(args, "--json");
  const config = await loadRuntimeConfig();
  const api = new ApiClient({ baseUrl: config.apiBase, token: config.token });

  if (subcommand === "list") {
    const projectId = getFlagValue(args, "--project-id");
    const all = hasFlag(args, "--all");
    const payload = all
      ? await listAllCanvases(api)
      : { canvases: await listCanvasesForProject(api, requireValue(projectId, "--project-id")) };
    asJson ? json(payload) : text(formatCanvasList(payload.canvases));
    return;
  }

  if (subcommand === "create") {
    const projectId = requireValue(getFlagValue(args, "--project-id"), "--project-id");
    const name = getFlagValue(args, "--name") ?? "未命名画布";
    const response = await api.postJson<CreateCanvasResponse>("/canvas/create", {
      project_id: projectId,
      name,
    });
    const payload = {
      ok: response.success,
      canvas_id: response.data?.id,
      project_id: response.data?.project_id ?? projectId,
      name: response.data?.name ?? name,
      revision: response.data?.revision ?? 0,
    };
    asJson ? json(payload) : text(`Created canvas ${payload.name}: ${payload.canvas_id}`);
    return;
  }

  if (subcommand === "open") {
    const resolved = await resolveCanvasTarget(api, args);
    const url = `${config.appBase}/canvas?projectId=${encodeURIComponent(resolved.project_id)}&canvasId=${encodeURIComponent(resolved.canvas_id)}`;
    await openUrl(url);
    asJson ? json({ ok: true, url, ...resolved }) : text(`Opened ${url}`);
    return;
  }

  if (subcommand === "capabilities") {
    const response = await api.getJson<CapabilitiesResponse>("/canvas/capabilities");
    json(response.data ?? response);
    return;
  }

  if (subcommand === "models") {
    const task = getFlagValue(args, "--task") ?? "all";
    const response = await api.getJson<ModelsResponse>("/models");
    json({ task, models: normalizeModels(response, task) });
    return;
  }

  if (subcommand === "inspect") {
    const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
    const response = await api.getJson<GetCanvasResponse>(`/canvas/${encodeURIComponent(canvasId)}`);
    if (!response.success || !response.data) {
      throw new Error(response.error ?? "Canvas not found");
    }
    const payload = hasFlag(args, "--json")
      ? response.data
      : summarizeCanvas(response.data);
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

async function listAllCanvases(api: ApiClient): Promise<{ canvases: CanvasListItem[] }> {
  const projectsResponse = await api.getJson<ProjectListResponse>("/projects");
  const projects = projectsResponse.data ?? [];
  const nested = await Promise.all(
    projects.map(async (project) => listCanvasesForProject(api, project.id, project.name)),
  );
  return { canvases: nested.flat() };
}

async function listCanvasesForProject(
  api: ApiClient,
  projectId: string,
  projectName?: string,
): Promise<CanvasListItem[]> {
  const response = await api.getJson<CanvasListResponse>(
    `/canvas/list?project_id=${encodeURIComponent(projectId)}`,
  );
  if (!response.success) {
    throw new Error(response.error ?? "Failed to list canvases");
  }
  return (response.data ?? []).map((item) => ({
    canvas_id: item.id,
    project_id: item.project_id ?? projectId,
    project_name: projectName,
    name: item.name,
    node_count: item.nodeCount,
    revision: item.revision ?? 0,
    updated_at: item.updatedAt,
  }));
}

async function resolveCanvasTarget(api: ApiClient, args: string[]): Promise<{ canvas_id: string; project_id: string; name?: string }> {
  const canvasId = getFlagValue(args, "--canvas-id");
  if (canvasId) {
    const response = await api.getJson<GetCanvasResponse>(`/canvas/${encodeURIComponent(canvasId)}`);
    if (!response.success || !response.data) {
      throw new Error(response.error ?? "Canvas not found");
    }
    return {
      canvas_id: response.data.id,
      project_id: response.data.project_id,
      name: response.data.name,
    };
  }

  const projectId = requireValue(getFlagValue(args, "--project-id"), "--project-id");
  const name = requireValue(getFlagValue(args, "--name"), "--name");
  const canvases = await listCanvasesForProject(api, projectId);
  const matches = canvases.filter((item) => item.name === name);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one canvas named "${name}", found ${matches.length}`);
  }
  return {
    canvas_id: matches[0].canvas_id,
    project_id: matches[0].project_id,
    name: matches[0].name,
  };
}

function summarizeCanvas(canvas: CanvasData): Record<string, unknown> {
  const nodeTypeCounts: Record<string, number> = {};
  for (const node of canvas.nodes ?? []) {
    const type = String((node as Record<string, unknown>).type ?? "unknown");
    nodeTypeCounts[type] = (nodeTypeCounts[type] ?? 0) + 1;
  }
  return {
    id: canvas.id,
    project_id: canvas.project_id,
    name: canvas.name,
    node_count: canvas.nodes?.length ?? 0,
    connection_count: canvas.connections?.length ?? 0,
    node_type_counts: nodeTypeCounts,
    revision: canvas.revision ?? 0,
    clientModifiedAt: canvas.clientModifiedAt ?? 0,
    updatedAt: canvas.updatedAt,
  };
}

function normalizeModels(response: ModelsResponse, task: string): Array<Record<string, unknown>> {
  const rows: Array<any> = [];
  if (Array.isArray(response.data)) {
    rows.push(...response.data);
  }
  if (response.providers) {
    for (const [provider, providerData] of Object.entries(response.providers)) {
      for (const model of providerData.models ?? []) {
        rows.push({ ...model, provider });
      }
    }
  }
  return rows
    .filter((model) => task === "all" || model.model_type === task || model.type === task || model.capabilities?.includes?.(task))
    .map((model) => ({
      model_id: model.id,
      display_name: model.label ?? model.name ?? model.id,
      task: model.model_type ?? model.type ?? task,
      provider: model.provider,
      capabilities: model.capabilities ?? [],
      enabled: model.is_active ?? true,
      maintenance: model.is_maintenance ?? false,
      cost_per_unit: model.cost_per_unit,
      parameter_schema: model.paramSchema ?? model.param_schema ?? {},
    }));
}

function formatCanvasList(canvases: CanvasListItem[]): string {
  if (canvases.length === 0) return "No canvases found.";
  return canvases
    .map((item) => `${item.name}\t${item.canvas_id}\t${item.project_id}\tnodes=${item.node_count}`)
    .join("\n");
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`Missing ${flag}`);
  return value;
}

interface ProjectListResponse {
  status: string;
  data?: Array<{ id: string; name: string }>;
}

interface CanvasListResponse {
  success: boolean;
  data?: Array<{
    id: string;
    name: string;
    project_id?: string;
    nodeCount: number;
    revision?: number;
    updatedAt?: number;
  }>;
  error?: string;
}

interface CreateCanvasResponse {
  success: boolean;
  data?: {
    id: string;
    name: string;
    project_id: string;
    revision?: number;
  };
  error?: string;
}

interface GetCanvasResponse {
  success: boolean;
  data?: CanvasData;
  error?: string;
}

interface CanvasData {
  id: string;
  project_id: string;
  name: string;
  nodes: unknown[];
  connections: unknown[];
  revision?: number;
  clientModifiedAt?: number;
  updatedAt?: number;
}

interface CanvasListItem {
  canvas_id: string;
  project_id: string;
  project_name?: string;
  name: string;
  node_count: number;
  revision: number;
  updated_at?: number;
}

interface CapabilitiesResponse {
  success?: boolean;
  data?: unknown;
}

interface ModelsResponse {
  status?: string;
  data?: Array<Record<string, unknown>>;
  providers?: Record<string, { models?: Array<Record<string, unknown>> }>;
}
