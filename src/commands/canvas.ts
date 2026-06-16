import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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
    const taskId = requireValue(getFlagValue(args, "--task-id"), "--task-id");
    const response = await api.getJson<TaskStatusResponse>(`/tasks/${encodeURIComponent(taskId)}`);
    json(normalizeTaskStatus(taskId, response));
    return;
  }

  if (subcommand === "download") {
    const outDir = getFlagValue(args, "--out") ?? ".";
    const explicitUrl = getFlagValue(args, "--url");
    const taskId = getFlagValue(args, "--task-id");
    const url = explicitUrl ?? (taskId ? await resolveTaskResultUrl(api, taskId) : undefined);
    if (!url) {
      throw new Error("Missing --url or a --task-id with downloadable result");
    }
    const result = await downloadUrl(url, outDir);
    json(result);
    return;
  }

  if (["plan", "deploy", "run"].includes(subcommand)) {
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

interface UploadResponse {
  filename: string;
  original_filename?: string;
  url: string;
  path: string;
  size: number;
  project_id?: string | null;
  converted_to_jpg?: boolean;
}

interface TaskStatusResponse {
  task?: Record<string, unknown>;
  history_record?: Record<string, unknown> | null;
  status?: string;
  data?: unknown;
}

function normalizeTaskStatus(taskId: string, response: TaskStatusResponse): Record<string, unknown> {
  const task = response.task ?? {};
  const record = response.history_record ?? null;
  return {
    task_id: String(task.task_id ?? taskId),
    status: String(task.status ?? record?.status ?? response.status ?? "unknown"),
    progress: task.progress,
    result: task.result,
    result_url: pickResultUrl(response),
    error: task.error ?? record?.error ?? record?.error_message ?? null,
    history_record: record,
  };
}

async function resolveTaskResultUrl(api: ApiClient, taskId: string): Promise<string | undefined> {
  const response = await api.getJson<TaskStatusResponse>(`/tasks/${encodeURIComponent(taskId)}`);
  return pickResultUrl(response);
}

function pickResultUrl(response: TaskStatusResponse): string | undefined {
  const task = response.task ?? {};
  const record = response.history_record ?? {};
  const result = task.result as Record<string, unknown> | undefined;
  const candidates = [
    record.result_url,
    record.imageUrl,
    record.video_url,
    record.image_url,
    result?.url,
    result?.imageUrl,
    result?.video_url,
    result?.image_url,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

async function downloadUrl(url: string, outDir: string): Promise<Record<string, unknown>> {
  const parsedUrl = validateDownloadUrl(url);
  const response = await fetch(parsedUrl);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  await mkdir(outDir, { recursive: true });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const filename = getDownloadFilename(parsedUrl.href, response.headers.get("content-disposition"));
  const outputPath = await nextAvailablePath(outDir, filename);
  await writeFile(outputPath, bytes);
  return {
    ok: true,
    url: parsedUrl.href,
    output_path: outputPath,
    filename: basename(outputPath),
    size: bytes.byteLength,
  };
}

function validateDownloadUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Download URL must be an absolute URL");
  }

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocalhost && parsed.protocol === "http:")) {
    throw new Error("Download URL must use https, except localhost development URLs");
  }

  const allowedHosts = getAllowedDownloadHosts();
  if (!isAllowedHost(parsed.hostname, allowedHosts)) {
    throw new Error(
      `Download host is not trusted: ${parsed.hostname}. Set MIRAIVFX_DOWNLOAD_HOSTS to add an approved host.`,
    );
  }

  return parsed;
}

function getAllowedDownloadHosts(): string[] {
  const configured = process.env.MIRAIVFX_DOWNLOAD_HOSTS?.split(",") ?? [];
  return [
    "miraivfx.art",
    "api.miraivfx.art",
    "cdn.miraivfx.art",
    ...configured,
  ]
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function getDownloadFilename(url: string, contentDisposition: string | null): string {
  const match = contentDisposition?.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const headerName = match?.[1] ?? match?.[2];
  if (headerName) return sanitizeDownloadFilename(decodeURIComponent(headerName));
  try {
    const parsed = new URL(url);
    const name = basename(parsed.pathname);
    return sanitizeDownloadFilename(name || "download.bin");
  } catch {
    return "download.bin";
  }
}

function sanitizeDownloadFilename(filename: string): string {
  const safe = basename(filename)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+$/, "")
    .trim();
  return safe || "download.bin";
}

async function nextAvailablePath(outDir: string, filename: string): Promise<string> {
  const safeName = sanitizeDownloadFilename(filename);
  const dotIndex = safeName.lastIndexOf(".");
  const stem = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const ext = dotIndex > 0 ? safeName.slice(dotIndex) : "";

  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? join(outDir, safeName) : join(outDir, `${stem}-${index}${ext}`);
    try {
      await stat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw error;
    }
  }

  throw new Error("Could not find an available output filename");
}
