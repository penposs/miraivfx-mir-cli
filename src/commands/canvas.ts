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
    if (action === "add") {
      const result = await addGenericNode(api, rest, config.appBase);
      if (result.opened && typeof result.url === "string") {
        await openUrl(result.url);
      }
      asJson ? json(result) : text(`Added ${result.node_type} node ${result.node_id} to ${result.canvas_id}`);
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
      asJson ? json(result) : text(`Added ${result.node_type} node ${result.node_id} to ${result.canvas_id}`);
      return;
    }
    text("Usage: mir-cli canvas node <add|update|clone|delete|connect|disconnect|add-image|add-reference-image|add-text|add-video|add-audio|add-agent|add-suno|add-seedance|add-runninghub|add-pro-camera|add-panorama-gen|add-blocking-3d>");
    return;
  }

  if (["plan", "deploy", "run"].includes(subcommand)) {
    const payload = manualWebOnlyPayload(`canvas ${subcommand}`);
    asJson ? json(payload) : text(payload.message);
    return;
  }

  text("Usage: mir-cli canvas <list|create|open|capabilities|models|inspect|upload|node>");
}

const CANVAS_NODE_TYPES = new Set([
  "text",
  "image-item",
  "video-item",
  "image",
  "video",
  "seedance-volc",
  "seedance2-rh-standard",
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
  "audio",
  "file",
  "resize",
]);

const MATERIAL_NODE_TYPES = new Set(["image-item", "video-item", "audio", "file", "text"]);

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
  "add-runninghub": "runninghub",
  "add-pro-camera": "pro-camera",
  "add-panorama-gen": "panorama-gen",
  "add-blocking-3d": "blocking-3d",
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

async function addGenericNode(api: ApiClient, args: string[], appBase: string): Promise<Record<string, unknown>> {
  if (!hasFlag(args, "--yes")) {
    throw new Error("Creating a canvas node requires explicit --yes");
  }
  const shouldOpen = hasFlag(args, "--open");
  const canvasId = requireValue(getFlagValue(args, "--canvas-id"), "--canvas-id");
  const nodeType = requireValue(getFlagValue(args, "--type"), "--type");
  if (!CANVAS_NODE_TYPES.has(nodeType)) {
    throw new Error(`Unsupported node type: ${nodeType}`);
  }
  const content = getFlagValue(args, "--content") ?? getFlagValue(args, "--prompt") ?? "";
  const title = getFlagValue(args, "--title") ?? defaultTitleForNode(nodeType);
  const x = parseOptionalNumber(getFlagValue(args, "--x"), "--x") ?? 0;
  const y = parseOptionalNumber(getFlagValue(args, "--y"), "--y") ?? 0;
  const shape = defaultShapeForNode(nodeType);
  const width = parseOptionalNumber(getFlagValue(args, "--width"), "--width") ?? shape.width;
  const height = parseOptionalNumber(getFlagValue(args, "--height"), "--height") ?? shape.height;
  const status = getFlagValue(args, "--status") ?? defaultStatusForNode(nodeType, content);
  const model = getFlagValue(args, "--model");
  const dataJson = parseSettings(getFlagValue(args, "--data-json")) ?? {};
  const settings = parseSettings(getFlagValue(args, "--settings-json"));
  const connectTo = getFlagValue(args, "--connect-to");

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
    data: {
      ...defaultDataForNode(nodeType),
      ...dataJson,
      ...(settings ? { settings } : {}),
      ...(content && !MATERIAL_NODE_TYPES.has(nodeType) ? { prompt: content } : {}),
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
    title,
    status,
    connected_to: connectTo ?? null,
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
  const title = getFlagValue(args, "--title");
  const content = getFlagValue(args, "--content") ?? getFlagValue(args, "--prompt");
  const x = parseOptionalNumber(getFlagValue(args, "--x"), "--x");
  const y = parseOptionalNumber(getFlagValue(args, "--y"), "--y");
  const width = parseOptionalNumber(getFlagValue(args, "--width"), "--width");
  const height = parseOptionalNumber(getFlagValue(args, "--height"), "--height");
  const dataJson = parseSettings(getFlagValue(args, "--data-json"));
  const settings = parseSettings(getFlagValue(args, "--settings-json"));
  const model = getFlagValue(args, "--model");

  if (title !== undefined) patch.title = title;
  if (content !== undefined) patch.content = content;
  if (x !== undefined) patch.x = x;
  if (y !== undefined) patch.y = y;
  if (width !== undefined) patch.width = width;
  if (height !== undefined) patch.height = height;

  const nodeType = String((node as any).type || "");
  if (model) {
    const modelTask = modelTaskForNode(nodeType);
    if (modelTask) await assertModelAvailable(api, modelTask, model);
  }
  const dataPatch = {
    ...(dataJson ?? {}),
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
  const x = parseOptionalNumber(getFlagValue(args, "--x"), "--x") ?? (Number(source.x || 0) + 460);
  const y = parseOptionalNumber(getFlagValue(args, "--y"), "--y") ?? Number(source.y || 0);
  const title = getFlagValue(args, "--title") ?? `${String(source.title || source.type || "Node")} v2`;
  const content = getFlagValue(args, "--content") ?? getFlagValue(args, "--prompt") ?? String(source.content || "");
  const dataJson = parseSettings(getFlagValue(args, "--data-json")) ?? {};
  const settings = parseSettings(getFlagValue(args, "--settings-json"));
  const clonedNode: CanvasNodeRecord = {
    id: randomUUID(),
    x,
    y,
    width: Number(source.width || defaultShapeForNode(String(source.type)).width),
    height: Number(source.height || defaultShapeForNode(String(source.type)).height),
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
  if (type === "runninghub" || type === "seedance2-runninghub" || type === "sora2-runninghub") return { width: 340, height: 520 };
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
    runninghub: "RunningHub",
    "seedance2-runninghub": "Seedance RunningHub",
    "sora2-runninghub": "Sora RunningHub",
    "pro-camera": "专业相机",
    "panorama-gen": "全景图生成",
    "panorama-split": "全景预览",
    "blocking-3d": "站位图",
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
  if (type === "panorama-gen") {
    return { panoramaSupplementPrompt: "", panoramaQuality: "2k" };
  }
  if (type === "blocking-3d") {
    return { blockingAspect: "16:9" };
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
  type: string;
  content: string;
  title?: string;
  data: Record<string, unknown>;
  status: string;
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
