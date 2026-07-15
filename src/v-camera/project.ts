import { randomUUID } from "node:crypto";

export type Vec3 = [number, number, number];
export type SafeFrameRatio = "off" | "9:16" | "16:9" | "1:1";
export type CameraMovementMode = "static" | "path" | "follow";
export type CameraAimMode = "manual" | "actor";
export type CameraTrackingPoint = "head" | "chest" | "center";
export const CAMERA_MOTION_PRESETS = [
  "push_in",
  "pull_out",
  "truck_left",
  "truck_right",
  "fixed_tracking",
  "lead_follow",
  "chase_follow",
  "orbit_left",
  "orbit_right",
] as const;
export type CameraMotionPreset = typeof CAMERA_MOTION_PRESETS[number];

export const PROP_PRESETS = [
  "box",
  "thin_wall",
  "column",
  "platform",
  "obstacle",
  "door_frame",
  "stairs",
  "slope",
] as const;
export type PropPreset = typeof PROP_PRESETS[number];

export interface PathPoint {
  id: string;
  time: number;
  position: Vec3;
  yaw?: number;
}

export interface Actor {
  id: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  height: number;
  pathPoints: PathPoint[];
}

export interface Prop {
  id: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  locked: boolean;
  propPreset?: PropPreset;
  stepCount?: number;
  pathPoints: PathPoint[];
}

export interface Camera {
  id: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  fov: number;
  duration: number;
  pathPoints: PathPoint[];
  movementMode: CameraMovementMode;
  aimMode: CameraAimMode;
  trackingActorId: string | null;
  trackingPoint: CameraTrackingPoint;
  followOffset: Vec3;
  followSpeed: number;
  motionPreset: CameraMotionPreset | null;
}

export interface CameraCut {
  id: string;
  time: number;
  cameraId: string;
  anchor?: {
    kind: "actor_path_point";
    actorId: string;
    pointId: string;
  };
}

export interface VCameraProject extends Record<string, unknown> {
  version: 1;
  name: string;
  fps: number;
  duration: number;
  currentTime?: number;
  isPlaying?: boolean;
  safeFrameRatio: SafeFrameRatio;
  cubes: Prop[];
  actors: Actor[];
  cameras: Camera[];
  cameraCuts: CameraCut[];
  activeCameraId: string | null;
}

export const PROP_DEFAULTS: Record<PropPreset, { name: string; scale: Vec3 }> = {
  box: { name: "Cube", scale: [1, 1, 1] },
  thin_wall: { name: "Thin wall", scale: [2.8, 1.7, 0.12] },
  column: { name: "Column", scale: [0.35, 2.2, 0.35] },
  platform: { name: "Platform", scale: [2.2, 0.18, 1.5] },
  obstacle: { name: "Obstacle", scale: [1.1, 0.75, 0.7] },
  door_frame: { name: "Door frame", scale: [1.8, 2.25, 0.16] },
  stairs: { name: "Stairs", scale: [1.6, 0.75, 1.4] },
  slope: { name: "Slope", scale: [1.7, 0.65, 1.35] },
};

export function defaultVCameraProject(): VCameraProject {
  return {
    version: 1,
    name: "Virtual Shoot stage",
    fps: 24,
    duration: 30,
    currentTime: 0,
    isPlaying: false,
    safeFrameRatio: "off",
    cubes: [],
    actors: [],
    cameras: [],
    cameraCuts: [],
    takes: [],
    activeCameraId: null,
    savedScenes: [],
    activeSavedSceneId: null,
  };
}

export function normalizeProject(value: unknown): VCameraProject {
  const defaults = defaultVCameraProject();
  const source = isRecord(value) ? clone(value) : defaults;
  const cubes = normalizeCollection(source.cubes, "cubes", 500, normalizeProp);
  const actors = normalizeCollection(source.actors, "actors", 200, normalizeActor);
  const cameras = normalizeCollection(source.cameras, "cameras", 100, normalizeCameraAt);
  const cameraCuts = normalizeCollection(source.cameraCuts, "cameraCuts", 2000, normalizeCameraCut);
  ensureUniqueProjectIds(cubes, "cubes");
  ensureUniqueProjectIds(actors, "actors");
  ensureUniqueProjectIds(cameras, "cameras");
  ensureUniqueProjectIds(cameraCuts, "cameraCuts");
  return {
    ...defaults,
    ...source,
    version: 1,
    name: source.name === undefined ? defaults.name : projectText(source.name, "name"),
    fps: source.fps === undefined ? defaults.fps : projectNumber(source.fps, "fps", 1, 120),
    duration: source.duration === undefined ? defaults.duration : projectNumber(source.duration, "duration", 0.01, 3600),
    currentTime: source.currentTime === undefined ? defaults.currentTime : projectNumber(source.currentTime, "currentTime", 0, 3600),
    isPlaying: source.isPlaying === undefined ? defaults.isPlaying : projectBoolean(source.isPlaying, "isPlaying"),
    safeFrameRatio: normalizeSafeFrame(source.safeFrameRatio),
    cubes,
    actors,
    cameras,
    cameraCuts,
    activeCameraId: source.activeCameraId == null ? null : projectText(source.activeCameraId, "activeCameraId"),
  };
}

export function normalizeCamera(value: unknown): Camera {
  return normalizeCameraAt(value, "camera");
}

function normalizeCameraAt(value: unknown, path: string): Camera {
  const camera = projectRecord(value, path, [
    "id", "name", "position", "rotation", "fov", "duration", "pathPoints",
    "movementMode", "aimMode", "trackingActorId", "trackingPoint", "followOffset",
    "followSpeed", "motionPreset",
  ]);
  const pathPoints = normalizePathPoints(camera.pathPoints, `${path}.pathPoints`);
  const zeroPoint = [...pathPoints].sort((a, b) => a.time - b.time).find((point) => point.time <= 0);
  const position = projectVec3(camera.position, `${path}.position`);
  const movementMode = camera.movementMode === undefined
    ? "static"
    : projectChoice(camera.movementMode, `${path}.movementMode`, ["static", "path", "follow"] as const);
  const aimMode = camera.aimMode === undefined
    ? "manual"
    : projectChoice(camera.aimMode, `${path}.aimMode`, ["manual", "actor"] as const);
  const trackingPoint = camera.trackingPoint === undefined
    ? "chest"
    : projectChoice(camera.trackingPoint, `${path}.trackingPoint`, ["head", "chest", "center"] as const);
  const motionPreset = camera.motionPreset == null
    ? null
    : projectChoice(camera.motionPreset, `${path}.motionPreset`, CAMERA_MOTION_PRESETS);
  return {
    id: projectText(camera.id, `${path}.id`),
    name: projectText(camera.name, `${path}.name`),
    position: zeroPoint ? [...zeroPoint.position] : position,
    rotation: projectVec3(camera.rotation, `${path}.rotation`, 36000),
    fov: projectNumber(camera.fov, `${path}.fov`, 1, 179),
    duration: projectNumber(camera.duration, `${path}.duration`, 0.01, 3600),
    pathPoints,
    movementMode,
    aimMode,
    trackingActorId: camera.trackingActorId == null ? null : projectText(camera.trackingActorId, `${path}.trackingActorId`),
    trackingPoint,
    followOffset: camera.followOffset === undefined
      ? [0, 1.6, 3]
      : projectVec3(camera.followOffset, `${path}.followOffset`),
    followSpeed: camera.followSpeed === undefined
      ? 6
      : projectNumber(camera.followSpeed, `${path}.followSpeed`, 0.01, 100),
    motionPreset,
  };
}

export function resolveByIdOrName<T extends { id: string; name: string }>(items: T[], selector: string, label: string): T {
  const byId = items.find((item) => item.id === selector);
  if (byId) return byId;
  const byName = items.filter((item) => item.name === selector);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`${label} name is ambiguous: ${selector}. Use the id instead.`);
  throw new Error(`${label} not found: ${selector}`);
}

export function parseVec3(value: string | undefined, flag: string): Vec3 | undefined {
  if (value === undefined) return undefined;
  const parts = value.split(",").map((item) => Number(item.trim()));
  if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) {
    throw new Error(`${flag} must be x,y,z`);
  }
  return parts as Vec3;
}

export function parsePathPoints(value: string | undefined): PathPoint[] {
  if (!value) throw new Error("--points-json is required");
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("--points-json must be a JSON array");
  return parsed.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Path point ${index + 1} must be an object`);
    const position = Array.isArray(item.position)
      ? parseVec3(item.position.join(","), `point ${index + 1} position`)
      : parseVec3(String(item.position ?? ""), `point ${index + 1} position`);
    const time = Number(item.time);
    const yaw = item.yaw === undefined ? undefined : Number(item.yaw);
    if (!Number.isFinite(time) || time < 0) throw new Error(`Path point ${index + 1} has an invalid time`);
    if (yaw !== undefined && !Number.isFinite(yaw)) throw new Error(`Path point ${index + 1} has an invalid yaw`);
    return {
      id: typeof item.id === "string" && item.id.trim() ? item.id : `path_${randomUUID()}`,
      time,
      position: position as Vec3,
      ...(yaw !== undefined ? { yaw } : {}),
    };
  }).sort((a, b) => a.time - b.time);
}

export function createMotionPresetPatch(input: {
  preset: CameraMotionPreset;
  camera: Camera;
  actor: Actor;
  duration?: number;
}): Partial<Camera> {
  const { preset, camera, actor } = input;
  const duration = clamp(input.duration ?? camera.duration, 0.5, 120);
  const actorPosition = actor.position;
  const actorYaw = actor.rotation[1];
  const startPosition = [...camera.position] as Vec3;
  const basePatch: Partial<Camera> = {
    duration: round(duration),
    trackingActorId: actor.id,
    trackingPoint: camera.trackingPoint,
    aimMode: "actor",
    motionPreset: preset,
  };

  if (preset === "fixed_tracking") return { ...basePatch, movementMode: "static", pathPoints: [] };

  if (preset === "lead_follow" || preset === "chase_follow") {
    const localOffset = worldOffsetToActorLocal([
      startPosition[0] - actorPosition[0],
      startPosition[1] - actorPosition[1],
      startPosition[2] - actorPosition[2],
    ], actorYaw);
    const distance = clamp(Math.hypot(localOffset[0], localOffset[2]), 1.5, 12);
    return {
      ...basePatch,
      movementMode: "follow",
      pathPoints: [],
      followOffset: [round(localOffset[0]), round(localOffset[1]), preset === "lead_follow" ? -distance : distance],
    };
  }

  if (preset === "orbit_left" || preset === "orbit_right") {
    return {
      ...basePatch,
      movementMode: "path",
      pathPoints: createOrbitPoints(startPosition, actorPosition, duration, preset === "orbit_left" ? -1 : 1),
    };
  }

  const basis = getViewBasis(startPosition, actorPosition);
  let endPosition = startPosition;
  if (preset === "push_in") {
    endPosition = addScaled(startPosition, basis.forward, Math.max(0.6, basis.distance * 0.45));
  } else if (preset === "pull_out") {
    endPosition = addScaled(startPosition, basis.forward, -Math.max(1.2, basis.distance * 0.65));
  } else if (preset === "truck_left" || preset === "truck_right") {
    const amount = clamp(basis.distance * 0.75, 1.5, 6);
    endPosition = addScaled(startPosition, basis.right, preset === "truck_left" ? -amount : amount);
  }
  return {
    ...basePatch,
    movementMode: "path",
    pathPoints: [pathPoint(0, startPosition), pathPoint(duration, endPosition)],
  };
}

export function cameraOffsetInActorSpace(camera: Camera, actor: Actor): Vec3 {
  return worldOffsetToActorLocal([
    camera.position[0] - actor.position[0],
    camera.position[1] - actor.position[1],
    camera.position[2] - actor.position[2],
  ], actor.rotation[1]);
}

export function isMotionPreset(value: unknown): value is CameraMotionPreset {
  return typeof value === "string" && (CAMERA_MOTION_PRESETS as readonly string[]).includes(value);
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathPoint(time: number, position: Vec3): PathPoint {
  return { id: `camera_path_${randomUUID()}`, time: round(time), position: position.map(round) as Vec3 };
}

function createOrbitPoints(camera: Vec3, target: Vec3, duration: number, direction: -1 | 1): PathPoint[] {
  const offsetX = camera[0] - target[0];
  const offsetZ = camera[2] - target[2];
  const radius = clamp(Math.hypot(offsetX, offsetZ), 1.5, 12);
  const startAngle = Math.atan2(offsetZ, offsetX);
  return Array.from({ length: 7 }, (_, index) => {
    const amount = index / 6;
    const angle = startAngle + direction * Math.PI * amount;
    return pathPoint(duration * amount, [
      target[0] + Math.cos(angle) * radius,
      camera[1],
      target[2] + Math.sin(angle) * radius,
    ]);
  });
}

function getViewBasis(camera: Vec3, target: Vec3) {
  let x = target[0] - camera[0];
  let z = target[2] - camera[2];
  let distance = Math.hypot(x, z);
  if (distance < 0.2) {
    x = 0;
    z = -1;
    distance = 1;
  }
  const forward: Vec3 = [x / distance, 0, z / distance];
  const right: Vec3 = [-forward[2], 0, forward[0]];
  return { distance, forward, right };
}

function addScaled(position: Vec3, direction: Vec3, amount: number): Vec3 {
  return [
    round(position[0] + direction[0] * amount),
    round(position[1] + direction[1] * amount),
    round(position[2] + direction[2] * amount),
  ];
}

function worldOffsetToActorLocal(offset: Vec3, yawDegrees: number): Vec3 {
  const yaw = (-yawDegrees * Math.PI) / 180;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return [
    round(offset[0] * cosine + offset[2] * sine),
    round(offset[1]),
    round(-offset[0] * sine + offset[2] * cosine),
  ];
}

function normalizeActor(value: unknown, path: string): Actor {
  const actor = projectRecord(value, path, ["id", "name", "position", "rotation", "height", "pathPoints"]);
  const pathPoints = normalizePathPoints(actor.pathPoints, `${path}.pathPoints`);
  const zeroPoint = [...pathPoints].sort((a, b) => a.time - b.time).find((point) => point.time <= 0);
  const position = projectVec3(actor.position, `${path}.position`);
  return {
    id: projectText(actor.id, `${path}.id`),
    name: projectText(actor.name, `${path}.name`),
    position: zeroPoint ? [...zeroPoint.position] : position,
    rotation: projectVec3(actor.rotation, `${path}.rotation`, 36000),
    height: projectNumber(actor.height, `${path}.height`, 0.1, 20),
    pathPoints,
  };
}

function normalizeProp(value: unknown, path: string): Prop {
  const prop = projectRecord(value, path, [
    "id", "name", "position", "rotation", "scale", "visible", "locked",
    "propPreset", "stepCount", "pathPoints",
  ]);
  const pathPoints = normalizePathPoints(prop.pathPoints, `${path}.pathPoints`);
  const zeroPoint = [...pathPoints].sort((a, b) => a.time - b.time).find((point) => point.time <= 0);
  const position = projectVec3(prop.position, `${path}.position`);
  const propPreset = prop.propPreset == null
    ? undefined
    : projectChoice(prop.propPreset, `${path}.propPreset`, PROP_PRESETS);
  const stepCount = prop.stepCount == null
    ? undefined
    : projectInteger(prop.stepCount, `${path}.stepCount`, 2, 64);
  return {
    id: projectText(prop.id, `${path}.id`),
    name: projectText(prop.name, `${path}.name`),
    position: zeroPoint ? [...zeroPoint.position] : position,
    rotation: projectVec3(prop.rotation, `${path}.rotation`, 36000),
    scale: projectVec3(prop.scale, `${path}.scale`, 1_000_000, 0.001),
    visible: prop.visible === undefined ? true : projectBoolean(prop.visible, `${path}.visible`),
    locked: prop.locked === undefined ? false : projectBoolean(prop.locked, `${path}.locked`),
    ...(propPreset !== undefined ? { propPreset } : {}),
    ...(stepCount !== undefined ? { stepCount } : {}),
    pathPoints,
  };
}

function normalizeCameraCut(value: unknown, path: string): CameraCut {
  const cut = projectRecord(value, path, ["id", "time", "cameraId", "anchor"]);
  const anchorValue = cut.anchor;
  let anchor: CameraCut["anchor"];
  if (anchorValue != null) {
    const source = projectRecord(anchorValue, `${path}.anchor`, ["kind", "actorId", "pointId"]);
    const kind = projectChoice(source.kind, `${path}.anchor.kind`, ["actor_path_point"] as const);
    anchor = {
      kind,
      actorId: projectText(source.actorId, `${path}.anchor.actorId`),
      pointId: projectText(source.pointId, `${path}.anchor.pointId`),
    };
  }
  return {
    id: projectText(cut.id, `${path}.id`),
    time: projectNumber(cut.time, `${path}.time`, 0, 3600),
    cameraId: projectText(cut.cameraId, `${path}.cameraId`),
    ...(anchor ? { anchor } : {}),
  };
}

function normalizePathPoints(value: unknown, path: string): PathPoint[] {
  return normalizeCollection(value, path, 2000, (item, itemPath) => {
    const point = projectRecord(item, itemPath, ["id", "time", "position", "yaw"]);
    return {
      id: projectText(point.id, `${itemPath}.id`),
      time: projectNumber(point.time, `${itemPath}.time`, 0, 3600),
      position: projectVec3(point.position, `${itemPath}.position`),
      ...(point.yaw == null
        ? {}
        : { yaw: projectNumber(point.yaw, `${itemPath}.yaw`, -36000, 36000) }),
    };
  });
}

function normalizeCollection<T>(
  value: unknown,
  path: string,
  maximum: number,
  normalizer: (item: unknown, path: string) => T,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalidProject(path, "must be an array");
  if (value.length > maximum) invalidProject(path, `must contain at most ${maximum} items`);
  return value.map((item, index) => normalizer(item, `${path}[${index}]`));
}

function ensureUniqueProjectIds(items: Array<{ id: string; pathPoints?: PathPoint[] }>, path: string): void {
  const ids = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.id)) invalidProject(path, `contains duplicate id ${item.id}`);
    ids.add(item.id);
    if (item.pathPoints) ensureUniqueProjectIds(item.pathPoints, `${path}[${index}].pathPoints`);
  }
}

function projectRecord(value: unknown, path: string, allowed?: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) invalidProject(path, "must be an object");
  if (allowed) {
    const allowedFields = new Set(allowed);
    const unsupported = Object.keys(value).find((key) => !allowedFields.has(key));
    if (unsupported) invalidProject(`${path}.${unsupported}`, "is not supported");
  }
  return value;
}

function projectText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalidProject(path, "must be a non-empty string");
  return value.trim();
}

function projectNumber(value: unknown, path: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    invalidProject(path, `must be a number between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function projectInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  const parsed = projectNumber(value, path, minimum, maximum);
  if (!Number.isInteger(parsed)) invalidProject(path, `must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}

function projectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalidProject(path, "must be a boolean");
  return value;
}

function projectVec3(value: unknown, path: string, limit = 1_000_000, minimum?: number): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) invalidProject(path, "must be a three-number array");
  return value.map((item, index) => projectNumber(
    item,
    `${path}[${index}]`,
    minimum ?? -limit,
    limit,
  )) as Vec3;
}

function projectChoice<const T extends readonly string[]>(value: unknown, path: string, choices: T): T[number] {
  if (typeof value !== "string" || !(choices as readonly string[]).includes(value)) {
    invalidProject(path, `must be one of ${choices.join(", ")}`);
  }
  return value as T[number];
}

function normalizeSafeFrame(value: unknown): SafeFrameRatio {
  if (value === undefined) return "off";
  return projectChoice(value, "safeFrameRatio", ["off", "9:16", "16:9", "1:1"] as const);
}

function invalidProject(path: string, message: string): never {
  throw new Error(`Invalid V-camera project data: ${path} ${message}`);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
