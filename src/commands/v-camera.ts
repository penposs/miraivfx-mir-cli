import { randomUUID } from "node:crypto";
import { ApiClient } from "../api/client.js";
import { getFlagValue, hasFlag } from "../core/args.js";
import { json, text } from "../core/output.js";
import {
  Actor,
  Camera,
  cameraOffsetInActorSpace,
  CameraMotionPreset,
  CameraTrackingPoint,
  clone,
  createMotionPresetPatch,
  defaultVCameraProject,
  isMotionPreset,
  isRecord,
  normalizeProject,
  parsePathPoints,
  parseVec3,
  PathPoint,
  PROP_DEFAULTS,
  Prop,
  PropPreset,
  resolveByIdOrName,
  SafeFrameRatio,
  VCameraProject,
  Vec3,
} from "../v-camera/project.js";

interface CanvasData {
  id: string;
  project_id: string;
  name: string;
  nodes: unknown[];
  revision?: number;
  clientModifiedAt?: number;
}

interface CanvasResponse {
  success: boolean;
  data?: CanvasData;
  error?: string;
}

interface ProjectPatchResponse {
  success: boolean;
  data?: {
    canvas_id: string;
    project_id: string;
    node_id: string;
    revision: number;
    clientModifiedAt: number;
    changedFields: string[];
  };
  error?: string;
}

type ProjectPatch = Partial<Pick<
  VCameraProject,
  "name" | "fps" | "duration" | "safeFrameRatio" |
  "cubes" | "actors" | "cameras" | "cameraCuts" | "activeCameraId"
>>;

export async function handleVCameraCommand(
  api: ApiClient,
  appBase: string,
  args: string[],
  asJson: boolean,
): Promise<void> {
  const [subject = "", rawAction = "", ...tail] = args;
  if ([subject, rawAction].some((value) => value === "--help" || value === "-h" || value === "help")) {
    text(vCameraUsage());
    return;
  }
  if (subject === "inspect") {
    await inspectVCamera(api, args.slice(1), asJson);
    return;
  }
  if (!subject) {
    text(vCameraUsage());
    return;
  }

  let action = rawAction;
  let rest = tail;
  if (rawAction === "path") {
    action = `path-${tail[0] ?? ""}`;
    rest = tail.slice(1);
  }

  const canvasId = requireFlag(rest, "--canvas-id");
  const canvas = await getCanvas(api, canvasId);
  const node = findVCameraNode(canvas, getFlagValue(rest, "--node-id"));
  const project = normalizeProject(getNodeProject(node));
  const mutation = mutateProject(project, subject, action, rest);
  const dryRun = hasFlag(rest, "--dry-run");

  if (!dryRun && !hasFlag(rest, "--yes")) {
    throw new Error("Changing a V-camera project requires explicit --yes (or use --dry-run)");
  }

  if (dryRun) {
    const payload = {
      ok: true,
      dry_run: true,
      canvas_id: canvas.id,
      node_id: String(node.id),
      operation: mutation.operation,
      entity_id: mutation.entityId ?? null,
      patch: mutation.patch,
    };
    asJson ? json(payload) : text(`Dry run: ${mutation.operation} (${Object.keys(mutation.patch).join(", ")})`);
    return;
  }

  const response = await api.postJson<ProjectPatchResponse>(
    `/canvas/${encodeURIComponent(canvas.id)}/v-camera`,
    {
      nodeId: String(node.id),
      baseRevision: canvas.revision ?? 0,
      patch: mutation.patch,
    },
  );
  if (!response.success || !response.data) {
    throw new Error(response.error ?? "Failed to update V-camera project");
  }

  const url = `${appBase}/canvas?projectId=${encodeURIComponent(response.data.project_id)}&canvasId=${encodeURIComponent(canvas.id)}`;
  const payload = {
    ok: true,
    canvas_id: canvas.id,
    project_id: response.data.project_id,
    node_id: response.data.node_id,
    entity_id: mutation.entityId ?? null,
    operation: mutation.operation,
    revision: response.data.revision,
    changed_fields: response.data.changedFields,
    url,
  };
  asJson ? json(payload) : text(`Updated ${mutation.operation} on V-camera node ${response.data.node_id}`);
}

function mutateProject(
  project: VCameraProject,
  subject: string,
  action: string,
  args: string[],
): { patch: ProjectPatch; operation: string; entityId?: string } {
  if (subject === "project" && action === "set") return mutateProjectSettings(project, args);
  if (subject === "actor") return mutateActor(project, action, args);
  if (subject === "prop" || subject === "object") return mutateProp(project, action, args);
  if (subject === "camera") return mutateCamera(project, action, args);
  if (subject === "cut") return mutateCut(project, action, args);
  throw new Error(`Unsupported V-camera command: ${subject} ${action}`);
}

function mutateProjectSettings(project: VCameraProject, args: string[]) {
  const patch: ProjectPatch = {};
  const name = getFlagValue(args, "--name");
  const fps = optionalNumber(args, "--fps", 1, 120);
  const duration = optionalNumber(args, "--duration", 0.01, 3600);
  const safeFrame = getFlagValue(args, "--safe-frame");
  if (name !== undefined) patch.name = requireText(name, "--name");
  if (fps !== undefined) patch.fps = fps;
  if (duration !== undefined) patch.duration = duration;
  if (safeFrame !== undefined) {
    if (!["off", "9:16", "16:9", "1:1"].includes(safeFrame)) throw new Error("Invalid --safe-frame");
    patch.safeFrameRatio = safeFrame as SafeFrameRatio;
  }
  if (!Object.keys(patch).length) throw new Error("No project fields provided");
  return { patch, operation: "project.set" };
}

function mutateActor(project: VCameraProject, action: string, args: string[]) {
  const actors = clone(project.actors);
  if (action === "add") {
    const id = getFlagValue(args, "--id") ?? `actor_${randomUUID()}`;
    const actor: Actor = {
      id,
      name: getFlagValue(args, "--name") ?? nextNumericName(actors),
      position: parseVec3(getFlagValue(args, "--position"), "--position") ?? [0, 0, 0],
      rotation: parseVec3(getFlagValue(args, "--rotation"), "--rotation") ?? [0, 0, 0],
      height: optionalNumber(args, "--height", 0.1, 20) ?? 1.75,
      pathPoints: [],
    };
    ensureUniqueId(actors, id, "Actor");
    return { patch: { actors: [...actors, actor] }, operation: "actor.add", entityId: id };
  }

  const selector = requireFlag(args, "--actor");
  const actor = resolveByIdOrName(actors, selector, "Actor");
  const index = actors.findIndex((item) => item.id === actor.id);

  if (action === "set") {
    const name = getFlagValue(args, "--name");
    const position = parseVec3(getFlagValue(args, "--position"), "--position");
    const rotation = parseVec3(getFlagValue(args, "--rotation"), "--rotation");
    const height = optionalNumber(args, "--height", 0.1, 20);
    if (name === undefined && position === undefined && rotation === undefined && height === undefined) {
      throw new Error("No actor fields provided");
    }
    actors[index] = {
      ...actor,
      ...(name !== undefined ? { name: requireText(name, "--name") } : {}),
      ...(position ? shiftOwnerAndPath(actor, position) : {}),
      ...(rotation ? { rotation } : {}),
      ...(height !== undefined ? { height } : {}),
    };
    return { patch: { actors }, operation: "actor.set", entityId: actor.id };
  }
  if (action === "delete") {
    const cameras = project.cameras.map((camera) => camera.trackingActorId === actor.id
      ? { ...camera, movementMode: camera.movementMode === "follow" ? "static" as const : camera.movementMode, aimMode: "manual" as const, trackingActorId: null, motionPreset: null }
      : camera);
    return {
      patch: {
        actors: actors.filter((item) => item.id !== actor.id),
        cameras,
        cameraCuts: project.cameraCuts.filter((cut) => cut.anchor?.actorId !== actor.id),
      },
      operation: "actor.delete",
      entityId: actor.id,
    };
  }
  return mutatePath(project, "actor", actor, actors, index, action, args);
}

function mutateProp(project: VCameraProject, action: string, args: string[]) {
  const props = clone(project.cubes);
  if (action === "add") {
    const preset = (getFlagValue(args, "--preset") ?? "box") as PropPreset;
    if (!(preset in PROP_DEFAULTS)) throw new Error("Invalid --preset");
    const defaults = PROP_DEFAULTS[preset];
    const scale = parseVec3(getFlagValue(args, "--scale"), "--scale") ?? [...defaults.scale] as Vec3;
    const id = getFlagValue(args, "--id") ?? `cube_${randomUUID()}`;
    ensureUniqueId(props, id, "Prop");
    const prop: Prop = {
      id,
      name: getFlagValue(args, "--name") ?? `${defaults.name} ${props.length + 1}`,
      position: parseVec3(getFlagValue(args, "--position"), "--position") ?? [0, scale[1] / 2, 0],
      rotation: parseVec3(getFlagValue(args, "--rotation"), "--rotation") ?? [0, 0, 0],
      scale,
      visible: true,
      locked: false,
      propPreset: preset,
      ...(preset === "stairs" ? { stepCount: optionalInteger(args, "--steps", 2, 64) ?? 6 } : {}),
      pathPoints: [],
    };
    return { patch: { cubes: [...props, prop] }, operation: "prop.add", entityId: id };
  }

  const selector = requireFlag(args, "--prop");
  const prop = resolveByIdOrName(props, selector, "Prop");
  const index = props.findIndex((item) => item.id === prop.id);
  if (action === "set") {
    const name = getFlagValue(args, "--name");
    const position = parseVec3(getFlagValue(args, "--position"), "--position");
    const rotation = parseVec3(getFlagValue(args, "--rotation"), "--rotation");
    const scale = parseVec3(getFlagValue(args, "--scale"), "--scale");
    const visible = optionalBoolean(args, "--visible");
    const locked = optionalBoolean(args, "--locked");
    const steps = optionalInteger(args, "--steps", 2, 64);
    if ([name, position, rotation, scale, visible, locked, steps].every((value) => value === undefined)) {
      throw new Error("No prop fields provided");
    }
    props[index] = {
      ...prop,
      ...(name !== undefined ? { name: requireText(name, "--name") } : {}),
      ...(position ? shiftOwnerAndPath(prop, position) : {}),
      ...(rotation ? { rotation } : {}),
      ...(scale ? { scale } : {}),
      ...(visible !== undefined ? { visible } : {}),
      ...(locked !== undefined ? { locked } : {}),
      ...(steps !== undefined ? { stepCount: steps } : {}),
    };
    return { patch: { cubes: props }, operation: "prop.set", entityId: prop.id };
  }
  if (action === "delete") {
    return { patch: { cubes: props.filter((item) => item.id !== prop.id) }, operation: "prop.delete", entityId: prop.id };
  }
  return mutatePath(project, "prop", prop, props, index, action, args);
}

function mutateCamera(project: VCameraProject, action: string, args: string[]) {
  const cameras = clone(project.cameras);
  if (action === "add") {
    const id = getFlagValue(args, "--id") ?? `camera_${randomUUID()}`;
    ensureUniqueId(cameras, id, "Camera");
    const camera: Camera = {
      id,
      name: getFlagValue(args, "--name") ?? `Camera ${cameras.length + 1}`,
      position: parseVec3(getFlagValue(args, "--position"), "--position") ?? [0, 1.6, 3],
      rotation: parseVec3(getFlagValue(args, "--rotation"), "--rotation") ?? [0, 180, 0],
      fov: optionalNumber(args, "--fov", 1, 179) ?? 35,
      duration: optionalNumber(args, "--duration", 0.01, 3600) ?? 3,
      pathPoints: [],
      movementMode: "static",
      aimMode: "manual",
      trackingActorId: null,
      trackingPoint: "chest",
      followOffset: [0, 1.6, 3],
      followSpeed: 6,
      motionPreset: null,
    };
    return {
      patch: { cameras: [...cameras, camera], activeCameraId: project.activeCameraId ?? id },
      operation: "camera.add",
      entityId: id,
    };
  }

  const selector = requireFlag(args, "--camera");
  const camera = resolveByIdOrName(cameras, selector, "Camera");
  const index = cameras.findIndex((item) => item.id === camera.id);
  if (action === "set") {
    const name = getFlagValue(args, "--name");
    const position = parseVec3(getFlagValue(args, "--position"), "--position");
    const rotation = parseVec3(getFlagValue(args, "--rotation"), "--rotation");
    const fov = optionalNumber(args, "--fov", 1, 179);
    const duration = optionalNumber(args, "--duration", 0.01, 3600);
    if ([name, position, rotation, fov, duration].every((value) => value === undefined)) {
      throw new Error("No camera fields provided");
    }
    cameras[index] = {
      ...camera,
      ...(name !== undefined ? { name: requireText(name, "--name") } : {}),
      ...(position ? shiftOwnerAndPath(camera, position) : {}),
      ...(rotation ? { rotation } : {}),
      ...(fov !== undefined ? { fov } : {}),
      ...(duration !== undefined ? { duration } : {}),
    };
    return { patch: { cameras, ...(duration && duration > project.duration ? { duration } : {}) }, operation: "camera.set", entityId: camera.id };
  }
  if (action === "delete") {
    const remaining = cameras.filter((item) => item.id !== camera.id);
    return {
      patch: {
        cameras: remaining,
        cameraCuts: project.cameraCuts.filter((cut) => cut.cameraId !== camera.id),
        activeCameraId: project.activeCameraId === camera.id ? remaining[0]?.id ?? null : project.activeCameraId,
      },
      operation: "camera.delete",
      entityId: camera.id,
    };
  }
  if (action === "follow") {
    const actor = resolveByIdOrName(project.actors, requireFlag(args, "--actor"), "Actor");
    const trackingPoint = (getFlagValue(args, "--tracking-point") ?? "chest") as CameraTrackingPoint;
    if (!["head", "chest", "center"].includes(trackingPoint)) throw new Error("Invalid --tracking-point");
    const offset = parseVec3(getFlagValue(args, "--offset"), "--offset");
    cameras[index] = {
      ...camera,
      movementMode: "follow",
      aimMode: "actor",
      trackingActorId: actor.id,
      trackingPoint,
      followOffset: offset ?? cameraOffsetInActorSpace(camera, actor),
      followSpeed: optionalNumber(args, "--speed", 0.01, 100) ?? camera.followSpeed,
      motionPreset: null,
    };
    return { patch: { cameras }, operation: "camera.follow", entityId: camera.id };
  }
  if (action === "preset") {
    const presetValue = requireFlag(args, "--preset");
    if (!isMotionPreset(presetValue)) throw new Error("Invalid --preset");
    const actor = resolveByIdOrName(project.actors, requireFlag(args, "--actor"), "Actor");
    const duration = optionalNumber(args, "--duration", 0.5, 120);
    cameras[index] = { ...camera, ...createMotionPresetPatch({ preset: presetValue, camera, actor, duration }) };
    return {
      patch: {
        cameras,
        ...(cameras[index].duration > project.duration ? { duration: cameras[index].duration } : {}),
      },
      operation: `camera.preset.${presetValue}`,
      entityId: camera.id,
    };
  }
  return mutatePath(project, "camera", camera, cameras, index, action, args);
}

function mutateCut(project: VCameraProject, action: string, args: string[]) {
  if (action === "clear") return { patch: { cameraCuts: [] }, operation: "cut.clear" };
  if (action === "delete") {
    const cutId = requireFlag(args, "--cut");
    if (!project.cameraCuts.some((cut) => cut.id === cutId)) throw new Error(`Camera cut not found: ${cutId}`);
    return { patch: { cameraCuts: project.cameraCuts.filter((cut) => cut.id !== cutId) }, operation: "cut.delete", entityId: cutId };
  }
  if (action !== "add") throw new Error(`Unsupported cut action: ${action}`);
  const camera = resolveByIdOrName(project.cameras, requireFlag(args, "--camera"), "Camera");
  const requestedTime = optionalNumber(args, "--time", 0, 3600);
  const actorSelector = getFlagValue(args, "--actor");
  const pointId = getFlagValue(args, "--point");
  let anchor: { kind: "actor_path_point"; actorId: string; pointId: string } | undefined;
  let time = requestedTime;
  if (actorSelector || pointId) {
    if (!actorSelector || !pointId) throw new Error("Anchored cuts require both --actor and --point");
    const actor = resolveByIdOrName(project.actors, actorSelector, "Actor");
    const point = actor.pathPoints.find((item) => item.id === pointId);
    if (!point) throw new Error(`Actor path point not found: ${pointId}`);
    anchor = { kind: "actor_path_point", actorId: actor.id, pointId };
    time = point.time;
  }
  if (time === undefined) throw new Error("--time is required for an unanchored camera cut");
  const id = getFlagValue(args, "--id") ?? `camera_cut_${randomUUID()}`;
  ensureUniqueId(project.cameraCuts, id, "Camera cut");
  const cameraCuts = [...project.cameraCuts, { id, time, cameraId: camera.id, ...(anchor ? { anchor } : {}) }]
    .sort((a, b) => a.time - b.time);
  return {
    patch: { cameraCuts, ...(time > project.duration ? { duration: time } : {}) },
    operation: "cut.add",
    entityId: id,
  };
}

function mutatePath<T extends { id: string; name: string; position: Vec3; pathPoints: PathPoint[] }>(
  project: VCameraProject,
  subject: "actor" | "prop" | "camera",
  owner: T,
  owners: T[],
  index: number,
  action: string,
  args: string[],
) {
  let pathPoints = clone(owner.pathPoints ?? []);
  if (action === "path-add") {
    const time = requiredNumber(args, "--time", 0, 3600);
    const position = parseVec3(getFlagValue(args, "--position"), "--position");
    if (!position) throw new Error("--position is required");
    const yaw = optionalNumber(args, "--yaw", -36000, 36000);
    const id = getFlagValue(args, "--id") ?? `path_${randomUUID()}`;
    if (pathPoints.some((point) => point.id === id)) throw new Error(`Path point id already exists: ${id}`);
    pathPoints.push({
      id,
      time,
      position,
      ...(yaw !== undefined ? { yaw } : {}),
    });
  } else if (action === "path-set") {
    pathPoints = parsePathPoints(getFlagValue(args, "--points-json"));
  } else if (action === "path-clear") {
    pathPoints = [];
  } else if (action === "path-delete") {
    const pointId = requireFlag(args, "--point");
    if (!pathPoints.some((point) => point.id === pointId)) throw new Error(`Path point not found: ${pointId}`);
    pathPoints = pathPoints.filter((point) => point.id !== pointId);
  } else {
    throw new Error(`Unsupported ${subject} action: ${action}`);
  }
  pathPoints.sort((a, b) => a.time - b.time);
  ensureUniquePathPointIds(pathPoints);
  const zeroPoint = pathPoints.find((point) => point.time <= 0);
  owners[index] = {
    ...owner,
    ...(zeroPoint ? { position: [...zeroPoint.position] as Vec3 } : {}),
    pathPoints,
    ...(subject === "camera" ? { movementMode: pathPoints.length ? "path" : "static", motionPreset: null } : {}),
  };
  const field = subject === "actor" ? "actors" : subject === "prop" ? "cubes" : "cameras";
  const maxTime = pathPoints.reduce((maximum, point) => Math.max(maximum, point.time), 0);
  const patch = { [field]: owners, ...(maxTime > project.duration ? { duration: maxTime } : {}) } as ProjectPatch;
  if (subject === "actor") {
    const pointTimes = new Map(pathPoints.map((point) => [point.id, point.time]));
    patch.cameraCuts = project.cameraCuts.flatMap((cut) => {
      if (cut.anchor?.actorId !== owner.id) return [cut];
      const anchoredTime = pointTimes.get(cut.anchor.pointId);
      return anchoredTime === undefined ? [] : [{ ...cut, time: anchoredTime }];
    }).sort((a, b) => a.time - b.time);
  }
  return {
    patch,
    operation: `${subject}.${action}`,
    entityId: owner.id,
  };
}

async function inspectVCamera(api: ApiClient, args: string[], asJson: boolean): Promise<void> {
  const canvas = await getCanvas(api, requireFlag(args, "--canvas-id"));
  const requestedNodeId = getFlagValue(args, "--node-id");
  const nodes = findVCameraNodes(canvas);
  if (!requestedNodeId && nodes.length !== 1) {
    const payload = nodes.map((node) => ({ id: String(node.id), title: String(node.title ?? "Virtual Shoot") }));
    asJson ? json({ canvas_id: canvas.id, nodes: payload }) : text(payload.map((item) => `${item.id}\t${item.title}`).join("\n") || "No V-camera nodes.");
    return;
  }
  const node = findVCameraNode(canvas, requestedNodeId);
  const project = normalizeProject(getNodeProject(node));
  if (asJson) {
    json({ canvas_id: canvas.id, node_id: String(node.id), revision: canvas.revision ?? 0, project });
    return;
  }
  text([
    `V-camera node: ${String(node.id)}`,
    `Project: ${project.name}`,
    `Actors: ${project.actors.length}`,
    `Props: ${project.cubes.length}`,
    `Cameras: ${project.cameras.length}`,
    `Cuts: ${project.cameraCuts.length}`,
    `Duration: ${project.duration}s`,
  ].join("\n"));
}

async function getCanvas(api: ApiClient, canvasId: string): Promise<CanvasData> {
  const response = await api.getJson<CanvasResponse>(`/canvas/${encodeURIComponent(canvasId)}`);
  if (!response.success || !response.data) throw new Error(response.error ?? "Canvas not found");
  return response.data;
}

function findVCameraNodes(canvas: CanvasData): Record<string, unknown>[] {
  return (canvas.nodes ?? []).filter((node) => isRecord(node) && node.type === "v-camera") as Record<string, unknown>[];
}

function findVCameraNode(canvas: CanvasData, nodeId?: string): Record<string, unknown> {
  const nodes = findVCameraNodes(canvas);
  if (nodeId) {
    const node = nodes.find((item) => String(item.id) === nodeId);
    if (!node) throw new Error(`V-camera node not found: ${nodeId}`);
    return node;
  }
  if (!nodes.length) throw new Error("No V-camera node found on this canvas");
  if (nodes.length > 1) throw new Error("Multiple V-camera nodes found. Specify --node-id.");
  return nodes[0];
}

function getNodeProject(node: Record<string, unknown>): unknown {
  const data = isRecord(node.data) ? node.data : {};
  return data.vCameraProject ?? defaultVCameraProject();
}

function shiftOwnerAndPath<T extends { position: Vec3; pathPoints: PathPoint[] }>(owner: T, position: Vec3) {
  const delta: Vec3 = [position[0] - owner.position[0], position[1] - owner.position[1], position[2] - owner.position[2]];
  return {
    position,
    pathPoints: (owner.pathPoints ?? []).map((point) => ({
      ...point,
      position: [
        point.position[0] + delta[0],
        point.position[1] + delta[1],
        point.position[2] + delta[2],
      ] as Vec3,
    })),
  };
}

function nextNumericName(actors: Actor[]): string {
  const used = new Set(actors.map((actor) => actor.name).filter((name) => /^\d+$/.test(name)).map(Number));
  let value = 1;
  while (used.has(value)) value += 1;
  return String(value);
}

function ensureUniqueId(items: Array<{ id: string }>, id: string, label: string): void {
  if (items.some((item) => item.id === id)) throw new Error(`${label} id already exists: ${id}`);
}

function ensureUniquePathPointIds(points: PathPoint[]): void {
  const ids = new Set<string>();
  for (const point of points) {
    if (ids.has(point.id)) throw new Error(`Path point id already exists: ${point.id}`);
    ids.add(point.id);
  }
}

function requireFlag(args: string[], flag: string): string {
  const value = getFlagValue(args, flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function requireText(value: string, flag: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${flag} cannot be empty`);
  return text;
}

function requiredNumber(args: string[], flag: string, minimum: number, maximum: number): number {
  const value = optionalNumber(args, flag, minimum, maximum);
  if (value === undefined) throw new Error(`${flag} is required`);
  return value;
}

function optionalNumber(args: string[], flag: string, minimum: number, maximum: number): number | undefined {
  const value = getFlagValue(args, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function optionalInteger(args: string[], flag: string, minimum: number, maximum: number): number | undefined {
  const parsed = optionalNumber(args, flag, minimum, maximum);
  if (parsed !== undefined && !Number.isInteger(parsed)) {
    throw new Error(`${flag} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function optionalBoolean(args: string[], flag: string): boolean | undefined {
  const value = getFlagValue(args, flag);
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${flag} must be true or false`);
}

export function vCameraUsage(): string {
  return [
    "Usage: mir-cli canvas v-camera <inspect|create|project|actor|prop|camera|cut> ...",
    "  actor/prop/camera: add | set | delete | path add | path set | path delete | path clear",
    "  camera: follow | preset",
    "  cut: add | delete | clear",
    "Use --dry-run to inspect a change without writing it; mutations otherwise require --yes.",
  ].join("\n");
}
