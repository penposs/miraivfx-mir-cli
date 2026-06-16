import { randomUUID } from "node:crypto";
import { basename } from "node:path";
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
    const query = task === "all" ? "" : `?task=${encodeURIComponent(task)}`;
    const response = await api.getJson<ModelsResponse>(`/canvas/models${query}`);
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

  if (subcommand === "upload") {
    if (!hasFlag(args, "--allow-upload")) {
      throw new Error("Upload requires explicit --allow-upload");
    }
    const filePath = requireValue(getFlagValue(args, "--file"), "--file");
    const form = new FormData();
    const fileBuffer = await import("node:fs/promises").then((fs) => fs.readFile(filePath));
    form.set("file", new Blob([fileBuffer]), basename(filePath));
    const projectId = getFlagValue(args, "--project-id");
    if (projectId) form.set("project_id", projectId);
    const response = await api.postForm<UploadResponse>("/files/upload", form);
    json({
      filename: response.filename,
      original_filename: response.original_filename,
      url: response.url,
      path: response.path,
      size: response.size,
      project_id: response.project_id,
      converted_to_jpg: response.converted_to_jpg,
    });
    return;
  }

  if (subcommand === "status") {
    const payload = manualWebOnlyPayload("canvas status");
    asJson ? json(payload) : text(payload.message);
    return;
  }

  if (subcommand === "download") {
    const payload = manualWebOnlyPayload("canvas download");
    asJson ? json(payload) : text(payload.message);
    return;
  }

  if (subcommand === "node") {
    const action = args[0] ?? "";
    const rest = args.slice(1);
    if (action === "add-image") {
      const result = await addImageNode(api, rest, config.appBase);
      if (result.opened && typeof result.url === "string") {
        await openUrl(result.url);
      }
      asJson ? json(result) : text(`Added image node ${result.node_id} to ${result.canvas_id}`);
      return;
    }
    if (action === "add-reference-image") {
      const result = await addReferenceImageNode(api, rest, config.appBase);
      if (result.opened && typeof result.url === "string") {
        await openUrl(result.url);
      }
      asJson ? json(result) : text(`Added reference image node ${result.node_id} to ${result.canvas_id}`);
      return;
    }
    text("Usage: mir-cli canvas node <add-image|add-reference-image>");
    return;
  }

  if (["plan", "deploy", "run"].includes(subcommand)) {
    const payload = manualWebOnlyPayload(`canvas ${subcommand}`);
    asJson ? json(payload) : text(payload.message);
    return;
  }

  text("Usage: mir-cli canvas <list|create|open|capabilities|models|inspect|upload|node>");
}

function manualWebOnlyPayload(command: string): { ok: false; command: string; code: string; message: string } {
  return {
    ok: false,
    command,
    code: "manual_web_only",
    message: `${command} is intentionally disabled in mir-cli. Open the canvas in MiraiVFX to submit, inspect task status, or download results manually.`,
  };
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

async function addImageNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Creating a canvas node requires explicit --yes");
  }
  const shouldOpen = hasFlag(args, "--open");
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const prompt = getFlagValue(args, "--prompt") ?? "";
  const model = getFlagValue(args, "--model");
  const title = getFlagValue(args, "--title") ?? "AI 生图";
  const x = parseOptionalNumber(getFlagValue(args, "--x"), "--x") ?? 0;
  const y = parseOptionalNumber(getFlagValue(args, "--y"), "--y") ?? 0;
  const settings = parseSettings(getFlagValue(args, "--settings-json"));

  if (model) {
    await assertModelAvailable(api, "image", model);
  }

  const now = Date.now();
  const node: CanvasNodeRecord = {
    id: randomUUID(),
    x,
    y,
    width: 600,
    height: 360,
    type: "image",
    content: prompt,
    title,
    data: {
      ...(settings ?? {}),
      ...(settings ? { settings } : {}),
      ...(prompt ? { prompt } : {}),
      ...(model ? { model } : {}),
      createdBy: "mir-cli",
      createdAt: new Date(now).toISOString(),
    },
    status: "idle",
  };

  const update = await api.postJson<CanvasOpsResponse>(`/canvas/${encodeURIComponent(canvasId)}/ops`, {
    conflictPolicy: "merge",
    clientModifiedAt: now,
    ops: [{ type: "add_node", node }],
  });

  if (!update.success) {
    throw new Error(update.error ?? "Failed to apply canvas ops");
  }
  if (update.data?.ignored) {
    throw new Error("Canvas update was ignored because the server has a newer version. Re-inspect the canvas and retry.");
  }

  const projectId = requireValue(update.data?.project_id, "ops response project_id");
  const url = `${appBase}/canvas?projectId=${encodeURIComponent(projectId)}&canvasId=${encodeURIComponent(canvasId)}`;
  return {
    ok: true,
    canvas_id: canvasId,
    project_id: projectId,
    url,
    opened: shouldOpen,
    node_id: node.id,
    node_type: node.type,
    prompt,
    model: model ?? null,
    revision: update.data?.revision,
    clientModifiedAt: update.data?.clientModifiedAt,
    generation_started: false,
  };
}

async function addReferenceImageNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Creating a canvas node requires explicit --yes");
  }
  const shouldOpen = hasFlag(args, "--open");
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const imageUrl = requireValue(getFlagValue(args, "--url"), "--url");
  validateCanvasAssetUrl(imageUrl);
  const title = getFlagValue(args, "--title") ?? "参考图";
  const x = parseOptionalNumber(getFlagValue(args, "--x"), "--x") ?? -340;
  const y = parseOptionalNumber(getFlagValue(args, "--y"), "--y") ?? 0;
  const connectTo = getFlagValue(args, "--connect-to");

  const now = Date.now();
  const node: CanvasNodeRecord = {
    id: randomUUID(),
    x,
    y,
    width: 280,
    height: 280,
    type: "image-item",
    content: imageUrl,
    title,
    data: {
      url: imageUrl,
      kind: "image",
      createdBy: "mir-cli",
      createdAt: new Date(now).toISOString(),
    },
    status: "completed",
  };
  const connection = connectTo
    ? {
        type: "connect",
        id: randomUUID(),
        fromNode: node.id,
        toNode: connectTo,
      }
    : undefined;

  const update = await api.postJson<CanvasOpsResponse>(`/canvas/${encodeURIComponent(canvasId)}/ops`, {
    conflictPolicy: "merge",
    clientModifiedAt: now,
    ops: [
      { type: "add_node", node },
      ...(connection ? [connection] : []),
    ],
  });

  if (!update.success) {
    throw new Error(update.error ?? "Failed to apply canvas ops");
  }
  if (update.data?.ignored) {
    throw new Error("Canvas update was ignored because the server has a newer version. Re-inspect the canvas and retry.");
  }

  const projectId = requireValue(update.data?.project_id, "ops response project_id");
  const url = `${appBase}/canvas?projectId=${encodeURIComponent(projectId)}&canvasId=${encodeURIComponent(canvasId)}`;
  return {
    ok: true,
    canvas_id: canvasId,
    project_id: projectId,
    url,
    opened: shouldOpen,
    node_id: node.id,
    node_type: node.type,
    image_url: imageUrl,
    connected_to: connectTo ?? null,
    revision: update.data?.revision,
    clientModifiedAt: update.data?.clientModifiedAt,
  };
}

async function assertModelAvailable(api: ApiClient, task: string, modelId: string): Promise<void> {
  const response = await api.getJson<ModelsResponse>(`/canvas/models?task=${encodeURIComponent(task)}`);
  const models = normalizeModels(response, task);
  const match = models.find((model) => model.model_id === modelId);
  if (!match) {
    throw new Error(`Model is not available for ${task}: ${modelId}`);
  }
  if (match.enabled === false || match.maintenance === true) {
    throw new Error(`Model is not currently usable: ${modelId}`);
  }
}

function normalizeModels(response: ModelsResponse, task: string): Array<Record<string, unknown>> {
  const rows: Array<any> = [];
  if (Array.isArray(response.data)) {
    rows.push(...response.data);
  }
  if (response.data && !Array.isArray(response.data) && Array.isArray(response.data.models)) {
    rows.push(...response.data.models);
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
      task: model.task ?? model.model_type ?? model.type ?? task,
      provider: model.provider,
      capabilities: model.capabilities ?? [],
      enabled: model.is_active ?? true,
      maintenance: model.maintenance ?? model.is_maintenance ?? false,
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

function validateCanvasAssetUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--url must be an absolute URL");
  }
  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocalhost && parsed.protocol === "http:")) {
    throw new Error("--url must use https, except localhost development URLs");
  }
  if (!isAllowedHost(parsed.hostname, getAllowedDownloadHosts("https://api.miraivfx.art/api")) && !isLocalhost) {
    throw new Error(`Image URL host is not trusted: ${parsed.hostname}`);
  }
}

function parseOptionalNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${flag}`);
  return parsed;
}

function parseSettings(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--settings-json must be a JSON object");
  }
  return parsed as Record<string, unknown>;
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

interface CanvasNodeRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "image" | "image-item";
  content: string;
  title?: string;
  data: Record<string, unknown>;
  status: "idle" | "completed";
}

interface CanvasOpsResponse {
  success: boolean;
  data?: {
    revision?: number;
    project_id?: string;
    updatedAt?: number;
    clientModifiedAt?: number;
    ignored?: boolean;
    name?: string;
    nodes?: Array<Record<string, unknown>>;
    connections?: Array<Record<string, unknown>>;
  };
  error?: string;
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
  success?: boolean;
  data?: Array<Record<string, unknown>> | { models?: Array<Record<string, unknown>> };
  providers?: Record<string, { models?: Array<Record<string, unknown>> }>;
}

interface UploadResponse {
  filename: string;
  original_filename?: string;
  url: string;
  path: string;
  size: number;
  project_id?: string | null;
  converted_to_jpg?: boolean;
}

function getAllowedDownloadHosts(apiBase: string): string[] {
  const configured = process.env.MIRAIVFX_DOWNLOAD_HOSTS?.split(",") ?? [];
  let apiHost: string | undefined;
  try {
    apiHost = new URL(apiBase).hostname;
  } catch {
    apiHost = undefined;
  }
  const hosts = [
    "miraivfx.art",
    "api.miraivfx.art",
    "cdn.miraivfx.art",
    ...configured,
  ];
  if (apiHost) hosts.push(apiHost);
  return hosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
}

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
