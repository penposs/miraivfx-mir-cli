import { randomUUID } from "node:crypto";

export type Vec3 = [number, number, number];
export type SafeFrameRatio = "off" | "9:16" | "16:9" | "1:1";
export type CameraMovementMode = "static" | "path" | "follow";
export type CameraAimMode = "manual" | "actor";
export type CameraTrackingPoint = "head" | "chest" | "center";
export type CameraMotionPreset =
  | "push_in"
  | "pull_out"
  | "truck_left"
  | "truck_right"
  | "fixed_tracking"
  | "lead_follow"
  | "chase_follow"
  | "orbit_left"
  | "orbit_right";

export type PropPreset = "box" | "thin_wall" | "column" | "platform" | "obstacle" | "door_frame" | "stairs" | "slope";

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
  const source = isRecord(value) ? clone(value) : defaultVCameraProject();
  return {
    ...defaultVCameraProject(),
    ...source,
    version: 1,
    cubes: Array.isArray(source.cubes) ? (source.cubes as Prop[]).map(normalizePathOwner) : [],
    actors: Array.isArray(source.actors) ? (source.actors as Actor[]).map(normalizePathOwner) : [],
    cameras: Array.isArray(source.cameras) ? source.cameras.map(normalizeCamera) : [],
    cameraCuts: Array.isArray(source.cameraCuts) ? source.cameraCuts as CameraCut[] : [],
    activeCameraId: typeof source.activeCameraId === "string" ? source.activeCameraId : null,
  };
}

export function normalizeCamera(value: unknown): Camera {
  const camera = isRecord(value) ? value : {};
  const pathPoints = Array.isArray(camera.pathPoints) ? camera.pathPoints as PathPoint[] : [];
  const zeroPoint = [...pathPoints].sort((a, b) => a.time - b.time).find((point) => point.time <= 0);
  return {
    id: String(camera.id ?? `camera_${randomUUID()}`),
    name: String(camera.name ?? "Camera"),
    position: zeroPoint ? [...zeroPoint.position] : vec3Or(camera.position, [0, 1.6, 3]),
    rotation: vec3Or(camera.rotation, [0, 180, 0]),
    fov: finiteOr(camera.fov, 35),
    duration: finiteOr(camera.duration, 3),
    pathPoints,
    movementMode: camera.movementMode === "path" || camera.movementMode === "follow" ? camera.movementMode : "static",
    aimMode: camera.aimMode === "actor" ? "actor" : "manual",
    trackingActorId: typeof camera.trackingActorId === "string" ? camera.trackingActorId : null,
    trackingPoint: camera.trackingPoint === "head" || camera.trackingPoint === "center" ? camera.trackingPoint : "chest",
    followOffset: vec3Or(camera.followOffset, [0, 1.6, 3]),
    followSpeed: finiteOr(camera.followSpeed, 6),
    motionPreset: isMotionPreset(camera.motionPreset) ? camera.motionPreset : null,
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
  return [
    "push_in", "pull_out", "truck_left", "truck_right", "fixed_tracking",
    "lead_follow", "chase_follow", "orbit_left", "orbit_right",
  ].includes(String(value));
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

function vec3Or(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? parsed as Vec3 : [...fallback];
}

function normalizePathOwner<T extends { position: Vec3; pathPoints: PathPoint[] }>(owner: T): T {
  const pathPoints = Array.isArray(owner.pathPoints) ? owner.pathPoints : [];
  const zeroPoint = [...pathPoints].sort((a, b) => a.time - b.time).find((point) => point.time <= 0);
  return {
    ...owner,
    position: zeroPoint ? [...zeroPoint.position] : owner.position,
    pathPoints,
  };
}

function finiteOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
