import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getFlagValue, hasFlag } from "../core/args.js";
import { ApiClient } from "../api/client.js";
import { loadRuntimeConfig } from "../core/config.js";
import { openUrl } from "../core/open.js";
import { json, text } from "../core/output.js";
import { handleVCameraCommand, vCameraUsage } from "./v-camera.js";
import { getVCameraCapabilities } from "../v-camera/contract.js";

export async function handleCanvasCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = hasFlag(args, "--json");
  if (subcommand === "v-camera" && args[0] === "capabilities") {
    json(getVCameraCapabilities());
    return;
  }
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
    const fileBuffer = await readFile(filePath);
    const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
    const projectId = getFlagValue(args, "--project-id");
    if (!hasFlag(args, "--force-upload")) {
      const cached = await readUploadCache(fileHash, projectId);
      if (cached) {
        json({ ...cached, sha256: fileHash, reused: true, cache_hit: true });
        return;
      }
    }
    const form = new FormData();
    form.set("file", new Blob([fileBuffer]), basename(filePath));
    if (projectId) form.set("project_id", projectId);
    const response = await api.postForm<UploadResponse>("/files/upload", form);
    const payload = {
      filename: response.filename,
      original_filename: response.original_filename,
      url: response.url,
      path: response.path,
      size: response.size,
      project_id: response.project_id,
      converted_to_jpg: response.converted_to_jpg,
      sha256: fileHash,
      reused: false,
      cache_hit: false,
    };
    await writeUploadCache(fileHash, projectId, payload);
    json(payload);
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

  if (subcommand === "results") {
    const action = args[0] ?? "list";
    const rest = args.slice(1);
    if (action === "list") {
      const payload = await listCanvasResults(api, rest);
      asJson ? json(payload) : text(formatCanvasResults(payload.results));
      return;
    }
    if (action === "download") {
      const payload = await downloadCanvasResults(api, rest);
      asJson ? json(payload) : text(`Downloaded ${payload.downloaded.length} result(s) to ${payload.output_dir}`);
      return;
    }
    if (action === "watch") {
      const payload = await watchCanvasResults(api, rest);
      asJson ? json(payload) : text(`Downloaded ${payload.downloaded.length} result(s) to ${payload.output_dir}`);
      return;
    }
    text("Usage: mir-cli canvas results <list|download|watch> --canvas-id <canvas_id>");
    return;
  }

  if (subcommand === "v-camera") {
    const action = args[0] ?? "";
    if (
      action === "--help"
      || action === "-h"
      || action === "help"
      || hasFlag(args.slice(1), "--help")
      || hasFlag(args.slice(1), "-h")
    ) {
      text(vCameraUsage());
      return;
    }
    if (action === "create") {
      const result = await addGenericNode(api, ["--type", "v-camera", ...args.slice(1)], config.appBase);
      if (result.opened && typeof result.url === "string") await openUrl(result.url);
      asJson
        ? json(result)
        : text(result.dry_run
          ? `Dry run: would add V-camera node ${result.node_id} to ${result.canvas_id}`
          : `Added V-camera node ${result.node_id} to ${result.canvas_id}`);
      return;
    }
    if (!action) {
      text(vCameraUsage());
      return;
    }
    await handleVCameraCommand(api, config.appBase, args, asJson);
    return;
  }

  if (subcommand === "node") {
    const action = args[0] ?? "";
    const rest = args.slice(1);
    if (action === "add") {
      const result = await addGenericNode(api, rest, config.appBase);
      if (result.opened && typeof result.url === "string") {
        await openUrl(result.url);
      }
      asJson
        ? json(result)
        : text(result.dry_run
          ? `Dry run: would add ${result.node_type} node ${result.node_id} to ${result.canvas_id}`
          : `Added ${result.node_type} node ${result.node_id} to ${result.canvas_id}`);
      return;
    }
    if (action === "connect") {
      const result = await connectCanvasNodes(api, rest, config.appBase);
      asJson ? json(result) : text(`Connected ${result.from_node} -> ${result.to_node} on ${result.canvas_id}`);
      return;
    }
    if (action === "disconnect") {
      const result = await disconnectCanvasNodes(api, rest, config.appBase);
      asJson ? json(result) : text(`Disconnected nodes on ${result.canvas_id}`);
      return;
    }
    if (action === "update") {
      const result = await updateCanvasNode(api, rest, config.appBase);
      asJson ? json(result) : text(`Updated node ${result.node_id} on ${result.canvas_id}`);
      return;
    }
    if (action === "delete") {
      const result = await deleteCanvasNode(api, rest, config.appBase);
      asJson ? json(result) : text(`Deleted node ${result.node_id} on ${result.canvas_id}`);
      return;
    }
    if (action === "clone") {
      const result = await cloneCanvasNode(api, rest, config.appBase);
      asJson ? json(result) : text(`Cloned node ${result.source_node_id} to ${result.node_id} on ${result.canvas_id}`);
      return;
    }
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
    const aliasType = NODE_ACTION_ALIASES[action];
    if (aliasType) {
      const result = await addGenericNode(api, [`--type`, aliasType, ...rest], config.appBase);
      if (result.opened && typeof result.url === "string") {
        await openUrl(result.url);
      }
      asJson
        ? json(result)
        : text(result.dry_run
          ? `Dry run: would add ${result.node_type} node ${result.node_id} to ${result.canvas_id}`
          : `Added ${result.node_type} node ${result.node_id} to ${result.canvas_id}`);
      return;
    }
    text("Usage: mir-cli canvas node <add|update|clone|delete|connect|disconnect|add-image|add-reference-image|add-text|add-video|add-audio|add-agent|add-suno|add-seedance|add-vibex|add-runninghub|add-pro-camera|add-panorama-gen|add-blocking-3d|add-v-camera>");
    return;
  }

  if (subcommand === "group") {
    const action = args[0] ?? "";
    const rest = args.slice(1);
    if (action === "add") {
      const result = await addCanvasGroup(api, rest);
      asJson
        ? json(result)
        : text(result.dry_run
          ? `Dry run: would add group ${result.group_id} with ${result.members.length} member(s)`
          : `Added group ${result.group_id} with ${result.members.length} member(s)`);
      return;
    }
    text("Usage: mir-cli canvas group add --canvas-id <canvas_id> --node-ids <id,id,...> [--title <title>] <--dry-run|--yes> [--json]");
    return;
  }

  if (["plan", "deploy", "run"].includes(subcommand)) {
    const payload = manualWebOnlyPayload(`canvas ${subcommand}`);
    asJson ? json(payload) : text(payload.message);
    return;
  }

  text("Usage: mir-cli canvas <list|create|open|capabilities|models|inspect|upload|node|group|v-camera>");
}

const CANVAS_NODE_TYPES = new Set([
  "text",
  "image-item",
  "video-item",
  "image",
  "video",
  "seedance-volc",
  "seedance2-rh-standard",
  "vibex-webapp",
  "frame-extractor",
  "llm",
  "agent",
  "seedance",
  "suno",
  "relay",
  "upscale",
  "runninghub",
  "seedance2-runninghub",
  "sora2-runninghub",
  "rh-config",
  "rh-param",
  "rh-main",
  "drawing-board",
  "pro-camera",
  "smart-split",
  "panorama-split",
  "panorama-gen",
  "blocking-3d",
  "v-camera",
  "audio",
  "file",
  "resize",
]);

const MATERIAL_NODE_TYPES = new Set(["image-item", "video-item", "audio", "file", "text"]);
const VIBEX_SEEDANCE_APP_URL =
  "https://vibex.runninghub.cn/p/app-9105545b19ba4f339164bd5125d177a9/?inviteCode=rh-v1118&mvfxBridge=20260626-sso-callback&mvfxNode=1";

const NODE_ACTION_ALIASES: Record<string, string> = {
  "add-text": "text",
  "add-video": "video",
  "add-audio": "audio",
  "add-video-reference": "video-item",
  "add-audio-reference": "audio",
  "add-file": "file",
  "add-agent": "agent",
  "add-llm": "llm",
  "add-suno": "suno",
  "add-seedance": "seedance",
  "add-seedance-volc": "seedance-volc",
  "add-seedance-rh": "seedance2-rh-standard",
  "add-vibex": "vibex-webapp",
  "add-vibex-webapp": "vibex-webapp",
  "add-runninghub": "runninghub",
  "add-pro-camera": "pro-camera",
  "add-panorama-gen": "panorama-gen",
  "add-blocking-3d": "blocking-3d",
  "add-v-camera": "v-camera",
  "add-drawing-board": "drawing-board",
  "add-frame-extractor": "frame-extractor",
  "add-upscale": "upscale",
  "add-resize": "resize",
  "add-smart-split": "smart-split",
  "add-panorama-split": "panorama-split",
  "add-relay": "relay",
};

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

async function listCanvasResults(api: ApiClient, args: string[]): Promise<CanvasResultsPayload> {
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const limit = getFlagValue(args, "--limit") ?? "100";
  const response = await api.getJson<CanvasResultsResponse>(
    `/canvas/${encodeURIComponent(canvasId)}/results?limit=${encodeURIComponent(limit)}`,
  );
  if (!response.success || !response.data) {
    throw new Error(response.error ?? "Failed to list canvas results");
  }
  return response.data;
}

async function downloadCanvasResults(api: ApiClient, args: string[]): Promise<CanvasResultsDownloadPayload> {
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const resultId = getFlagValue(args, "--result-id");
  const outputDir = getFlagValue(args, "--output") ?? join(process.cwd(), "miraivfx-results", canvasId);
  const resultsPayload = await listCanvasResults(api, ["--canvas-id", canvasId, "--limit", getFlagValue(args, "--limit") ?? "100"]);
  const targets = resultId
    ? resultsPayload.results.filter((item) => item.id === resultId)
    : resultsPayload.results;
  if (resultId && targets.length === 0) {
    throw new Error(`Result not found in canvas ${canvasId}: ${resultId}`);
  }
  const downloaded = await downloadResultItems(api, outputDir, targets, hasFlag(args, "--overwrite"));
  return {
    ok: true,
    canvas_id: canvasId,
    output_dir: outputDir,
    downloaded,
    skipped: targets.length - downloaded.length,
    result_count: resultsPayload.results.length,
  };
}

async function watchCanvasResults(api: ApiClient, args: string[]): Promise<CanvasResultsDownloadPayload> {
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const outputDir = getFlagValue(args, "--output") ?? join(process.cwd(), "miraivfx-results", canvasId);
  const intervalMs = Math.max(5, Number(getFlagValue(args, "--interval") ?? "15")) * 1000;
  const timeoutMs = Math.max(10, Number(getFlagValue(args, "--timeout") ?? "7200")) * 1000;
  const maxDownloads = Math.max(1, Number(getFlagValue(args, "--max-downloads") ?? "100"));
  const overwrite = hasFlag(args, "--overwrite");
  const startedAt = Date.now();
  const downloaded: DownloadedResult[] = [];
  const seen = new Set((await readResultsManifest(outputDir)).results.map((item) => item.id));

  while (Date.now() - startedAt <= timeoutMs && downloaded.length < maxDownloads) {
    const payload = await listCanvasResults(api, ["--canvas-id", canvasId, "--limit", String(maxDownloads)]);
    const targets = payload.results.filter((item) => !seen.has(item.id)).slice(0, maxDownloads - downloaded.length);
    const batch = await downloadResultItems(api, outputDir, targets, overwrite);
    for (const item of batch) {
      downloaded.push(item);
      seen.add(item.id);
    }
    if (hasFlag(args, "--once")) break;
    if (downloaded.length >= maxDownloads) break;
    await delay(intervalMs);
  }

  return {
    ok: true,
    canvas_id: canvasId,
    output_dir: outputDir,
    downloaded,
    skipped: 0,
    result_count: downloaded.length,
  };
}

async function downloadResultItems(
  api: ApiClient,
  outputDir: string,
  results: CanvasResultItem[],
  overwrite: boolean,
): Promise<DownloadedResult[]> {
  await mkdir(outputDir, { recursive: true });
  const manifest = await readResultsManifest(outputDir);
  const downloaded: DownloadedResult[] = [];
  const existingIds = new Set(manifest.results.map((item) => item.id));

  for (const result of results) {
    if (!overwrite && existingIds.has(result.id)) {
      continue;
    }
    const filename = uniqueFilename(outputDir, safeFilename(result.filename || `${result.id}.bin`), overwrite);
    const response = await api.getBinary(result.download_url);
    const target = join(outputDir, filename);
    await writeFile(target, response.data, { flag: overwrite ? "w" : "wx" });
    const item = {
      id: result.id,
      canvas_id: result.canvas_id,
      node_id: result.node_id ?? null,
      type: result.type,
      filename,
      path: target,
      bytes: response.data.byteLength,
      downloaded_at: new Date().toISOString(),
    };
    downloaded.push(item);
    manifest.results = manifest.results.filter((entry) => entry.id !== result.id);
    manifest.results.push(item);
    existingIds.add(result.id);
    await writeResultsManifest(outputDir, manifest);
  }

  return downloaded;
}

async function readResultsManifest(outputDir: string): Promise<ResultsManifest> {
  try {
    const raw = await readFile(join(outputDir, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<ResultsManifest>;
    return {
      schema: "miraivfx-cli-results-v1",
      results: Array.isArray(parsed.results) ? parsed.results as DownloadedResult[] : [],
    };
  } catch {
    return { schema: "miraivfx-cli-results-v1", results: [] };
  }
}

async function writeResultsManifest(outputDir: string, manifest: ResultsManifest): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function formatCanvasResults(results: CanvasResultItem[]): string {
  if (!results.length) return "No completed downloadable results found for this canvas.";
  return results
    .map((item) => `${item.id}\t${item.type}\t${item.node_title ?? item.node_id ?? "-"}\t${item.filename}`)
    .join("\n");
}

function safeFilename(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+$/, "_");
  return cleaned.slice(0, 180) || "result.bin";
}

function uniqueFilename(outputDir: string, filename: string, overwrite: boolean): string {
  if (overwrite) return filename;
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let candidate = filename;
  let index = 1;
  while (true) {
    if (existsSync(join(outputDir, candidate))) {
      candidate = `${stem}-${index}${ext}`;
      index += 1;
      continue;
    }
    return candidate;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    group_count: canvas.groups?.length ?? 0,
    node_type_counts: nodeTypeCounts,
    revision: canvas.revision ?? 0,
    clientModifiedAt: canvas.clientModifiedAt ?? 0,
    updatedAt: canvas.updatedAt,
  };
}

function requireCanvasRevision(canvas: CanvasData | undefined): number {
  const revision = canvas?.revision;
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new Error("Canvas response is missing a valid revision; refusing an unprotected strict write");
  }
  return Number(revision);
}

const CANVAS_GROUP_PADDING = 48;
const CANVAS_GROUP_MIN_SIZE = 180;

function parseIdFlags(args: string[], names: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (!names.includes(args[index])) continue;
    const raw = args[index + 1];
    if (!raw || raw.startsWith("--")) {
      throw new Error(`${args[index]} requires a value`);
    }
    values.push(...raw.split(",").map((value) => value.trim()).filter(Boolean));
    index += 1;
  }
  return [...new Set(values)];
}

function createCanvasGroup(
  nodes: CanvasNodeRecord[],
  memberIds: string[],
  options: CreateCanvasGroupOptions,
): CanvasGroupRecord {
  if (!memberIds.length) {
    throw new Error("A canvas group requires at least one member node");
  }
  const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
  const memberNodes = memberIds.map((nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`Group member node not found: ${nodeId}`);
    return node;
  });
  const minX = Math.min(...memberNodes.map((node) => Number(node.x) || 0));
  const minY = Math.min(...memberNodes.map((node) => Number(node.y) || 0));
  const maxX = Math.max(...memberNodes.map((node) => (Number(node.x) || 0) + (Number(node.width) || 280)));
  const maxY = Math.max(...memberNodes.map((node) => (Number(node.y) || 0) + (Number(node.height) || 280)));
  const now = Date.now();
  return {
    id: options.id || randomUUID(),
    title: options.title || "Group",
    nodeIds: memberIds,
    x: options.x ?? minX - CANVAS_GROUP_PADDING,
    y: options.y ?? minY - CANVAS_GROUP_PADDING,
    width: Math.max(CANVAS_GROUP_MIN_SIZE, options.width ?? maxX - minX + CANVAS_GROUP_PADDING * 2),
    height: Math.max(CANVAS_GROUP_MIN_SIZE, options.height ?? maxY - minY + CANVAS_GROUP_PADDING * 2),
    color: options.color || "#64748b",
    collapsed: options.collapsed === true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function addCanvasGroup(api: ApiClient, args: string[]): Promise<CanvasGroupMutationResult> {
  const dryRun = hasFlag(args, "--dry-run");
  if (!dryRun && !hasFlag(args, "--yes")) {
    throw new Error("Creating a canvas group requires explicit --yes");
  }
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const memberIds = parseIdFlags(args, ["--node-ids", "--node-id"]);
  if (!memberIds.length) {
    throw new Error("Creating a canvas group requires --node-ids or --node-id");
  }
  const canvas = await getCanvasData(api, canvasId);
  const baseRevision = requireCanvasRevision(canvas);
  const group = createCanvasGroup(canvas.nodes as CanvasNodeRecord[], memberIds, {
    id: getFlagValue(args, "--group-id"),
    title: getFlagValue(args, "--title") ?? "Group",
    color: getFlagValue(args, "--color"),
    x: parseOptionalNumber(getFlagValue(args, "--x"), "--x"),
    y: parseOptionalNumber(getFlagValue(args, "--y"), "--y"),
    width: parseOptionalNumber(getFlagValue(args, "--width"), "--width"),
    height: parseOptionalNumber(getFlagValue(args, "--height"), "--height"),
    collapsed: hasFlag(args, "--collapsed"),
  });
  const ops = [{ type: "add_group", group }];

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      canvas_id: canvasId,
      group_id: group.id,
      members: group.nodeIds,
      group,
      revision: baseRevision,
      ops,
    };
  }

  const now = Date.now();
  const update = await api.postJson<CanvasOpsResponse>(`/canvas/${encodeURIComponent(canvasId)}/ops`, {
    baseRevision,
    conflictPolicy: "strict",
    clientModifiedAt: now,
    ops,
  });
  if (!update.success) {
    throw new Error(update.error ?? "Failed to add canvas group");
  }
  if (update.data?.ignored) {
    throw new Error("Canvas update was ignored because the server has a newer version. Re-inspect the canvas and retry.");
  }
  return {
    ok: true,
    dry_run: false,
    canvas_id: canvasId,
    project_id: update.data?.project_id,
    group_id: update.data?.group_id ?? group.id,
    members: update.data?.members ?? group.nodeIds,
    group: update.data?.groups?.[0] ?? group,
    revision: update.data?.revision,
    clientModifiedAt: update.data?.clientModifiedAt,
    ops,
  };
}

export async function addGenericNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  const dryRun = hasFlag(args, "--dry-run");
  if (!dryRun && !hasFlag(args, "--yes")) {
    throw new Error("Creating a canvas node requires explicit --yes");
  }
  const shouldOpen = hasFlag(args, "--open");
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const nodeType = requireValue(getFlagValue(args, "--type"), "--type");
  if (!CANVAS_NODE_TYPES.has(nodeType)) {
    throw new Error(`Unsupported node type: ${nodeType}`);
  }
  const content = getFlagValue(args, "--content") ?? getFlagValue(args, "--prompt") ?? "";
  const rawTitle = getFlagValue(args, "--title");
  const title = getFlagValue(args, "--node-title") ?? defaultTitleForNode(nodeType);
  const requestedX = parseOptionalNumber(getFlagValue(args, "--x"), "--x");
  const requestedY = parseOptionalNumber(getFlagValue(args, "--y"), "--y");
  const groupTitle = getFlagValue(args, "--group-title");
  const groupWith = parseIdFlags(args, ["--group-with"]);
  if (groupWith.length > 0 && !groupTitle) {
    throw new Error("--group-with requires --group-title");
  }
  const shape = defaultShapeForNode(nodeType);
  const canvas = requestedX === undefined || requestedY === undefined || groupTitle
    ? await getCanvasData(api, canvasId)
    : undefined;
  const position = resolveNodePosition(canvas, nodeType, shape, requestedX, requestedY);
  const x = position.x;
  const y = position.y;
  const width = parseOptionalNumber(getFlagValue(args, "--width"), "--width") ?? shape.width;
  const height = parseOptionalNumber(getFlagValue(args, "--height"), "--height") ?? shape.height;
  const status = getFlagValue(args, "--status") ?? defaultStatusForNode(nodeType, content);
  const model = getFlagValue(args, "--model");
  const dataJson = parseSettings(getFlagValue(args, "--data-json")) ?? {};
  const nodeData = normalizeNodeDataForType(nodeType, args, content, rawTitle, dataJson);
  const settings = parseSettings(getFlagValue(args, "--settings-json"));
  const connectTo = getFlagValue(args, "--connect-to");

  if (
    nodeType === "v-camera"
    && (Object.keys(dataJson).length > 0 || settings || model || content || rawTitle)
  ) {
    throw new Error("Create the Virtual Shoot node first, then use 'mir-cli canvas v-camera' commands to configure it");
  }

  if (model) {
    const modelTask = modelTaskForNode(nodeType);
    if (modelTask) await assertModelAvailable(api, modelTask, model);
  }

  if (content && MATERIAL_NODE_TYPES.has(nodeType) && looksLikeUrl(content)) {
    validateCanvasAssetUrl(content);
  }

  const now = Date.now();
  const node: CanvasNodeRecord = {
    id: randomUUID(),
    x,
    y,
    width,
    height,
    type: nodeType,
    content,
    title,
    data: nodeType === "v-camera" ? {} : {
      ...defaultDataForNode(nodeType),
      ...nodeData,
      ...(settings ? { settings } : {}),
      ...(content && !MATERIAL_NODE_TYPES.has(nodeType) && nodeType !== "suno" ? { prompt: content } : {}),
      ...(content && MATERIAL_NODE_TYPES.has(nodeType) && looksLikeUrl(content) ? materialDataForNode(nodeType, content) : {}),
      ...(model ? modelDataForNode(nodeType, model) : {}),
      createdBy: "mir-cli",
      createdAt: new Date(now).toISOString(),
    },
    status,
  };
  const connection = connectTo
    ? {
        type: "connect",
        id: randomUUID(),
        fromNode: node.id,
        toNode: connectTo,
      }
    : undefined;
  const group = groupTitle
    ? createCanvasGroup(
        [...((canvas?.nodes ?? []) as CanvasNodeRecord[]), node],
        [...new Set([node.id, ...groupWith])],
        {
          id: getFlagValue(args, "--group-id"),
          title: groupTitle,
          color: getFlagValue(args, "--group-color"),
          x: parseOptionalNumber(getFlagValue(args, "--group-x"), "--group-x"),
          y: parseOptionalNumber(getFlagValue(args, "--group-y"), "--group-y"),
          width: parseOptionalNumber(getFlagValue(args, "--group-width"), "--group-width"),
          height: parseOptionalNumber(getFlagValue(args, "--group-height"), "--group-height"),
          collapsed: hasFlag(args, "--group-collapsed"),
        },
      )
    : undefined;
  const baseRevision = group ? requireCanvasRevision(canvas) : undefined;
  const ops = [
    { type: "add_node", node },
    ...(connection ? [connection] : []),
    ...(group ? [{ type: "add_group", group }] : []),
  ];

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      canvas_id: canvasId,
      node_id: node.id,
      node_type: node.type,
      x,
      y,
      width,
      height,
      layout: { x, y, width, height },
      title,
      status,
      connected_to: connectTo ?? null,
      group_id: group?.id ?? null,
      members: group?.nodeIds ?? [],
      opened: false,
      ops,
    };
  }

  const update = await api.postJson<CanvasOpsResponse>(`/canvas/${encodeURIComponent(canvasId)}/ops`, {
    ...(baseRevision !== undefined ? { baseRevision } : {}),
    conflictPolicy: group ? "strict" : "merge",
    clientModifiedAt: now,
    ops,
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
    x,
    y,
    width,
    height,
    layout: { x, y, width, height },
    title,
    status,
    connected_to: connectTo ?? null,
    group_id: update.data?.group_id ?? group?.id ?? null,
    members: update.data?.members ?? group?.nodeIds ?? [],
    revision: update.data?.revision,
    clientModifiedAt: update.data?.clientModifiedAt,
    generation_started: false,
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
  const title = getFlagValue(args, "--node-title") ?? "AI 生图";
  const requestedX = parseOptionalNumber(getFlagValue(args, "--x"), "--x");
  const requestedY = parseOptionalNumber(getFlagValue(args, "--y"), "--y");
  const shape = defaultShapeForNode("image");
  const canvas = requestedX === undefined || requestedY === undefined ? await getCanvasData(api, canvasId) : undefined;
  const position = resolveNodePosition(canvas, "image", shape, requestedX, requestedY);
  const x = position.x;
  const y = position.y;
  const settings = parseSettings(getFlagValue(args, "--settings-json"));

  if (model) {
    await assertModelAvailable(api, "image", model);
  }

  const now = Date.now();
  const node: CanvasNodeRecord = {
    id: randomUUID(),
    x,
    y,
    width: shape.width,
    height: shape.height,
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

async function connectCanvasNodes(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Creating a canvas connection requires explicit --yes");
  }
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const fromNode = requireValue(getFlagValue(args, "--from-node") ?? getFlagValue(args, "--from"), "--from-node");
  const toNode = requireValue(getFlagValue(args, "--to-node") ?? getFlagValue(args, "--to"), "--to-node");
  const now = Date.now();

  const update = await api.postJson<CanvasOpsResponse>(`/canvas/${encodeURIComponent(canvasId)}/ops`, {
    conflictPolicy: "merge",
    clientModifiedAt: now,
    ops: [
      {
        type: "connect",
        id: randomUUID(),
        fromNode,
        toNode,
      },
    ],
  });

  if (!update.success) {
    throw new Error(update.error ?? "Failed to connect canvas nodes");
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
    from_node: fromNode,
    to_node: toNode,
    revision: update.data?.revision,
    clientModifiedAt: update.data?.clientModifiedAt,
  };
}

async function disconnectCanvasNodes(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Removing a canvas connection requires explicit --yes");
  }
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const fromNode = getFlagValue(args, "--from-node") ?? getFlagValue(args, "--from");
  const toNode = getFlagValue(args, "--to-node") ?? getFlagValue(args, "--to");
  const connectionId = getFlagValue(args, "--connection-id");
  if (!connectionId && (!fromNode || !toNode)) {
    throw new Error("Disconnect requires --connection-id or both --from-node and --to-node");
  }
  const canvas = await getCanvasData(api, canvasId);
  const result = await applyCanvasOps(api, appBase, canvas, [
    {
      type: "disconnect",
      ...(connectionId ? { connectionId } : {}),
      ...(fromNode ? { fromNode } : {}),
      ...(toNode ? { toNode } : {}),
    },
  ]);
  return { ...result, connection_id: connectionId ?? null, from_node: fromNode ?? null, to_node: toNode ?? null };
}

async function updateCanvasNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Updating a canvas node requires explicit --yes");
  }
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const nodeId = requireValue(getFlagValue(args, "--node-id") ?? getFlagValue(args, "--id"), "--node-id");
  const canvas = await getCanvasData(api, canvasId);
  const node = findCanvasNode(canvas, nodeId);
  const patch: Record<string, unknown> = {};
  const rawTitle = getFlagValue(args, "--title");
  const content = getFlagValue(args, "--content") ?? getFlagValue(args, "--prompt");
  const x = parseOptionalNumber(getFlagValue(args, "--x"), "--x");
  const y = parseOptionalNumber(getFlagValue(args, "--y"), "--y");
  const width = parseOptionalNumber(getFlagValue(args, "--width"), "--width");
  const height = parseOptionalNumber(getFlagValue(args, "--height"), "--height");
  const dataJson = parseSettings(getFlagValue(args, "--data-json"));
  const settings = parseSettings(getFlagValue(args, "--settings-json"));
  const model = getFlagValue(args, "--model");

  const nodeType = String((node as any).type || "");
  if (
    nodeType === "v-camera"
    && (dataJson || settings || model || content !== undefined || rawTitle !== undefined)
  ) {
    throw new Error("Use 'mir-cli canvas v-camera' commands to update Virtual Shoot data");
  }
  const title = getFlagValue(args, "--node-title");
  if (title !== undefined) patch.title = title;
  if (content !== undefined) patch.content = content;
  if (x !== undefined) patch.x = x;
  if (y !== undefined) patch.y = y;
  if (width !== undefined) patch.width = width;
  if (height !== undefined) patch.height = height;

  if (model) {
    const modelTask = modelTaskForNode(nodeType);
    if (modelTask) await assertModelAvailable(api, modelTask, model);
  }
  const normalizedDataPatch = normalizeNodeDataForType(nodeType, args, content ?? "", rawTitle ?? title, dataJson ?? {});
  const dataPatch = {
    ...normalizedDataPatch,
    ...(settings ? { settings } : {}),
    ...(content !== undefined && !MATERIAL_NODE_TYPES.has(nodeType) ? { prompt: content } : {}),
    ...(model ? modelDataForNode(nodeType, model) : {}),
    updatedBy: "mir-cli",
    updatedAt: new Date().toISOString(),
  };
  if (Object.keys(dataPatch).length > 2 || dataJson || settings || model || content !== undefined) {
    patch.data = dataPatch;
  }
  if (!Object.keys(patch).length) {
    throw new Error("No update fields provided");
  }

  const result = await applyCanvasOps(api, appBase, canvas, [{ type: "update_node", nodeId, patch }]);
  return { ...result, node_id: nodeId, patch };
}

async function deleteCanvasNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Deleting a canvas node requires explicit --yes");
  }
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const nodeId = requireValue(getFlagValue(args, "--node-id") ?? getFlagValue(args, "--id"), "--node-id");
  const canvas = await getCanvasData(api, canvasId);
  findCanvasNode(canvas, nodeId);
  const result = await applyCanvasOps(api, appBase, canvas, [{ type: "delete_node", nodeId }]);
  return { ...result, node_id: nodeId };
}

async function cloneCanvasNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Cloning a canvas node requires explicit --yes");
  }
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const sourceNodeId = requireValue(getFlagValue(args, "--node-id") ?? getFlagValue(args, "--source-node"), "--node-id");
  const canvas = await getCanvasData(api, canvasId);
  const source = findCanvasNode(canvas, sourceNodeId) as unknown as CanvasNodeRecord;
  const requestedX = parseOptionalNumber(getFlagValue(args, "--x"), "--x");
  const requestedY = parseOptionalNumber(getFlagValue(args, "--y"), "--y");
  const shape = {
    width: Number(source.width || defaultShapeForNode(String(source.type)).width),
    height: Number(source.height || defaultShapeForNode(String(source.type)).height),
  };
  const position = resolveNodePosition(
    canvas,
    String(source.type),
    shape,
    requestedX ?? (Number(source.x || 0) + shape.width + 80),
    requestedY ?? Number(source.y || 0),
  );
  const x = position.x;
  const y = position.y;
  const title = getFlagValue(args, "--node-title") ?? String(source.title || source.type || "Node");
  const content = getFlagValue(args, "--content") ?? getFlagValue(args, "--prompt") ?? String(source.content || "");
  const dataJson = parseSettings(getFlagValue(args, "--data-json")) ?? {};
  const settings = parseSettings(getFlagValue(args, "--settings-json"));
  const clonedNode: CanvasNodeRecord = {
    id: randomUUID(),
    x,
    y,
    width: shape.width,
    height: shape.height,
    type: String(source.type),
    content,
    title,
    data: {
      ...(typeof source.data === "object" && source.data ? source.data : {}),
      ...dataJson,
      ...(settings ? { settings } : {}),
      ...(content && !MATERIAL_NODE_TYPES.has(String(source.type)) ? { prompt: content } : {}),
      clonedFrom: sourceNodeId,
      createdBy: "mir-cli",
      createdAt: new Date().toISOString(),
    },
    status: defaultStatusForNode(String(source.type), content),
  };
  const ops: Array<Record<string, unknown>> = [{ type: "add_node", node: clonedNode }];
  if (hasFlag(args, "--copy-inputs")) {
    for (const connection of canvas.connections ?? []) {
      if (
        connection &&
        typeof connection === "object" &&
        String((connection as any).toNode || "") === sourceNodeId
      ) {
        ops.push({
          type: "connect",
          id: randomUUID(),
          fromNode: String((connection as any).fromNode),
          toNode: clonedNode.id,
        });
      }
    }
  }
  const result = await applyCanvasOps(api, appBase, canvas, ops);
  return { ...result, source_node_id: sourceNodeId, node_id: clonedNode.id, node_type: clonedNode.type };
}

async function addReferenceImageNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Creating a canvas node requires explicit --yes");
  }
  const shouldOpen = hasFlag(args, "--open");
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const imageUrl = requireValue(getFlagValue(args, "--url"), "--url");
  validateCanvasAssetUrl(imageUrl);
  const title = getFlagValue(args, "--node-title") ?? "参考图";
  const requestedX = parseOptionalNumber(getFlagValue(args, "--x"), "--x");
  const requestedY = parseOptionalNumber(getFlagValue(args, "--y"), "--y");
  const connectTo = getFlagValue(args, "--connect-to");
  const canvas = await getCanvasData(api, canvasId);
  const existing = hasFlag(args, "--force-new") || hasFlag(args, "--duplicate")
    ? undefined
    : findMaterialNodeByUrl(canvas, imageUrl);
  if (existing) {
    const ops = connectTo && !hasConnection(canvas, String(existing.id), connectTo)
      ? [{ type: "connect", id: randomUUID(), fromNode: String(existing.id), toNode: connectTo }]
      : [];
    const result = ops.length ? await applyCanvasOps(api, appBase, canvas, ops) : canvasResult(appBase, canvas);
    return {
      ...result,
      node_id: String(existing.id),
      node_type: String(existing.type || "image-item"),
      image_url: imageUrl,
      connected_to: connectTo ?? null,
      reused_node: true,
    };
  }
  const shape = defaultShapeForNode("image-item");
  const position = resolveNodePosition(canvas, "image-item", shape, requestedX, requestedY);
  const x = position.x;
  const y = position.y;

  const now = Date.now();
  const node: CanvasNodeRecord = {
    id: randomUUID(),
    x,
    y,
    width: shape.width,
    height: shape.height,
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

async function getCanvasData(api: ApiClient, canvasId: string): Promise<CanvasData> {
  const response = await api.getJson<GetCanvasResponse>(`/canvas/${encodeURIComponent(canvasId)}`);
  if (!response.success || !response.data) {
    throw new Error(response.error ?? "Canvas not found");
  }
  return response.data;
}

function findCanvasNode(canvas: CanvasData, nodeId: string): Record<string, unknown> {
  const node = (canvas.nodes ?? []).find(
    (item) => item && typeof item === "object" && String((item as any).id || "") === nodeId,
  );
  if (!node || typeof node !== "object") {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return node as Record<string, unknown>;
}

async function applyCanvasOps(
  api: ApiClient,
  appBase: string,
  canvas: CanvasData,
  ops: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const now = Date.now();
  const update = await api.postJson<CanvasOpsResponse>(`/canvas/${encodeURIComponent(canvas.id)}/ops`, {
    conflictPolicy: "strict",
    baseRevision: canvas.revision ?? 0,
    clientModifiedAt: now,
    ops,
  });

  if (!update.success) {
    throw new Error(update.error ?? "Failed to apply canvas ops");
  }
  if (update.data?.ignored) {
    throw new Error("Canvas changed after inspection. Re-inspect the canvas and retry.");
  }

  const projectId = requireValue(update.data?.project_id, "ops response project_id");
  const url = `${appBase}/canvas?projectId=${encodeURIComponent(projectId)}&canvasId=${encodeURIComponent(canvas.id)}`;
  return {
    ok: true,
    canvas_id: canvas.id,
    project_id: projectId,
    url,
    revision: update.data?.revision,
    clientModifiedAt: update.data?.clientModifiedAt,
    created_nodes: update.data?.nodes ?? [],
    created_connections: update.data?.connections ?? [],
    updated_nodes: update.data?.updated_nodes ?? [],
    deleted_node_ids: update.data?.deleted_node_ids ?? [],
    deleted_connection_ids: update.data?.deleted_connection_ids ?? [],
  };
}

function canvasResult(appBase: string, canvas: CanvasData): Record<string, unknown> {
  const url = `${appBase}/canvas?projectId=${encodeURIComponent(canvas.project_id)}&canvasId=${encodeURIComponent(canvas.id)}`;
  return {
    ok: true,
    canvas_id: canvas.id,
    project_id: canvas.project_id,
    url,
    revision: canvas.revision,
    clientModifiedAt: canvas.clientModifiedAt,
    created_nodes: [],
    created_connections: [],
    updated_nodes: [],
    deleted_node_ids: [],
    deleted_connection_ids: [],
  };
}

function resolveNodePosition(
  canvas: CanvasData | undefined,
  nodeType: string,
  shape: { width: number; height: number },
  requestedX: number | undefined,
  requestedY: number | undefined,
): { x: number; y: number } {
  const base = defaultLanePosition(nodeType);
  const start = {
    x: requestedX ?? base.x,
    y: requestedY ?? base.y,
  };
  if (!canvas) return start;

  const gap = 80;
  const rects = canvas.nodes
    .map(nodeRect)
    .filter((rect): rect is NodeRect => Boolean(rect));
  let candidate = start;
  for (let index = 0; index < 400; index += 1) {
    const overlaps = rects.some((rect) => rectsOverlap(candidate, shape, rect, gap));
    if (!overlaps) return candidate;
    candidate = nextLanePosition(start, shape, index + 1, nodeType);
  }
  return candidate;
}

function defaultLanePosition(nodeType: string): { x: number; y: number } {
  if (MATERIAL_NODE_TYPES.has(nodeType)) return { x: -520, y: 0 };
  if (nodeType === "relay") return { x: -80, y: 0 };
  return { x: 0, y: 0 };
}

function nextLanePosition(
  start: { x: number; y: number },
  shape: { width: number; height: number },
  index: number,
  nodeType: string,
): { x: number; y: number } {
  const verticalStep = shape.height + 80;
  if (MATERIAL_NODE_TYPES.has(nodeType)) {
    const rows = 4;
    return {
      x: start.x - Math.floor(index / rows) * (shape.width + 80),
      y: start.y + (index % rows) * verticalStep,
    };
  }
  return {
    x: start.x + Math.floor(index / 3) * (shape.width + 120),
    y: start.y + (index % 3) * verticalStep,
  };
}

function nodeRect(value: unknown): NodeRect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const x = Number(item.x);
  const y = Number(item.y);
  const width = Number(item.width || defaultShapeForNode(String(item.type || "")).width);
  const height = Number(item.height || defaultShapeForNode(String(item.type || "")).height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return { x, y, width, height };
}

function rectsOverlap(
  candidate: { x: number; y: number },
  shape: { width: number; height: number },
  rect: NodeRect,
  gap: number,
): boolean {
  return (
    candidate.x < rect.x + rect.width + gap &&
    candidate.x + shape.width + gap > rect.x &&
    candidate.y < rect.y + rect.height + gap &&
    candidate.y + shape.height + gap > rect.y
  );
}

function findMaterialNodeByUrl(canvas: CanvasData, url: string): Record<string, unknown> | undefined {
  return (canvas.nodes ?? []).find((node) => {
    if (!node || typeof node !== "object") return false;
    const item = node as Record<string, unknown>;
    if (!MATERIAL_NODE_TYPES.has(String(item.type || ""))) return false;
    const data = item.data && typeof item.data === "object" ? item.data as Record<string, unknown> : {};
    return String(item.content || "") === url || String(data.url || "") === url;
  }) as Record<string, unknown> | undefined;
}

function hasConnection(canvas: CanvasData, fromNode: string, toNode: string): boolean {
  return (canvas.connections ?? []).some((connection) => {
    if (!connection || typeof connection !== "object") return false;
    const item = connection as Record<string, unknown>;
    return String(item.fromNode || "") === fromNode && String(item.toNode || "") === toNode;
  });
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

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function defaultShapeForNode(type: string): { width: number; height: number } {
  if (type === "relay") return { width: 50, height: 50 };
  if (type === "text" || type === "llm" || type === "agent" || type === "seedance") {
    return { width: 320, height: type === "agent" || type === "seedance" ? 420 : 280 };
  }
  if (type === "pro-camera" || type === "image") return { width: 600, height: 360 };
  if (type === "video") return { width: 500, height: 260 };
  if (type === "suno") return { width: 440, height: 560 };
  if (type === "panorama-split") return { width: 360, height: 420 };
  if (type === "panorama-gen") return { width: 360, height: 320 };
  if (type === "blocking-3d") return { width: 640, height: 520 };
  if (type === "v-camera") return { width: 860, height: 640 };
  if (type === "runninghub" || type === "seedance2-runninghub" || type === "sora2-runninghub") return { width: 340, height: 520 };
  if (type === "vibex-webapp") return { width: 860, height: 640 };
  if (type === "seedance-volc" || type === "seedance2-rh-standard") return { width: 420, height: 580 };
  if (type === "video-item") return { width: 320, height: 240 };
  if (type === "audio") return { width: 300, height: 100 };
  return { width: 280, height: 280 };
}

function defaultTitleForNode(type: string): string | undefined {
  const titles: Record<string, string> = {
    text: "文本便签",
    image: "AI 生图",
    "image-item": "参考图",
    video: "视频生成",
    "video-item": "视频素材",
    audio: "音频素材",
    file: "文件素材",
    agent: "LLM生成器",
    llm: "LLM",
    seedance: "Seedance 2.0",
    suno: "Suno 音乐",
    "seedance-volc": "seedance2.0-火山版",
    "seedance2-rh-standard": "seedance2.0-RH版",
    "vibex-webapp": "seedance2.0限时7.5折",
    runninghub: "RunningHub",
    "seedance2-runninghub": "Seedance RunningHub",
    "sora2-runninghub": "Sora RunningHub",
    "pro-camera": "专业相机",
    "panorama-gen": "全景图生成",
    "panorama-split": "全景预览",
    "blocking-3d": "站位图",
    "v-camera": "虚拟实拍",
    "drawing-board": "画板",
    "frame-extractor": "抽帧",
    upscale: "超分",
    resize: "调整尺寸",
    "smart-split": "智能切分",
    relay: "集线器",
    "rh-main": "RH 主节点",
    "rh-param": "RH 参数",
    "rh-config": "RH 配置",
  };
  return titles[type];
}

function defaultStatusForNode(type: string, content: string): "idle" | "completed" {
  if (MATERIAL_NODE_TYPES.has(type) && content) return "completed";
  return "idle";
}

function defaultDataForNode(type: string): Record<string, unknown> {
  if (type === "suno") {
    return { sunoModel: "suno", sunoVersion: "chirp-fenix", sunoMode: "description", sunoInstrumental: false };
  }
  if (type === "seedance-volc") {
    return { model: "seedance2.0-full", ratio: "16:9", resolution: "720p", duration: 5, watermark: false, generate_audio: true };
  }
  if (type === "seedance2-rh-standard") {
    return {
      model: "seedance2.0-full",
      ratio: "adaptive",
      resolution: "720p",
      duration: "5",
      generateAudio: true,
      realPersonMode: true,
      conversionSlots: ["all"],
      returnLastFrame: false,
      seed: -1,
    };
  }
  if (type === "vibex-webapp") {
    return {
      webApp: {
        appUrl: VIBEX_SEEDANCE_APP_URL,
        provider: "vibex",
        authMode: "runninghub-user-login",
      },
      ratio: "adaptive",
      resolution: "720p",
      duration: "5",
      generateAudio: true,
      returnLastFrame: false,
    };
  }
  if (type === "panorama-gen") {
    return { panoramaSupplementPrompt: "", panoramaQuality: "2k" };
  }
  if (type === "blocking-3d") {
    return { blockingAspect: "16:9" };
  }
  if (type === "v-camera") {
    return {};
  }
  if (type === "drawing-board") {
    return { boardElements: [], boardWidth: 1024, boardHeight: 1024 };
  }
  if (type === "resize") {
    return { resizeMode: "longest", resizeWidth: 1024, resizeHeight: 1024 };
  }
  if (type === "smart-split") {
    return { splitRows: 3, splitCols: 3, upscale2k: false };
  }
  return {};
}

function normalizeNodeDataForType(
  type: string,
  args: string[],
  content: string,
  nodeTitle: string | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...data };

  if (type === "suno") return normalizeSunoData(args, content, nodeTitle, normalized);
  if (type === "image") return normalizeImageData(args, normalized);
  if (type === "video") return normalizeVideoData(args, normalized);
  if (type === "llm" || type === "agent" || type === "seedance") return normalizeLlmData(args, normalized);
  if (type === "seedance-volc" || type === "seedance2-rh-standard") return normalizeSeedanceVideoData(type, args, normalized);
  if (type === "vibex-webapp") return normalizeVibexData(args, normalized);
  if (type === "runninghub" || type === "seedance2-runninghub" || type === "sora2-runninghub") {
    return normalizeRunningHubData(args, normalized);
  }
  if (type === "upscale") return normalizeUpscaleData(args, normalized);
  if (type === "resize") return normalizeResizeData(args, normalized);
  if (type === "frame-extractor") return normalizeFrameExtractorData(args, content, normalized);
  if (type === "smart-split") return normalizeSmartSplitData(args, normalized);
  if (type === "panorama-gen") return normalizePanoramaGenData(args, normalized);

  return normalized;
}

function normalizeSunoData(
  args: string[],
  content: string,
  _nodeTitle: string | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const lyrics = firstString(
    getFlagValue(args, "--lyrics"),
    getFlagValue(args, "--lyric"),
    getFlagValue(args, "--prompt"),
    data.sunoLyrics,
    data.lyrics,
    data.prompt,
  );
  const songTitle = firstString(
    getFlagValue(args, "--song-title"),
    getFlagValue(args, "--music-title"),
    getFlagValue(args, "--title"),
    data.sunoTitle,
    data.title,
  );
  const tags = firstString(
    getFlagValue(args, "--style"),
    getFlagValue(args, "--tags"),
    data.sunoTags,
    data.sunoStyle,
    data.tags,
  );
  const negativeTags = firstString(
    getFlagValue(args, "--negative-tags"),
    getFlagValue(args, "--negative"),
    data.sunoNegativeTags,
    data.negative_tags,
  );
  const description = firstString(
    getFlagValue(args, "--description"),
    data.sunoDescription,
    data.gpt_description_prompt,
    content,
  );
  const version = firstString(getFlagValue(args, "--version"), data.sunoVersion, data.mv, "chirp-fenix");
  const model = firstString(getFlagValue(args, "--model"), data.sunoModel, data.model, "suno");
  const instrumental = hasFlag(args, "--instrumental")
    ? true
    : data.sunoInstrumental ?? data.make_instrumental ?? false;
  const explicitMode = firstString(getFlagValue(args, "--mode"), data.sunoMode, data.mode);
  const mode = explicitMode === "description" || explicitMode === "custom"
    ? explicitMode
    : lyrics || songTitle || tags
      ? "custom"
      : "description";

  return {
    ...data,
    model,
    sunoModel: model,
    sunoVersion: version,
    sunoMode: mode,
    sunoInstrumental: Boolean(instrumental),
    ...(description ? { sunoDescription: description, gpt_description_prompt: description } : {}),
    ...(songTitle ? { sunoTitle: songTitle, title: songTitle } : {}),
    ...(tags ? { sunoTags: tags, sunoStyle: tags, tags } : {}),
    ...(negativeTags ? { sunoNegativeTags: negativeTags, negative_tags: negativeTags } : {}),
    ...(lyrics ? { sunoLyrics: lyrics, lyrics, prompt: lyrics } : {}),
  };
}

function normalizeImageData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const aspectRatio = firstString(getFlagValue(args, "--aspect-ratio"), getFlagValue(args, "--ratio"), data.aspectRatio, data.aspect_ratio);
  const resolution = firstString(getFlagValue(args, "--resolution"), getFlagValue(args, "--size"), data.resolution);
  const negativePrompt = firstString(getFlagValue(args, "--negative-prompt"), getFlagValue(args, "--negative"), data.negative_prompt);
  const pendingRefImage = firstString(getFlagValue(args, "--reference-image"), getFlagValue(args, "--ref-image"), data.pendingRefImage);

  return {
    ...data,
    ...(aspectRatio ? { aspectRatio, aspect_ratio: aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    ...(pendingRefImage ? { pendingRefImage } : {}),
    ...booleanFlag(args, "--pre-llm", "preLlmEnabled"),
  };
}

function normalizeVideoData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const duration = firstString(getFlagValue(args, "--duration"), getFlagValue(args, "--seconds"), data.duration);
  const videoService = firstString(getFlagValue(args, "--service"), getFlagValue(args, "--video-service"), data.videoService);
  const videoModel = firstString(getFlagValue(args, "--video-model"), data.videoModel);
  const videoSize = firstString(getFlagValue(args, "--video-size"), getFlagValue(args, "--size"), data.videoSize);
  const veoMode = firstString(getFlagValue(args, "--veo-mode"), data.veoMode);
  const veoModel = firstString(getFlagValue(args, "--veo-model"), data.veoModel);
  const veoAspectRatio = firstString(getFlagValue(args, "--veo-aspect-ratio"), getFlagValue(args, "--aspect-ratio"), getFlagValue(args, "--ratio"), data.veoAspectRatio);

  return {
    ...data,
    ...(duration ? { duration, videoSeconds: duration } : {}),
    ...(videoService === "sora" || videoService === "veo" ? { videoService } : {}),
    ...(videoModel ? { videoModel } : {}),
    ...(videoSize ? { videoSize } : {}),
    ...(veoMode ? { veoMode } : {}),
    ...(veoModel ? { veoModel } : {}),
    ...(veoAspectRatio ? { veoAspectRatio } : {}),
    ...booleanFlag(args, "--veo-enhance-prompt", "veoEnhancePrompt"),
    ...booleanFlag(args, "--veo-enable-upsample", "veoEnableUpsample"),
    ...booleanFlag(args, "--pre-llm", "preLlmEnabled"),
  };
}

function normalizeLlmData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const mode = firstString(getFlagValue(args, "--mode"), data.mode);
  const systemPrompt = firstString(getFlagValue(args, "--system-prompt"), getFlagValue(args, "--system"), data.systemPrompt, data.systemInstruction);
  const llmModel = firstString(getFlagValue(args, "--llm-model"), getFlagValue(args, "--model"), data.llmModel);

  return {
    ...data,
    ...(mode ? { mode } : {}),
    ...(systemPrompt ? { systemPrompt, systemInstruction: systemPrompt } : {}),
    ...(llmModel ? { llmModel } : {}),
    ...booleanFlag(args, "--hide-output", "hideOutput"),
  };
}

function normalizeSeedanceVideoData(type: string, args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const ratio = firstString(getFlagValue(args, "--ratio"), getFlagValue(args, "--aspect-ratio"), data.ratio, data.aspectRatio);
  const resolution = firstString(getFlagValue(args, "--resolution"), getFlagValue(args, "--size"), data.resolution);
  const duration = firstString(getFlagValue(args, "--duration"), getFlagValue(args, "--seconds"), data.duration);
  const apiKey = firstString(getFlagValue(args, "--api-key"), getFlagValue(args, "--apikey"), data.apiKey);
  const conversionSlots = parseCsv(firstString(getFlagValue(args, "--conversion-slots"), data.conversionSlots));
  const seed = parseOptionalNumber(getFlagValue(args, "--seed"), "--seed");

  return {
    ...data,
    ...(ratio ? { ratio, aspectRatio: ratio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(duration ? { duration } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(conversionSlots ? { conversionSlots } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...booleanPairFlag(args, "--generate-audio", "--no-audio", type === "seedance-volc" ? "generate_audio" : "generateAudio"),
    ...booleanPairFlag(args, "--watermark", "--no-watermark", "watermark"),
    ...booleanPairFlag(args, "--real-person-mode", "--no-real-person-mode", "realPersonMode"),
    ...booleanFlag(args, "--return-last-frame", "returnLastFrame"),
  };
}

function normalizeVibexData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const appUrl = firstString(getFlagValue(args, "--app-url"), getFlagValue(args, "--webapp-url"));
  const authState = firstString(getFlagValue(args, "--auth-state"), data.webApp && (data.webApp as Record<string, unknown>).authState);
  const webApp = {
    ...((data.webApp && typeof data.webApp === "object" && !Array.isArray(data.webApp)) ? data.webApp as Record<string, unknown> : {}),
    ...(appUrl ? { appUrl } : {}),
    ...(authState ? { authState } : {}),
  };
  return Object.keys(webApp).length ? { ...data, webApp } : data;
}

function normalizeRunningHubData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const current = (data.runninghub && typeof data.runninghub === "object" && !Array.isArray(data.runninghub))
    ? data.runninghub as Record<string, unknown>
    : {};
  const webappId = firstString(getFlagValue(args, "--webapp-id"), getFlagValue(args, "--app-id"), current.webappId, data.webappId);
  const apiKey = firstString(getFlagValue(args, "--api-key"), getFlagValue(args, "--apikey"), current.apiKey);
  const environment = firstString(getFlagValue(args, "--environment"), getFlagValue(args, "--env"), current.environment);
  const values = parseSettings(getFlagValue(args, "--values-json"));
  const runninghub = {
    ...current,
    ...(webappId ? { webappId } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(environment ? { environment } : {}),
    ...(values ? { values: { ...((current.values && typeof current.values === "object") ? current.values as Record<string, unknown> : {}), ...values } } : {}),
  };
  return {
    ...data,
    ...(webappId ? { webappId } : {}),
    runninghub,
  };
}

function normalizeUpscaleData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const resolution = firstString(getFlagValue(args, "--upscale-resolution"), getFlagValue(args, "--resolution"), data.resolution, data.upscaleResolution);
  const aspectRatio = firstString(getFlagValue(args, "--aspect-ratio"), getFlagValue(args, "--ratio"), data.aspect_ratio, data.aspectRatio);
  return {
    ...data,
    ...(resolution ? { resolution, upscaleResolution: resolution } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio, aspectRatio } : {}),
  };
}

function normalizeResizeData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const resizeMode = firstString(getFlagValue(args, "--resize-mode"), getFlagValue(args, "--mode"), data.resizeMode);
  const resizeWidth = parseOptionalNumber(getFlagValue(args, "--resize-width") ?? getFlagValue(args, "--target-width"), "--resize-width");
  const resizeHeight = parseOptionalNumber(getFlagValue(args, "--resize-height") ?? getFlagValue(args, "--target-height"), "--resize-height");
  const sourceImageUrl = firstString(getFlagValue(args, "--source-image-url"), getFlagValue(args, "--image-url"), data.sourceImageUrl);
  return {
    ...data,
    ...(resizeMode ? { resizeMode } : {}),
    ...(resizeWidth !== undefined ? { resizeWidth } : {}),
    ...(resizeHeight !== undefined ? { resizeHeight } : {}),
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
  };
}

function normalizeFrameExtractorData(args: string[], content: string, data: Record<string, unknown>): Record<string, unknown> {
  const sourceVideoUrl = firstString(getFlagValue(args, "--source-video-url"), getFlagValue(args, "--video-url"), data.sourceVideoUrl, content);
  const currentFrameTime = parseOptionalNumber(getFlagValue(args, "--current-frame-time") ?? getFlagValue(args, "--time"), "--current-frame-time");
  const videoDuration = parseOptionalNumber(getFlagValue(args, "--video-duration"), "--video-duration");
  return {
    ...data,
    ...(sourceVideoUrl ? { sourceVideoUrl } : {}),
    ...(currentFrameTime !== undefined ? { currentFrameTime } : {}),
    ...(videoDuration !== undefined ? { videoDuration } : {}),
  };
}

function normalizeSmartSplitData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const splitRows = parseOptionalNumber(getFlagValue(args, "--split-rows") ?? getFlagValue(args, "--rows"), "--split-rows");
  const splitCols = parseOptionalNumber(getFlagValue(args, "--split-cols") ?? getFlagValue(args, "--cols") ?? getFlagValue(args, "--columns"), "--split-cols");
  const sourceImageUrl = firstString(getFlagValue(args, "--source-image-url"), getFlagValue(args, "--image-url"), data.sourceImageUrl);
  return {
    ...data,
    ...(splitRows !== undefined ? { splitRows } : {}),
    ...(splitCols !== undefined ? { splitCols } : {}),
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
    ...booleanPairFlag(args, "--upscale2k", "--no-upscale2k", "upscale2k"),
  };
}

function normalizePanoramaGenData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const supplementPrompt = firstString(getFlagValue(args, "--supplement-prompt"), getFlagValue(args, "--panorama-prompt"), data.panoramaSupplementPrompt);
  const quality = firstString(getFlagValue(args, "--quality"), getFlagValue(args, "--panorama-quality"), data.panoramaQuality);
  return {
    ...data,
    ...(supplementPrompt ? { panoramaSupplementPrompt: supplementPrompt } : {}),
    ...(quality === "2k" || quality === "4k" ? { panoramaQuality: quality } : {}),
    ...booleanFlag(args, "--pre-llm", "preLlmEnabled"),
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function parseCsv(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value !== "string") return undefined;
  const items = value.split(",").map(item => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function booleanFlag(args: string[], flag: string, field: string): Record<string, boolean> {
  if (!hasFlag(args, flag)) return {};
  return { [field]: true };
}

function booleanPairFlag(args: string[], trueFlag: string, falseFlag: string, field: string): Record<string, boolean> {
  if (hasFlag(args, trueFlag)) return { [field]: true };
  if (hasFlag(args, falseFlag)) return { [field]: false };
  return {};
}

function materialDataForNode(type: string, url: string): Record<string, unknown> {
  if (type === "image-item") return { url, kind: "image" };
  if (type === "video-item") return { url, kind: "video" };
  if (type === "audio") return { url, kind: "audio" };
  if (type === "file") return { url, kind: "file" };
  return {};
}

function modelDataForNode(type: string, model: string): Record<string, unknown> {
  if (type === "agent" || type === "llm" || type === "seedance") return { llmModel: model };
  if (type === "suno") return { sunoModel: model };
  return { model };
}

function modelTaskForNode(type: string): string | undefined {
  if (type === "image" || type === "panorama-gen" || type === "upscale") return "image";
  if (type === "video" || type === "seedance-volc" || type === "seedance2-rh-standard") return "video";
  if (type === "suno") return "audio";
  if (type === "agent" || type === "llm" || type === "seedance") return "llm";
  return undefined;
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

interface CanvasResultsResponse {
  success: boolean;
  data?: CanvasResultsPayload;
  error?: string;
}

interface CanvasResultsPayload {
  canvas_id: string;
  project_id: string;
  canvas_name: string;
  count: number;
  results: CanvasResultItem[];
}

interface CanvasResultItem {
  id: string;
  canvas_id: string;
  node_id?: string | null;
  node_title?: string | null;
  type: string;
  status: string;
  filename: string;
  mime_type: string;
  created_at?: string | null;
  completed_at?: string | null;
  download_url: string;
}

interface DownloadedResult {
  id: string;
  canvas_id: string;
  node_id: string | null;
  type: string;
  filename: string;
  path: string;
  bytes: number;
  downloaded_at: string;
}

interface ResultsManifest {
  schema: "miraivfx-cli-results-v1";
  results: DownloadedResult[];
}

interface CanvasResultsDownloadPayload {
  ok: true;
  canvas_id: string;
  output_dir: string;
  downloaded: DownloadedResult[];
  skipped: number;
  result_count: number;
}

interface CanvasData {
  id: string;
  project_id: string;
  name: string;
  nodes: unknown[];
  connections: unknown[];
  groups?: unknown[];
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
  type: string;
  content: string;
  title?: string;
  data: Record<string, unknown>;
  status: string;
}

interface CanvasGroupRecord {
  id: string;
  title: string;
  nodeIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

interface CreateCanvasGroupOptions {
  id?: string;
  title?: string;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  collapsed?: boolean;
}

interface CanvasGroupMutationResult {
  ok: true;
  dry_run: boolean;
  canvas_id: string;
  project_id?: string;
  group_id: string;
  members: string[];
  group: CanvasGroupRecord | Record<string, unknown>;
  revision?: number;
  clientModifiedAt?: number;
  ops: Array<Record<string, unknown>>;
}

interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
    groups?: Array<Record<string, unknown>>;
    group_id?: string | null;
    members?: string[];
    updated_nodes?: Array<Record<string, unknown>>;
    deleted_node_ids?: string[];
    deleted_connection_ids?: string[];
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

interface UploadCacheEntry {
  filename?: string;
  original_filename?: string;
  url: string;
  path?: string;
  size?: number;
  project_id?: string | null;
  converted_to_jpg?: boolean;
}

async function readUploadCache(hash: string, projectId: string | undefined): Promise<UploadCacheEntry | undefined> {
  try {
    const raw = await readFile(uploadCachePath(), "utf8");
    const cache = JSON.parse(raw) as Record<string, UploadCacheEntry>;
    const entry = cache[uploadCacheKey(hash, projectId)];
    return entry?.url ? entry : undefined;
  } catch {
    return undefined;
  }
}

async function writeUploadCache(hash: string, projectId: string | undefined, entry: UploadCacheEntry): Promise<void> {
  const target = uploadCachePath();
  let cache: Record<string, UploadCacheEntry> = {};
  try {
    cache = JSON.parse(await readFile(target, "utf8")) as Record<string, UploadCacheEntry>;
  } catch {
    cache = {};
  }
  cache[uploadCacheKey(hash, projectId)] = entry;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function uploadCacheKey(hash: string, projectId: string | undefined): string {
  return `${projectId || "global"}:${hash}`;
}

function uploadCachePath(): string {
  const base = process.env.MIRAIVFX_CONFIG_DIR || join(homedir(), ".miraivfx", "mir-cli");
  return join(base, "upload-cache.json");
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
