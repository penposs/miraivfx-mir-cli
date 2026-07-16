import { randomUUID } from "node:crypto";
import {
  VCAMERA_DEFAULTS,
  VCAMERA_ENUMS,
  VCAMERA_LIMITS,
} from "./contract.js";

export type Vec3 = [number, number, number];
export type SafeFrameRatio = "off" | "9:16" | "16:9" | "1:1";
export type SceneEasing = "smooth" | "linear" | "ease_in" | "ease_out" | "ease_in_out";
export const SCENE_EASINGS = VCAMERA_ENUMS.sceneEasing;
export type CameraMovementMode = "static" | "path" | "follow";
export type CameraAimMode = "manual" | "actor" | "point";
export type CameraTrackingPoint = "head" | "chest" | "center";
export const CAMERA_MOTION_PRESETS = VCAMERA_ENUMS.cameraMotionPreset;
export type CameraMotionPreset = typeof CAMERA_MOTION_PRESETS[number];

export const PROP_PRESETS = VCAMERA_ENUMS.propPreset;
export type PropPreset = typeof PROP_PRESETS[number];

export interface ScenePathPoint {
  id: string;
  time: number;
  position: Vec3;
  easing?: SceneEasing;
}

export interface ActorPathPoint extends ScenePathPoint {
  yaw?: number;
}

export interface PropPathPoint extends ScenePathPoint {
  rotation?: Vec3;
}

export interface CameraPathPoint extends ScenePathPoint {
  rotation?: Vec3;
  fov?: number;
  focusDistance?: number;
}

export type PathPoint = ActorPathPoint;

export interface Actor {
  id: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  height: number;
  lookAtActorId?: string | null;
  lookAtPoint?: Vec3 | null;
  actionMarkers?: Array<{
    id: string;
    time: number;
    action: string;
    targetActorId?: string;
    targetPoint?: Vec3;
  }>;
  pathPoints: ActorPathPoint[];
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
  sourceType?: "primitive" | "asset";
  assetId?: string;
  visibilityKeyframes?: Array<{ id: string; time: number; visible: boolean }>;
  pathPoints: PropPathPoint[];
}

export interface Camera {
  id: string;
  name: string;
  position: Vec3;
  rotation: Vec3;
  fov: number;
  focusDistance?: number;
  duration: number;
  pathPoints: CameraPathPoint[];
  movementMode: CameraMovementMode;
  aimMode: CameraAimMode;
  trackingActorId: string | null;
  lookAtPoint?: Vec3 | null;
  trackingPoint: CameraTrackingPoint;
  followOffset: Vec3;
  followSpeed: number;
  motionPreset: CameraMotionPreset | null;
}

export interface CameraCut {
  id: string;
  time: number;
  cameraId: string;
  shotId?: string;
  anchor?: {
    kind: "actor_path_point";
    actorId: string;
    pointId: string;
  };
}

export interface CameraShot {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  cameraId: string;
  locked: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface VCameraProject extends Record<string, unknown> {
  version: 1 | 2 | 3;
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
  shots: CameraShot[];
  activeCameraId: string | null;
}

export const PROP_DEFAULTS: Record<PropPreset, { name: string; scale: Vec3 }> = {
  box: { name: VCAMERA_DEFAULTS.propPresets.box.name, scale: [...VCAMERA_DEFAULTS.propPresets.box.scale] },
  thin_wall: { name: VCAMERA_DEFAULTS.propPresets.thin_wall.name, scale: [...VCAMERA_DEFAULTS.propPresets.thin_wall.scale] },
  column: { name: VCAMERA_DEFAULTS.propPresets.column.name, scale: [...VCAMERA_DEFAULTS.propPresets.column.scale] },
  platform: { name: VCAMERA_DEFAULTS.propPresets.platform.name, scale: [...VCAMERA_DEFAULTS.propPresets.platform.scale] },
  obstacle: { name: VCAMERA_DEFAULTS.propPresets.obstacle.name, scale: [...VCAMERA_DEFAULTS.propPresets.obstacle.scale] },
  door_frame: { name: VCAMERA_DEFAULTS.propPresets.door_frame.name, scale: [...VCAMERA_DEFAULTS.propPresets.door_frame.scale] },
  stairs: { name: VCAMERA_DEFAULTS.propPresets.stairs.name, scale: [...VCAMERA_DEFAULTS.propPresets.stairs.scale] },
  slope: { name: VCAMERA_DEFAULTS.propPresets.slope.name, scale: [...VCAMERA_DEFAULTS.propPresets.slope.scale] },
};

export function defaultVCameraProject(): VCameraProject {
  return {
    version: 3,
    name: VCAMERA_DEFAULTS.project.name,
    fps: VCAMERA_DEFAULTS.project.fps,
    duration: VCAMERA_DEFAULTS.project.duration,
    currentTime: 0,
    isPlaying: false,
    safeFrameRatio: VCAMERA_DEFAULTS.project.safeFrameRatio,
    cubes: [],
    actors: [],
    cameras: [],
    cameraCuts: [],
    shots: [],
    takes: [],
    activeCameraId: null,
    savedScenes: [],
    activeSavedSceneId: null,
  };
}

export function normalizeProject(value: unknown): VCameraProject {
  const defaults = defaultVCameraProject();
  const source = isRecord(value) ? clone(value) : defaults;
  const sourceVersion = normalizeProjectVersion(source.version);
  const legacySource = sourceVersion < 3;
  const cubes = normalizeCollection(
    source.cubes,
    "cubes",
    VCAMERA_LIMITS.collections.props,
    (item, path) => normalizeProp(item, path, legacySource),
  );
  const actors = normalizeCollection(
    source.actors,
    "actors",
    VCAMERA_LIMITS.collections.actors,
    (item, path) => normalizeActor(item, path, legacySource),
  );
  const cameras = normalizeCollection(
    source.cameras,
    "cameras",
    VCAMERA_LIMITS.collections.cameras,
    (item, path) => normalizeCameraAt(item, path, legacySource),
  );
  const cameraCuts = normalizeCollection(source.cameraCuts, "cameraCuts", VCAMERA_LIMITS.collections.cameraCuts, normalizeCameraCut);
  const shots = normalizeCollection(source.shots, "shots", VCAMERA_LIMITS.collections.shots, normalizeCameraShot)
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  ensureUniqueProjectIds(cubes, "cubes");
  ensureUniqueProjectIds(actors, "actors");
  ensureUniqueProjectIds(cameras, "cameras");
  ensureUniqueProjectIds(cameraCuts, "cameraCuts");
  ensureUniqueProjectIds(shots, "shots");
  const project: VCameraProject = {
    ...defaults,
    ...source,
    version: 3,
    name: source.name === undefined ? defaults.name : projectText(source.name, "name"),
    fps: source.fps === undefined ? defaults.fps : projectNumber(source.fps, "fps", VCAMERA_LIMITS.fps.minimum, VCAMERA_LIMITS.fps.maximum),
    duration: source.duration === undefined ? defaults.duration : projectNumber(source.duration, "duration", VCAMERA_LIMITS.positiveSceneTime.minimum, VCAMERA_LIMITS.positiveSceneTime.maximum),
    currentTime: source.currentTime === undefined ? defaults.currentTime : projectNumber(source.currentTime, "currentTime", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum),
    isPlaying: source.isPlaying === undefined ? defaults.isPlaying : projectBoolean(source.isPlaying, "isPlaying"),
    safeFrameRatio: normalizeSafeFrame(source.safeFrameRatio),
    cubes,
    actors,
    cameras,
    cameraCuts: cameraCuts.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)),
    shots,
    activeCameraId: source.activeCameraId == null ? null : projectText(source.activeCameraId, "activeCameraId"),
  };
  const repairedProject = repairProjectReferences(project);
  validateProjectReferences(repairedProject);
  repairedProject.duration = getProjectSceneEnd(repairedProject);
  return repairedProject;
}

export function normalizeCamera(value: unknown): Camera {
  return normalizeCameraAt(value, "camera", false);
}

function normalizeCameraAt(value: unknown, path: string, legacySource: boolean): Camera {
  const camera = projectRecord(value, path, [
    "id", "name", "position", "rotation", "fov", "focusDistance", "duration", "pathPoints",
    "movementMode", "aimMode", "trackingActorId", "trackingPoint", "followOffset",
    "followSpeed", "motionPreset", "lookAtPoint",
  ]);
  const pathPoints = normalizeCameraPathPoints(camera.pathPoints, `${path}.pathPoints`, legacySource);
  const zeroPoint = [...pathPoints].sort((a, b) => a.time - b.time).find((point) => point.time <= 0);
  const position = projectVec3(camera.position, `${path}.position`);
  const movementMode = camera.movementMode === undefined
    ? "static"
    : projectChoice(camera.movementMode, `${path}.movementMode`, ["static", "path", "follow"] as const);
  const aimMode = camera.aimMode === undefined
    ? "manual"
    : projectChoice(camera.aimMode, `${path}.aimMode`, ["manual", "actor", "point"] as const);
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
    rotation: projectVec3(camera.rotation, `${path}.rotation`, VCAMERA_LIMITS.rotation.maximum),
    fov: projectNumber(camera.fov, `${path}.fov`, VCAMERA_LIMITS.fov.minimum, VCAMERA_LIMITS.fov.maximum),
    focusDistance: camera.focusDistance === undefined
      ? VCAMERA_DEFAULTS.camera.focusDistance
      : projectNumber(camera.focusDistance, `${path}.focusDistance`, VCAMERA_LIMITS.focusDistance.minimum, VCAMERA_LIMITS.focusDistance.maximum),
    duration: projectNumber(camera.duration, `${path}.duration`, VCAMERA_LIMITS.positiveSceneTime.minimum, VCAMERA_LIMITS.positiveSceneTime.maximum),
    pathPoints,
    movementMode,
    aimMode,
    trackingActorId: camera.trackingActorId == null ? null : projectText(camera.trackingActorId, `${path}.trackingActorId`),
    ...(camera.lookAtPoint == null ? {} : { lookAtPoint: projectVec3(camera.lookAtPoint, `${path}.lookAtPoint`) }),
    trackingPoint,
    followOffset: camera.followOffset === undefined
      ? [...VCAMERA_DEFAULTS.camera.followOffset] as Vec3
      : projectVec3(camera.followOffset, `${path}.followOffset`),
    followSpeed: camera.followSpeed === undefined
      ? VCAMERA_DEFAULTS.camera.followSpeed
      : projectNumber(camera.followSpeed, `${path}.followSpeed`, VCAMERA_LIMITS.followSpeed.minimum, VCAMERA_LIMITS.followSpeed.maximum),
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
  const points = parsed.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Path point ${index + 1} must be an object`);
    const position = Array.isArray(item.position)
      ? parseVec3(item.position.join(","), `point ${index + 1} position`)
      : parseVec3(String(item.position ?? ""), `point ${index + 1} position`);
    const time = Number(item.time);
    const yaw = item.yaw === undefined ? undefined : Number(item.yaw);
    if (!Number.isFinite(time) || time < VCAMERA_LIMITS.sceneTime.minimum || time > VCAMERA_LIMITS.sceneTime.maximum) {
      throw new Error(`Path point ${index + 1} time must be between ${VCAMERA_LIMITS.sceneTime.minimum} and ${VCAMERA_LIMITS.sceneTime.maximum}`);
    }
    if (yaw !== undefined && (
      !Number.isFinite(yaw)
      || yaw < VCAMERA_LIMITS.rotation.minimum
      || yaw > VCAMERA_LIMITS.rotation.maximum
    )) {
      throw new Error(`Path point ${index + 1} yaw must be between ${VCAMERA_LIMITS.rotation.minimum} and ${VCAMERA_LIMITS.rotation.maximum}`);
    }
    const easing = item.easing === undefined ? undefined : parseEasing(item.easing, `Path point ${index + 1} easing`);
    return {
      id: typeof item.id === "string" && item.id.trim() ? item.id : `path_${randomUUID()}`,
      time,
      position: position as Vec3,
      ...(yaw !== undefined ? { yaw } : {}),
      ...(easing !== undefined ? { easing } : {}),
    };
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  ensureUniquePathTimes(points, "Path points");
  return points;
}

export function parseCameraPathPoints(value: string | undefined): CameraPathPoint[] {
  if (!value) throw new Error("--points-json is required");
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("--points-json must be a JSON array");
  const points = parsed.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Camera path point ${index + 1} must be an object`);
    if (item.yaw !== undefined) {
      throw new Error(`Camera path point ${index + 1} yaw is not supported; use rotation`);
    }
    const base = parseScenePathPoint(item, index, "Camera path point");
    const rotation = item.rotation === undefined
      ? undefined
      : parseVec3(Array.isArray(item.rotation) ? item.rotation.join(",") : String(item.rotation), `point ${index + 1} rotation`);
    const fov = optionalJsonNumber(item.fov, `Camera path point ${index + 1} fov`, VCAMERA_LIMITS.fov.minimum, VCAMERA_LIMITS.fov.maximum);
    const focusDistance = optionalJsonNumber(item.focusDistance, `Camera path point ${index + 1} focusDistance`, VCAMERA_LIMITS.focusDistance.minimum, VCAMERA_LIMITS.focusDistance.maximum);
    return {
      ...base,
      ...(rotation ? { rotation } : {}),
      ...(fov !== undefined ? { fov } : {}),
      ...(focusDistance !== undefined ? { focusDistance } : {}),
    };
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  ensureUniquePathTimes(points, "Camera path points");
  return points;
}

export function parsePropPathPoints(value: string | undefined): PropPathPoint[] {
  if (!value) throw new Error("--points-json is required");
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("--points-json must be a JSON array");
  const points = parsed.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Prop path point ${index + 1} must be an object`);
    if (item.yaw !== undefined) {
      throw new Error(`Prop path point ${index + 1} yaw is not supported; use rotation`);
    }
    const base = parseScenePathPoint(item, index, "Prop path point");
    const rotation = item.rotation === undefined
      ? undefined
      : parseVec3(Array.isArray(item.rotation) ? item.rotation.join(",") : String(item.rotation), `point ${index + 1} rotation`);
    return {
      ...base,
      ...(rotation ? { rotation } : {}),
    };
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  ensureUniquePathTimes(points, "Prop path points");
  return points;
}

export function getProjectSceneEnd(project: Pick<VCameraProject, "actors" | "cubes" | "cameras" | "cameraCuts" | "shots">): number {
  const times = [...project.cameraCuts.map((cut) => cut.time), ...project.shots.map((shot) => shot.endTime)];
  for (const actor of project.actors) {
    times.push(...actor.pathPoints.map((point) => point.time));
    times.push(...(actor.actionMarkers ?? []).map((marker) => marker.time));
  }
  for (const prop of project.cubes) {
    times.push(...prop.pathPoints.map((point) => point.time));
    times.push(...(prop.visibilityKeyframes ?? []).map((point) => point.time));
  }
  for (const camera of project.cameras) times.push(...camera.pathPoints.map((point) => point.time));
  return Math.max(1, ...times.filter(Number.isFinite));
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

function normalizeActor(value: unknown, path: string, legacySource: boolean): Actor {
  const actor = projectRecord(value, path, [
    "id", "name", "position", "rotation", "height", "lookAtActorId", "lookAtPoint", "actionMarkers", "pathPoints",
  ]);
  const pathPoints = normalizeActorPathPoints(actor.pathPoints, `${path}.pathPoints`, legacySource);
  const zeroPoint = [...pathPoints].sort((a, b) => a.time - b.time).find((point) => point.time <= 0);
  const position = projectVec3(actor.position, `${path}.position`);
  return {
    id: projectText(actor.id, `${path}.id`),
    name: projectText(actor.name, `${path}.name`),
    position: zeroPoint ? [...zeroPoint.position] : position,
    rotation: projectVec3(actor.rotation, `${path}.rotation`, VCAMERA_LIMITS.rotation.maximum),
    height: projectNumber(actor.height, `${path}.height`, VCAMERA_LIMITS.actorHeight.minimum, VCAMERA_LIMITS.actorHeight.maximum),
    ...(actor.lookAtActorId == null ? {} : { lookAtActorId: projectText(actor.lookAtActorId, `${path}.lookAtActorId`) }),
    ...(actor.lookAtPoint == null ? {} : { lookAtPoint: projectVec3(actor.lookAtPoint, `${path}.lookAtPoint`) }),
    actionMarkers: normalizeCollection(actor.actionMarkers, `${path}.actionMarkers`, VCAMERA_LIMITS.collections.actionMarkersPerActor, (item, itemPath) => {
      const marker = projectRecord(item, itemPath, ["id", "time", "action", "targetActorId", "targetPoint"]);
      return {
        id: projectText(marker.id, `${itemPath}.id`),
        time: projectNumber(marker.time, `${itemPath}.time`, VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum),
        action: projectText(marker.action, `${itemPath}.action`),
        ...(marker.targetActorId == null ? {} : { targetActorId: projectText(marker.targetActorId, `${itemPath}.targetActorId`) }),
        ...(marker.targetPoint == null ? {} : { targetPoint: projectVec3(marker.targetPoint, `${itemPath}.targetPoint`) }),
      };
    }).sort((a, b) => a.time - b.time),
    pathPoints,
  };
}

function normalizeProp(value: unknown, path: string, legacySource: boolean): Prop {
  const prop = projectRecord(value, path, [
    "id", "name", "position", "rotation", "scale", "visible", "locked",
    "propPreset", "stepCount", "sourceType", "assetId", "visibilityKeyframes", "pathPoints",
  ]);
  const pathPoints = normalizePropPathPoints(prop.pathPoints, `${path}.pathPoints`, legacySource);
  const zeroPoint = [...pathPoints].sort((a, b) => a.time - b.time).find((point) => point.time <= 0);
  const position = projectVec3(prop.position, `${path}.position`);
  const propPreset = prop.propPreset == null
    ? "box"
    : projectChoice(prop.propPreset, `${path}.propPreset`, PROP_PRESETS);
  const stepCount = prop.stepCount == null
    ? undefined
    : projectInteger(prop.stepCount, `${path}.stepCount`, VCAMERA_LIMITS.stepCount.minimum, VCAMERA_LIMITS.stepCount.maximum);
  return {
    id: projectText(prop.id, `${path}.id`),
    name: projectText(prop.name, `${path}.name`),
    position: zeroPoint ? [...zeroPoint.position] : position,
    rotation: projectVec3(prop.rotation, `${path}.rotation`, VCAMERA_LIMITS.rotation.maximum),
    scale: projectVec3(prop.scale, `${path}.scale`, VCAMERA_LIMITS.scale.maximum, VCAMERA_LIMITS.scale.minimum),
    visible: prop.visible === undefined ? true : projectBoolean(prop.visible, `${path}.visible`),
    locked: prop.locked === undefined ? false : projectBoolean(prop.locked, `${path}.locked`),
    propPreset,
    ...(stepCount !== undefined ? { stepCount } : {}),
    sourceType: prop.sourceType === undefined
      ? "primitive"
      : projectChoice(prop.sourceType, `${path}.sourceType`, ["primitive", "asset"] as const),
    ...(prop.assetId == null ? {} : { assetId: projectText(prop.assetId, `${path}.assetId`) }),
    visibilityKeyframes: normalizeCollection(prop.visibilityKeyframes, `${path}.visibilityKeyframes`, VCAMERA_LIMITS.collections.visibilityKeyframesPerProp, (item, itemPath) => {
      const keyframe = projectRecord(item, itemPath, ["id", "time", "visible"]);
      return {
        id: projectText(keyframe.id, `${itemPath}.id`),
        time: projectNumber(keyframe.time, `${itemPath}.time`, VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum),
        visible: projectBoolean(keyframe.visible, `${itemPath}.visible`),
      };
    }).sort((a, b) => a.time - b.time),
    pathPoints,
  };
}

function normalizeCameraCut(value: unknown, path: string): CameraCut {
  const cut = projectRecord(value, path, ["id", "time", "cameraId", "shotId", "anchor"]);
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
    time: projectNumber(cut.time, `${path}.time`, VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum),
    cameraId: projectText(cut.cameraId, `${path}.cameraId`),
    ...(cut.shotId == null ? {} : { shotId: projectText(cut.shotId, `${path}.shotId`) }),
    ...(anchor ? { anchor } : {}),
  };
}

function normalizeCameraShot(value: unknown, path: string): CameraShot {
  const shot = projectRecord(value, path, ["id", "name", "startTime", "endTime", "cameraId", "locked", "metadata"]);
  const startTime = projectNumber(shot.startTime, `${path}.startTime`, VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
  const endTime = projectNumber(shot.endTime, `${path}.endTime`, VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
  if (endTime <= startTime) invalidProject(`${path}.endTime`, "must be greater than startTime");
  const metadata = shot.metadata == null ? undefined : projectRecord(shot.metadata, `${path}.metadata`);
  return {
    id: projectText(shot.id, `${path}.id`),
    name: projectText(shot.name, `${path}.name`),
    startTime,
    endTime,
    cameraId: projectText(shot.cameraId, `${path}.cameraId`),
    locked: shot.locked === undefined ? false : projectBoolean(shot.locked, `${path}.locked`),
    ...(metadata ? { metadata: metadata as CameraShot["metadata"] } : {}),
  };
}

function normalizeActorPathPoints(value: unknown, path: string, legacySource: boolean): ActorPathPoint[] {
  const points = normalizeCollection(value, path, VCAMERA_LIMITS.collections.pathPointsPerEntity, (item, itemPath) => {
    const point = projectRecord(item, itemPath, ["id", "time", "position", "yaw", "easing"]);
    return {
      id: projectText(point.id, `${itemPath}.id`),
      time: projectNumber(point.time, `${itemPath}.time`, VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum),
      position: projectVec3(point.position, `${itemPath}.position`),
      ...(point.yaw == null
        ? {}
        : { yaw: projectNumber(point.yaw, `${itemPath}.yaw`, VCAMERA_LIMITS.rotation.minimum, VCAMERA_LIMITS.rotation.maximum) }),
      ...(point.easing == null ? {} : { easing: projectChoice(point.easing, `${itemPath}.easing`, SCENE_EASINGS) }),
    };
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return normalizePathTimes(points, path, legacySource);
}

function normalizePropPathPoints(value: unknown, path: string, legacySource: boolean): PropPathPoint[] {
  const points = normalizeCollection(value, path, VCAMERA_LIMITS.collections.pathPointsPerEntity, (item, itemPath) => {
    const point = projectRecord(
      item,
      itemPath,
      legacySource
        ? ["id", "time", "position", "yaw", "rotation", "easing"]
        : ["id", "time", "position", "rotation", "easing"],
    );
    const rotation = point.rotation == null && legacySource && point.yaw != null
      ? [0, projectNumber(point.yaw, `${itemPath}.yaw`, VCAMERA_LIMITS.rotation.minimum, VCAMERA_LIMITS.rotation.maximum), 0] as Vec3
      : point.rotation == null
        ? undefined
        : projectVec3(point.rotation, `${itemPath}.rotation`, VCAMERA_LIMITS.rotation.maximum);
    return {
      id: projectText(point.id, `${itemPath}.id`),
      time: projectNumber(point.time, `${itemPath}.time`, VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum),
      position: projectVec3(point.position, `${itemPath}.position`),
      ...(rotation ? { rotation } : {}),
      ...(point.easing == null ? {} : { easing: projectChoice(point.easing, `${itemPath}.easing`, SCENE_EASINGS) }),
    };
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return normalizePathTimes(points, path, legacySource);
}

function normalizeCameraPathPoints(value: unknown, path: string, legacySource: boolean): CameraPathPoint[] {
  const points = normalizeCollection(value, path, VCAMERA_LIMITS.collections.pathPointsPerEntity, (item, itemPath) => {
    const point = projectRecord(
      item,
      itemPath,
      legacySource
        ? ["id", "time", "position", "yaw", "easing", "rotation", "fov", "focusDistance"]
        : ["id", "time", "position", "easing", "rotation", "fov", "focusDistance"],
    );
    const rotation = point.rotation == null && legacySource && point.yaw != null
      ? [0, projectNumber(point.yaw, `${itemPath}.yaw`, VCAMERA_LIMITS.rotation.minimum, VCAMERA_LIMITS.rotation.maximum), 0] as Vec3
      : point.rotation == null
        ? undefined
        : projectVec3(point.rotation, `${itemPath}.rotation`, VCAMERA_LIMITS.rotation.maximum);
    return {
      id: projectText(point.id, `${itemPath}.id`),
      time: projectNumber(point.time, `${itemPath}.time`, VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum),
      position: projectVec3(point.position, `${itemPath}.position`),
      ...(point.easing == null ? {} : { easing: projectChoice(point.easing, `${itemPath}.easing`, SCENE_EASINGS) }),
      ...(rotation ? { rotation } : {}),
      ...(point.fov == null ? {} : { fov: projectNumber(point.fov, `${itemPath}.fov`, VCAMERA_LIMITS.fov.minimum, VCAMERA_LIMITS.fov.maximum) }),
      ...(point.focusDistance == null ? {} : { focusDistance: projectNumber(point.focusDistance, `${itemPath}.focusDistance`, VCAMERA_LIMITS.focusDistance.minimum, VCAMERA_LIMITS.focusDistance.maximum) }),
    };
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return normalizePathTimes(points, path, legacySource);
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

function ensureUniqueProjectIds(items: Array<{ id: string; pathPoints?: ScenePathPoint[] }>, path: string): void {
  const ids = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.id)) invalidProject(path, `contains duplicate id ${item.id}`);
    ids.add(item.id);
    if (item.pathPoints) ensureUniqueProjectIds(item.pathPoints, `${path}[${index}].pathPoints`);
  }
}

function normalizeProjectVersion(value: unknown): 1 | 2 | 3 {
  const version = value === undefined ? 1 : Number(value);
  if (version !== 1 && version !== 2 && version !== 3) {
    invalidProject("version", "must be 1, 2, or 3");
  }
  return version;
}

function normalizePathTimes<T extends ScenePathPoint>(points: T[], path: string, legacySource: boolean): T[] {
  if (!legacySource) {
    ensureUniquePathTimes(points, path);
    return points;
  }
  let previousTime = -0.001;
  return points.map((point) => {
    const time = point.time <= previousTime ? round(previousTime + 0.001) : point.time;
    if (time > VCAMERA_LIMITS.sceneTime.maximum) {
      invalidProject(path, "cannot migrate duplicate times beyond the scene limit");
    }
    previousTime = time;
    return time === point.time ? point : { ...point, time };
  });
}

function ensureUniquePathTimes(points: ScenePathPoint[], label: string): void {
  const times = new Set<number>();
  for (const point of points) {
    const time = round(point.time);
    if (times.has(time)) throw new Error(`${label} contains duplicate time ${time}`);
    times.add(time);
  }
}

function parseScenePathPoint(item: Record<string, unknown>, index: number, label: string): ScenePathPoint {
  const position = Array.isArray(item.position)
    ? parseVec3(item.position.join(","), `${label} ${index + 1} position`)
    : parseVec3(String(item.position ?? ""), `${label} ${index + 1} position`);
  const time = Number(item.time);
  if (!Number.isFinite(time) || time < VCAMERA_LIMITS.sceneTime.minimum || time > VCAMERA_LIMITS.sceneTime.maximum) {
    throw new Error(`${label} ${index + 1} time must be between ${VCAMERA_LIMITS.sceneTime.minimum} and ${VCAMERA_LIMITS.sceneTime.maximum}`);
  }
  const easing = item.easing === undefined ? undefined : parseEasing(item.easing, `${label} ${index + 1} easing`);
  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id : `path_${randomUUID()}`,
    time,
    position: position as Vec3,
    ...(easing !== undefined ? { easing } : {}),
  };
}

function repairProjectReferences(project: VCameraProject): VCameraProject {
  const actorIds = new Set(project.actors.map((actor) => actor.id));
  const actors = project.actors.map((actor) => ({
    ...actor,
    lookAtActorId:
      actor.lookAtActorId && actor.lookAtActorId !== actor.id && actorIds.has(actor.lookAtActorId)
        ? actor.lookAtActorId
        : null,
    actionMarkers: (actor.actionMarkers ?? []).map((marker) => {
      if (!marker.targetActorId || (marker.targetActorId !== actor.id && actorIds.has(marker.targetActorId))) {
        return marker;
      }
      const { targetActorId: _staleTargetActorId, ...safeMarker } = marker;
      return safeMarker;
    }),
  }));
  const cameras = project.cameras.map((camera) => {
    const hasTrackingActor = Boolean(camera.trackingActorId && actorIds.has(camera.trackingActorId));
    if (hasTrackingActor && (camera.aimMode !== "point" || camera.lookAtPoint)) return camera;
    return {
      ...camera,
      trackingActorId: hasTrackingActor ? camera.trackingActorId : null,
      movementMode: !hasTrackingActor && camera.movementMode === "follow" ? "static" as const : camera.movementMode,
      aimMode:
        (!hasTrackingActor && camera.aimMode === "actor") || (camera.aimMode === "point" && !camera.lookAtPoint)
          ? "manual" as const
          : camera.aimMode,
    };
  });
  const cameraIds = new Set(cameras.map((camera) => camera.id));
  const shots = project.shots.filter((shot) => cameraIds.has(shot.cameraId));
  const shotIds = new Set(shots.map((shot) => shot.id));
  const shotStartTimes = shots.map((shot) => shot.startTime);
  const actorPointIds = new Map(actors.map((actor) => [
    actor.id,
    new Set(actor.pathPoints.map((point) => point.id)),
  ]));
  const linkedCuts = new Map(
    project.cameraCuts
      .filter((cut) => cut.shotId && shotIds.has(cut.shotId))
      .map((cut) => [cut.shotId as string, cut]),
  );
  const independentCuts = project.cameraCuts.flatMap((cut): CameraCut[] => {
    if (!cameraIds.has(cut.cameraId) || (cut.shotId && shotIds.has(cut.shotId))) return [];
    if (shotStartTimes.some((time) => Math.abs(time - cut.time) <= 0.001)) return [];
    if (cut.anchor && !actorPointIds.get(cut.anchor.actorId)?.has(cut.anchor.pointId)) return [];
    const { shotId: _shotId, ...independentCut } = cut;
    return [independentCut];
  });
  const shotCuts = shots.map((shot) => ({
    id: linkedCuts.get(shot.id)?.id ?? `camera_cut_${shot.id}`,
    time: shot.startTime,
    cameraId: shot.cameraId,
    shotId: shot.id,
  }));
  return {
    ...project,
    actors,
    cameras,
    shots,
    cameraCuts: [...independentCuts, ...shotCuts].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)),
    activeCameraId: project.activeCameraId && cameraIds.has(project.activeCameraId)
      ? project.activeCameraId
      : cameras[0]?.id ?? null,
  };
}

function validateProjectReferences(project: VCameraProject): void {
  const actorIds = new Set(project.actors.map((actor) => actor.id));
  const cameraIds = new Set(project.cameras.map((camera) => camera.id));
  const shotIds = new Set(project.shots.map((shot) => shot.id));
  if (project.activeCameraId && !cameraIds.has(project.activeCameraId)) {
    invalidProject("activeCameraId", `references missing camera ${project.activeCameraId}`);
  }
  for (const actor of project.actors) {
    if (actor.lookAtActorId && !actorIds.has(actor.lookAtActorId)) {
      invalidProject(`actors.${actor.id}.lookAtActorId`, `references missing actor ${actor.lookAtActorId}`);
    }
    if (actor.lookAtActorId === actor.id) {
      invalidProject(`actors.${actor.id}.lookAtActorId`, "cannot reference the same actor");
    }
    const markerIds = new Set<string>();
    for (const marker of actor.actionMarkers ?? []) {
      if (markerIds.has(marker.id)) invalidProject(`actors.${actor.id}.actionMarkers`, `contains duplicate id ${marker.id}`);
      markerIds.add(marker.id);
      if (marker.targetActorId && !actorIds.has(marker.targetActorId)) {
        invalidProject(`actors.${actor.id}.actionMarkers.${marker.id}`, `references missing actor ${marker.targetActorId}`);
      }
    }
  }
  for (const camera of project.cameras) {
    if (camera.trackingActorId && !actorIds.has(camera.trackingActorId)) {
      invalidProject(`cameras.${camera.id}.trackingActorId`, `references missing actor ${camera.trackingActorId}`);
    }
    if (camera.movementMode === "follow" && !camera.trackingActorId) {
      invalidProject(`cameras.${camera.id}.trackingActorId`, "is required for follow movement");
    }
    if (camera.aimMode === "actor" && !camera.trackingActorId) {
      invalidProject(`cameras.${camera.id}.trackingActorId`, "is required when aiming at an actor");
    }
    if (camera.aimMode === "point" && !camera.lookAtPoint) {
      invalidProject(`cameras.${camera.id}.lookAtPoint`, "is required when aiming at a fixed point");
    }
  }
  for (const shot of project.shots) {
    if (!cameraIds.has(shot.cameraId)) invalidProject(`shots.${shot.id}.cameraId`, `references missing camera ${shot.cameraId}`);
  }
  for (let index = 1; index < project.shots.length; index += 1) {
    if (project.shots[index].startTime < project.shots[index - 1].endTime) {
      invalidProject(`shots.${project.shots[index].id}`, `overlaps shot ${project.shots[index - 1].id}`);
    }
  }
  for (const cut of project.cameraCuts) {
    if (!cameraIds.has(cut.cameraId)) invalidProject(`cameraCuts.${cut.id}.cameraId`, `references missing camera ${cut.cameraId}`);
    if (cut.shotId && !shotIds.has(cut.shotId)) invalidProject(`cameraCuts.${cut.id}.shotId`, `references missing shot ${cut.shotId}`);
    if (cut.anchor) {
      const actor = project.actors.find((item) => item.id === cut.anchor?.actorId);
      if (!actor) invalidProject(`cameraCuts.${cut.id}.anchor.actorId`, `references missing actor ${cut.anchor.actorId}`);
      if (!actor.pathPoints.some((point) => point.id === cut.anchor?.pointId)) {
        invalidProject(`cameraCuts.${cut.id}.anchor.pointId`, `references missing path point ${cut.anchor.pointId}`);
      }
    }
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

function parseEasing(value: unknown, label: string): SceneEasing {
  if (typeof value !== "string" || !(SCENE_EASINGS as readonly string[]).includes(value)) {
    throw new Error(`${label} must be one of ${SCENE_EASINGS.join(", ")}`);
  }
  return value as SceneEasing;
}

function optionalJsonNumber(value: unknown, label: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function invalidProject(path: string, message: string): never {
  throw new Error(`Invalid V-camera project data: ${path} ${message}`);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
