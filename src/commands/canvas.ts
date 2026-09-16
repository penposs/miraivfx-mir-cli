import { NODE_TITLES, NODE_ACTION_ALIASES, assertCurrentNodeType, assertCurrentNodeAction, nodeCatalog, currentCanvasCapabilities } from "../canvas/node-catalog.js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getFlagValue, hasFlag } from "../core/args.js";
import { ApiClient, ApiHttpError } from "../api/client.js";
import { loadRuntimeConfig } from "../core/config.js";
import { openUrl } from "../core/open.js";
import { json, text } from "../core/output.js";
import { handleVCameraCommand, vCameraUsage } from "./v-camera.js";
import { getVCameraCapabilities } from "../v-camera/contract.js";
import { handleLocalSceneCommand, LOCAL_SCENE_COMMANDS } from "./v-camera-scene.js";

export async function handleCanvasCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = hasFlag(args, "--json");
  if (subcommand === "node" && args[0] === "types") {
    json(nodeCatalog());
    return;
  }
  if (subcommand === "node") assertCurrentNodeAction(args[0] ?? "");
  if (subcommand === "v-camera" && args[0] === "capabilities") {
    json(getVCameraCapabilities());
    return;
  }
  if (subcommand === "v-camera" && args[0] === "scene" && (LOCAL_SCENE_COMMANDS as readonly string[]).includes(args[1])) {
    await handleLocalSceneCommand(args[1], args.slice(2));
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
    if (response.success === false) throw new Error("Could not read canvas capabilities");
    json(currentCanvasCapabilities((response.data ?? response) as Record<string, unknown>));
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
          : typeof result.message === "string"
            ? result.message
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
          : typeof result.message === "string"
            ? result.message
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
          : typeof result.message === "string"
            ? result.message
            : `Added ${result.node_type} node ${result.node_id} to ${result.canvas_id}`);
      return;
    }
    if (action && !["help", "--help", "-h"].includes(action)) throw new Error(`Unknown canvas node command: ${action}. Use canvas node types --json.`);
    text(`Usage: mir-cli canvas node <types|add|update|clone|delete|connect|disconnect|add-image|add-reference-image|${Object.keys(NODE_ACTION_ALIASES).join("|")}>`);
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
          : result.message ?? `Added group ${result.group_id} with ${result.members.length} member(s)`);
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

const MATERIAL_NODE_TYPES = new Set(["image-item", "video-item", "audio", "file", "text"]);

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
  assertCanvasIdsWereAbsent(canvas, { groupId: group.id });
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
  let update: CanvasOpsResponse;
  try {
    update = await api.postJson<CanvasOpsResponse>(`/canvas/${encodeURIComponent(canvasId)}/ops`, {
      baseRevision,
      conflictPolicy: "strict",
      clientModifiedAt: now,
      ops,
    });
  } catch (error) {
    const confirmed = await confirmAtomicCanvasWriteAfterServerError(api, canvasId, error, {
      groupId: group.id,
      memberIds: group.nodeIds,
    });
    return {
      ok: true,
      dry_run: false,
      canvas_id: canvasId,
      project_id: confirmed.canvas.project_id,
      group_id: group.id,
      members: group.nodeIds,
      group: confirmed.group ?? group,
      revision: confirmed.canvas.revision,
      clientModifiedAt: confirmed.canvas.clientModifiedAt,
      ops,
      response_status: "committed_with_response_error",
      response_error_status: confirmed.status,
      message: confirmed.message,
    };
  }
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
  assertCurrentNodeType(nodeType);
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
  if (nodeType === "depth-map") {
    nodeData.depthSettings = { ...DEPTH_DEFAULTS, ...(nodeData.depthSettings as Record<string, unknown> | undefined) };
  }
  const settings = parseSettings(getFlagValue(args, "--settings-json"));
  const connectTo = getFlagValue(args, "--connect-to");

  if (
    nodeType === "v-camera"
    && (Object.keys(dataJson).length > 0 || settings || model || content || rawTitle)
  ) {
    throw new Error("Create the Virtual Shoot node first, then use 'mir-cli canvas v-camera' commands to configure it");
  }

  if (nodeType === "seedance2") {
    await validateUnifiedVideoData(api, { ...nodeData, ...(model ? { model } : {}) });
  } else if (model) {
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
  if (group && canvas) {
    assertCanvasIdsWereAbsent(canvas, { nodeId: node.id, groupId: group.id });
  }
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

  let update: CanvasOpsResponse;
  try {
    update = await api.postJson<CanvasOpsResponse>(`/canvas/${encodeURIComponent(canvasId)}/ops`, {
      ...(baseRevision !== undefined ? { baseRevision } : {}),
      conflictPolicy: group ? "strict" : "merge",
      clientModifiedAt: now,
      ops,
    });
  } catch (error) {
    if (!group) throw error;
    const confirmed = await confirmAtomicCanvasWriteAfterServerError(api, canvasId, error, {
      nodeId: node.id,
      groupId: group.id,
      memberIds: group.nodeIds,
    });
    const projectId = requireValue(confirmed.canvas.project_id, "verified canvas project_id");
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
      group_id: group.id,
      members: group.nodeIds,
      revision: confirmed.canvas.revision,
      clientModifiedAt: confirmed.canvas.clientModifiedAt,
      generation_started: false,
      response_status: "committed_with_response_error",
      response_error_status: confirmed.status,
      message: confirmed.message,
    };
  }

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

export async function updateCanvasNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
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
  assertCurrentNodeType(nodeType);
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

  if (model && nodeType !== "seedance2") {
    const modelTask = modelTaskForNode(nodeType);
    if (modelTask) await assertModelAvailable(api, modelTask, model);
  }
  const normalizedDataPatch = normalizeNodeDataForType(nodeType, args, content ?? "", rawTitle ?? title, dataJson ?? {}, true);
  if (nodeType === "seedance2" && (model || Object.keys(normalizedDataPatch).length)) {
    await validateUnifiedVideoData(api, normalizedDataPatch, model ?? firstString(normalizedDataPatch.model, (node.data as Record<string, unknown> | undefined)?.model));
  }
  if (nodeType === "depth-map" && normalizedDataPatch.depthSettings) {
    normalizedDataPatch.depthSettings = {
      ...(((node.data as Record<string, unknown> | undefined)?.depthSettings as Record<string, unknown> | undefined) ?? {}),
      ...(normalizedDataPatch.depthSettings as Record<string, unknown>),
    };
  }
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

export async function cloneCanvasNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Cloning a canvas node requires explicit --yes");
  }
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const sourceNodeId = requireValue(getFlagValue(args, "--node-id") ?? getFlagValue(args, "--source-node"), "--node-id");
  const canvas = await getCanvasData(api, canvasId);
  const source = findCanvasNode(canvas, sourceNodeId) as unknown as CanvasNodeRecord;
  assertCurrentNodeType(String(source.type));
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

async function confirmAtomicCanvasWriteAfterServerError(
  api: ApiClient,
  canvasId: string,
  error: unknown,
  expected: { nodeId?: string; groupId: string; memberIds: string[] },
): Promise<{
  canvas: CanvasData;
  group?: Record<string, unknown>;
  status: number;
  message: string;
}> {
  if (!(error instanceof ApiHttpError) || error.status < 500 || error.status > 599) {
    throw error;
  }

  let canvas: CanvasData;
  try {
    canvas = await getCanvasData(api, canvasId);
  } catch {
    throw error;
  }

  const nodeExists = !expected.nodeId || canvas.nodes.some(
    (node) => node && typeof node === "object" && String((node as Record<string, unknown>).id || "") === expected.nodeId,
  );
  const group = (canvas.groups ?? []).find(
    (item) => item && typeof item === "object" && String((item as Record<string, unknown>).id || "") === expected.groupId,
  );
  const persistedMemberIds = group && typeof group === "object" && Array.isArray((group as Record<string, unknown>).nodeIds)
    ? ((group as Record<string, unknown>).nodeIds as unknown[]).map((value) => String(value))
    : [];
  const expectedMemberIds = [...expected.memberIds].sort();
  const membersMatch = persistedMemberIds.length === expectedMemberIds.length
    && [...persistedMemberIds].sort().every((value, index) => value === expectedMemberIds[index]);
  if (!nodeExists || !group || typeof group !== "object" || !membersMatch) {
    throw error;
  }

  return {
    canvas,
    group: group as Record<string, unknown>,
    status: error.status,
    message: `Commit succeeded, but the server response was abnormal (HTTP ${error.status}); canvas state was verified by ID.`,
  };
}

function assertCanvasIdsWereAbsent(
  canvas: CanvasData,
  expected: { nodeId?: string; groupId?: string },
): void {
  const nodeExists = expected.nodeId && canvas.nodes.some(
    (node) => node && typeof node === "object" && String((node as Record<string, unknown>).id || "") === expected.nodeId,
  );
  const groupExists = expected.groupId && (canvas.groups ?? []).some(
    (group) => group && typeof group === "object" && String((group as Record<string, unknown>).id || "") === expected.groupId,
  );
  if (nodeExists) throw new Error(`Generated node ID already exists before write: ${expected.nodeId}`);
  if (groupExists) throw new Error(`Generated group ID already exists before write: ${expected.groupId}`);
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

async function assertModelAvailable(api: ApiClient, task: string, modelId: string): Promise<Record<string, unknown>> {
  const response = await api.getJson<ModelsResponse>(`/canvas/models?task=${encodeURIComponent(task)}`);
  const models = normalizeModels(response, task);
  const match = models.find((model) => model.model_id === modelId);
  if (!match) {
    throw new Error(`Model is not available for ${task}: ${modelId}`);
  }
  if (match.enabled === false || match.maintenance === true) {
    throw new Error(`Model is not currently usable: ${modelId}`);
  }
  return match;
}

async function validateUnifiedVideoData(api: ApiClient, data: Record<string, unknown>, selectedModel?: string): Promise<void> {
  const modelId = selectedModel ?? firstString(data.model);
  // With no explicit model, the web node resolves its current catalog defaults.
  if (!modelId) return;
  const model = await assertModelAvailable(api, "video", modelId);
  const schema = model.parameter_schema as Record<string, any>;
  const hints = model.ui_hints as Record<string, unknown>;
  const discount = modelId.startsWith("seedance2-");
  const subsidy = modelId.startsWith("megaby-video-") || modelId.startsWith("megaby-custom-") || hints?.megaby_video || schema?.x_megaby_video;
  const h3 = modelId.startsWith("runninghub-h3-");
  if (!discount && !subsidy && !h3) throw new Error(`Model ${modelId} is not supported by the unified video node`);
  const unsupported = discount ? ["megabyReferenceVideoMeta"] : [
    "generate_audio", "use_first_last_frames", "return_last_frame", "seed", "seedanceReferenceVideoMeta",
    ...(h3 ? ["megabyReferenceVideoMeta"] : []),
  ];
  for (const key of unsupported) {
    if (data[key] !== undefined && data[key] !== null) throw new Error(`Parameter ${key} is not supported by ${modelId}`);
  }
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") return;
  for (const key of ["size", "resolution", "duration", "generate_audio", "seed"]) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    const property = key === "size" ? properties.size ?? properties.ratio : properties[key];
    if (!property) throw new Error(`Parameter ${key} is not supported by ${modelId}`);
    if (Array.isArray(property.enum) && !property.enum.some((item: unknown) => String(item) === String(value))) {
      throw new Error(`Invalid ${key} for ${modelId}: expected ${property.enum.join(", ")}`);
    }
    if ((typeof property.minimum === "number" && Number(value) < property.minimum)
      || (typeof property.maximum === "number" && Number(value) > property.maximum)) {
      throw new Error(`Invalid ${key} for ${modelId}: outside the model parameter range`);
    }
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
    .filter((model) => task === "all" || model.task === task || model.model_type === task || model.type === task || model.capabilities?.includes?.(task))
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
      ui_hints: model.uiHints ?? model.ui_hints ?? {},
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
  if (type === "seedance2") return { width: 420, height: 580 };
  if (type === "depth-map") return { width: 380, height: 520 };
  if (type === "relay") return { width: 50, height: 50 };
  if (type === "text" || type === "agent" || type === "seedance") {
    return { width: 320, height: type === "agent" || type === "seedance" ? 420 : 280 };
  }
  if (type === "pro-camera" || type === "image") return { width: 600, height: 360 };
  if (type === "suno") return { width: 440, height: 560 };
  if (type === "panorama-split") return { width: 360, height: 420 };
  if (type === "panorama-gen") return { width: 360, height: 320 };
  if (type === "v-camera") return { width: 860, height: 640 };
  if (type === "video-item") return { width: 320, height: 240 };
  if (type === "audio") return { width: 300, height: 100 };
  return { width: 280, height: 280 };
}

function defaultTitleForNode(type: string): string | undefined {
  return NODE_TITLES[type];
}

function defaultStatusForNode(type: string, content: string): "idle" | "completed" {
  if (MATERIAL_NODE_TYPES.has(type) && content) return "completed";
  return "idle";
}

function defaultDataForNode(type: string): Record<string, unknown> {
  // Model-specific defaults are resolved by the current web model catalog.
  if (type === "seedance2") return {};
  if (type === "suno") {
    return { sunoModel: "suno", sunoVersion: "chirp-fenix", sunoMode: "description", sunoInstrumental: false };
  }
  if (type === "panorama-gen") {
    return { panoramaSupplementPrompt: "", panoramaQuality: "2k" };
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
  partial = false,
): Record<string, unknown> {
  const normalized = { ...data };
  if (["image", "seedance2", "panorama-gen"].includes(type)) {
    Object.assign(normalized, booleanPairFlag(args, "--pre-llm", "--no-pre-llm", "preLlmEnabled"));
    for (const [flag, field] of [
      ["--pre-llm-model", "preLlmModel"],
      ["--pre-llm-template-id", "preLlmTemplateId"],
      ["--pre-llm-template-name", "preLlmTemplateName"],
      ["--pre-llm-template-content", "preLlmTemplateContent"],
    ]) {
      const value = getFlagValue(args, flag);
      if (value !== undefined) normalized[field] = value;
    }
  }

  if (type === "seedance2") return normalizeUnifiedVideoData(args, normalized);
  if (type === "depth-map") return normalizeDepthData(args, normalized);
  if (type === "suno") return normalizeSunoData(args, content, nodeTitle, normalized, partial);
  if (type === "image") return normalizeImageData(args, normalized);
  if (type === "agent" || type === "seedance") return normalizeLlmData(args, normalized);
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
  partial = false,
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
  const rawVersion = firstString(getFlagValue(args, "--version"), data.sunoVersion, data.mv, partial ? undefined : "chirp-fenix");
  const versions: Record<string, string> = { "v4.5+": "chirp-bluejay", "v5": "chirp-crow", "v5.5": "chirp-fenix" };
  const version = rawVersion ? versions[rawVersion.toLowerCase()] ?? rawVersion : undefined;
  if (version && !Object.values(versions).includes(version)) throw new Error("Invalid Suno version: use V4.5+, V5, V5.5 or its chirp ID");
  const model = firstString(getFlagValue(args, "--model"), data.sunoModel, data.model, partial ? undefined : "suno");
  const instrumental = hasFlag(args, "--instrumental")
    ? true
    : hasFlag(args, "--no-instrumental") ? false : data.sunoInstrumental ?? data.make_instrumental ?? (partial ? undefined : false);
  const explicitMode = firstString(getFlagValue(args, "--mode"), data.sunoMode, data.mode);
  if (explicitMode && !["description", "custom"].includes(explicitMode)) throw new Error("Invalid Suno mode: use description or custom");
  const mode = explicitMode === "description" || explicitMode === "custom"
    ? explicitMode
    : lyrics || songTitle || tags
      ? "custom"
      : description || !partial ? "description" : undefined;

  return {
    ...data,
    ...(model ? { model, sunoModel: model } : {}),
    ...(version ? { sunoVersion: version } : {}),
    ...(mode ? { sunoMode: mode } : {}),
    ...(instrumental !== undefined ? { sunoInstrumental: Boolean(instrumental) } : {}),
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

function normalizeLlmData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  for (const [flag, field] of [
    ["--system-template-id", "agentSystemTemplateId"],
    ["--system-template-name", "agentSystemTemplateName"],
    ["--system-template-content", "agentSystemTemplateContent"],
  ]) {
    const value = getFlagValue(args, flag);
    if (value !== undefined) data[field] = value;
  }
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

function normalizeUnifiedVideoData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  for (const flag of ["--api-key", "--apikey", "--real-person-mode", "--no-real-person-mode", "--conversion-slots", "--watermark", "--no-watermark", "--video-service", "--video-model", "--video-size", "--veo-mode", "--veo-model", "--veo-aspect-ratio"]) {
    if (hasFlag(args, flag)) throw new Error(`Legacy video option ${flag} is not supported; use canvas models --task video for current parameters`);
  }
  const size = firstString(getFlagValue(args, "--ratio"), getFlagValue(args, "--aspect-ratio"), getFlagValue(args, "--size"), data.size, data.ratio, data.aspectRatio);
  const resolution = firstString(getFlagValue(args, "--resolution"), data.resolution);
  const rawDuration = firstString(getFlagValue(args, "--duration"), getFlagValue(args, "--seconds"), data.duration === undefined ? undefined : String(data.duration));
  const duration = parseOptionalNumber(rawDuration, "--duration");
  if (duration !== undefined && (duration <= 0 || !Number.isInteger(duration))) {
    throw new Error("--duration must be a positive integer; use canvas models --task video for model limits");
  }
  const seed = parseOptionalNumber(getFlagValue(args, "--seed"), "--seed");
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error("--seed must be an integer");
  return {
    ...data,
    ...(size ? { size } : {}),
    ...(resolution ? { resolution } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...booleanPairFlag(args, "--generate-audio", "--no-audio", "generate_audio"),
    ...booleanPairFlag(args, "--first-last-frames", "--no-first-last-frames", "use_first_last_frames"),
    ...booleanPairFlag(args, "--return-last-frame", "--no-return-last-frame", "return_last_frame"),
  };
}

const DEPTH_DEFAULTS = {
  model: "small", fps: 30, maxSide: 512, startSeconds: 0,
  durationSeconds: 30, style: "gray", invert: false, temporal: 0.35,
};

function normalizeDepthData(args: string[], data: Record<string, unknown>): Record<string, unknown> {
  const current = data.depthSettings;
  if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) {
    throw new Error("depthSettings must be an object");
  }
  const settings = { ...(current as Record<string, unknown> | undefined) };
  for (const [flag, field, allowed] of [
    ["--depth-model", "model", ["small", "base"]],
    ["--depth-style", "style", ["gray", "inferno", "viridis"]],
    ["--depth-fps", "fps", ["source", "8", "12", "15", "24", "30"]],
    ["--depth-max-side", "maxSide", ["512", "768", "1024", "2048"]],
  ] as const) {
    const supplied = getFlagValue(args, flag) ?? settings[field];
    const value = supplied === undefined ? undefined : String(supplied);
    if (value === undefined) continue;
    if (!(allowed as readonly string[]).includes(value)) throw new Error(`Invalid ${flag}: expected ${allowed.join(", ")}`);
    settings[field] = field === "maxSide" || (field === "fps" && value !== "source") ? Number(value) : value;
  }
  for (const [flag, field, min, max] of [
    ["--depth-start", "startSeconds", 0, 180],
    ["--depth-duration", "durationSeconds", 0.2, 30],
    ["--depth-temporal", "temporal", 0, 0.9],
  ] as const) {
    const supplied = getFlagValue(args, flag) ?? settings[field];
    const value = parseOptionalNumber(supplied === undefined ? undefined : String(supplied), flag);
    if (value === undefined) continue;
    if (value < min || value > max) throw new Error(`Invalid ${flag}: expected ${min} to ${max}`);
    settings[field] = value;
  }
  Object.assign(settings, booleanPairFlag(args, "--depth-invert", "--no-depth-invert", "invert"));
  if (settings.invert !== undefined && typeof settings.invert !== "boolean") throw new Error("Invalid depth invert: expected a boolean");
  return Object.keys(settings).length ? { ...data, depthSettings: settings } : data;
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
  if (quality && quality !== "2k" && quality !== "4k") throw new Error("Invalid panorama quality: use 2k or 4k");
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
  if (type === "agent" || type === "seedance") return { llmModel: model };
  if (type === "suno") return { sunoModel: model };
  return { model };
}

function modelTaskForNode(type: string): string | undefined {
  if (type === "image" || type === "panorama-gen" || type === "upscale") return "image";
  if (type === "seedance2") return "video";
  if (type === "suno") return "audio";
  if (type === "agent" || type === "seedance") return "llm";
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
  response_status?: "committed_with_response_error";
  response_error_status?: number;
  message?: string;
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
