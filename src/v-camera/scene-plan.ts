import { createNeutralActorPose, resolveActorPosePreset } from "./actor-pose.js";
import {
  defaultVCameraProject, getCompleteScenePatch, isRecord, normalizeCompleteSceneProject,
  normalizeProject, type Vec3, type Prop, type VCameraProject, type ActorPosePreset,
} from "./project.js";

/** Agent-authored spatial plan. Image interpretation stays with the calling agent. */
export const SCENE_PLAN_VERSION = 1;

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}
function list(value: unknown, path: string, limit = 500): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${path} must be an array of at most ${limit} items`);
  return value;
}
function number(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
}
function positive(value: unknown, path: string, fallback?: number): number {
  const result = number(value, path, fallback);
  if (result <= 0) throw new Error(`${path} must be positive`);
  return result;
}
function vector(value: unknown, path: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${path} must be [x,y,z] in meters`);
  return value.map((item, index) => number(item, `${path}[${index}]`)) as Vec3;
}
function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[\p{L}\p{N}_-]{1,80}$/u.test(value)) {
    throw new Error(`${path} must be 1..80 letters, numbers, underscores or hyphens`);
  }
  return value;
}
function fields(value: Record<string, unknown>, allowed: string[], path: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${path}: unsupported fields ${unknown.join(", ")}`);
}
const round = (value: number) => Number(value.toFixed(3));

export function compileScenePlan(input: unknown) {
  const plan = object(input, "plan");
  fields(plan, ["version", "name", "units", "fps", "duration", "safeFrameRatio", "reference", "assumptions", "anchors", "rooms", "props", "actors", "cameras", "shots", "activeCameraId"], "plan");
  if (plan.version !== SCENE_PLAN_VERSION || plan.units !== "meter") throw new Error("plan requires version: 1 and units: 'meter'");
  const project = defaultVCameraProject();
  project.name = typeof plan.name === "string" ? plan.name : "Spatial previs";
  project.fps = number(plan.fps, "fps", 24);
  project.safeFrameRatio = (plan.safeFrameRatio ?? "16:9") as VCameraProject["safeFrameRatio"];
  const anchors: Record<string, Vec3> = Object.create(null);
  for (const [name, value] of Object.entries(object(plan.anchors ?? {}, "anchors"))) {
    anchors[identifier(name, "anchor name")] = vector(value, `anchors.${name}`);
  }
  const point = (value: unknown, path: string): Vec3 => {
    if (typeof value === "string") {
      if (!anchors[value]) throw new Error(`${path}: unknown anchor ${value}`);
      return [...anchors[value]];
    }
    return vector(value, path);
  };
  const entities = new Set<string>();
  const claim = (value: unknown, path: string) => {
    const id = identifier(value, path);
    if (entities.has(id)) throw new Error(`Duplicate entity ID: ${id}`);
    entities.add(id);
    return id;
  };
  const groups: Array<{ id: string; kind: string; entityIds: string[] }> = [];
  const addBox = (id: string, position: Vec3, scale: Vec3, preset: Prop["propPreset"] = "box", rotation: Vec3 = [0, 0, 0]) => {
    if (scale.some((value) => value < 0.05)) throw new Error(`${id}: each generated dimension must be at least 0.05m`);
    claim(id, "generated prop ID");
    project.cubes.push({ id, name: id, position: position.map(round) as Vec3, rotation, scale: scale.map(round) as Vec3, propPreset: preset, visible: true, locked: false, pathPoints: [] });
    return id;
  };

  for (const [index, item] of list(plan.rooms, "rooms", 100).entries()) {
    const room = object(item, `rooms[${index}]`);
    fields(room, ["id", "position", "size", "wallThickness", "floorThickness", "doors"], "room");
    const id = identifier(room.id, "room.id");
    const origin = point(room.position, `${id}.position`);
    const [width, height, depth] = vector(room.size, `${id}.size`);
    if (Math.min(width, height, depth) < 0.5) throw new Error(`${id}: room dimensions must be at least 0.5m`);
    const thickness = positive(room.wallThickness, "wallThickness", 0.15);
    const floor = positive(room.floorThickness, "floorThickness", 0.1);
    const members = [addBox(`${id}_floor`, [origin[0], origin[1] - floor / 2, origin[2]], [width + thickness * 2, floor, depth + thickness * 2], "platform")];
    const doors = list(room.doors, `${id}.doors`, 40).map((value) => {
      const door = object(value, `${id}.door`);
      fields(door, ["wall", "offset", "width", "height"], "door");
      if (!["north", "south", "east", "west"].includes(String(door.wall))) throw new Error(`${id}: door wall must be north, south, east or west`);
      const span = door.wall === "north" || door.wall === "south" ? width : depth;
      const offset = number(door.offset, "door.offset", 0);
      const w = positive(door.width, "door.width", 1.2);
      const h = positive(door.height, "door.height", 2.2);
      if (Math.abs(offset) + w / 2 > span / 2 || h > height) throw new Error(`${id}: door must fit inside its wall`);
      return { wall: door.wall, offset, width: w, height: h };
    });
    for (const wall of ["north", "south", "east", "west"]) {
      const horizontal = wall === "north" || wall === "south";
      const span = horizontal ? width : depth;
      const offset = (wall === "north" || wall === "west" ? -1 : 1) * ((horizontal ? depth : width) / 2 + thickness / 2);
      let segmentIndex = 0;
      const segment = (start: number, end: number, bottom: number, top: number) => {
        if (end - start < 0.0001 || top - bottom < 0.0001) return;
        const center = (start + end) / 2;
        members.push(addBox(`${id}_${wall}_${segmentIndex++}`,
          [origin[0] + (horizontal ? center : offset), origin[1] + (top + bottom) / 2, origin[2] + (horizontal ? offset : center)],
          horizontal ? [end - start, top - bottom, thickness] : [thickness, top - bottom, end - start], "thin_wall"));
      };
      let cursor = -span / 2;
      for (const door of doors.filter((door) => door.wall === wall).sort((a, b) => a.offset - b.offset)) {
        const start = door.offset - door.width / 2;
        const end = door.offset + door.width / 2;
        if (start < cursor) throw new Error(`${id}: overlapping doors on ${wall}`);
        segment(cursor, start, 0, height);
        segment(start, end, door.height, height);
        cursor = end;
      }
      segment(cursor, span / 2, 0, height);
    }
    groups.push({ id, kind: "room", entityIds: members });
  }

  const route = (value: unknown, id: string, origin: Vec3, kind: "actor" | "prop" | "camera") => {
    const points = list(value, `${id}.route`, 2000).map((item, index) => {
      const step = object(item, `${id}.route[${index}]`);
      fields(step, ["time", "position", "easing", ...(kind === "actor" ? ["yaw"] : ["rotation"]), ...(kind === "camera" ? ["fov", "focusDistance"] : [])], `${id}.route[${index}]`);
      const time = number(step.time, `${id}.route[${index}].time`);
      if (time < 0) throw new Error(`${id}: route time cannot be negative`);
      return { ...step, id: `${id}_path_${index}`, time, position: point(step.position, `${id}.route[${index}].position`), easing: step.easing ?? "linear" };
    });
    for (let index = 1; index < points.length; index++) {
      if (points[index].time <= points[index - 1].time) throw new Error(`${id}: route times must be strictly increasing`);
    }
    if (points.length && points[0].time > 0) points.unshift({ id: `${id}_origin`, time: 0, position: origin, easing: "linear" });
    if (points.length && points[0].position.some((value, axis) => Math.abs(value - origin[axis]) > 0.0001)) {
      throw new Error(`${id}: zero-time route position must match the entity position`);
    }
    return points;
  };

  for (const [index, item] of list(plan.props, "props").entries()) {
    const prop = object(item, `props[${index}]`);
    fields(prop, ["id", "name", "preset", "position", "size", "rotation", "stepCount", "route", "visibilityKeyframes"], "prop");
    const id = identifier(prop.id, "prop.id");
    const position = point(prop.position, `${id}.position`);
    const rotation = vector(prop.rotation ?? [0, 0, 0], `${id}.rotation`);
    const size = vector(prop.size, `${id}.size`);
    if (prop.preset === "table" || prop.preset === "chair") {
      if (prop.route || prop.visibilityKeyframes) throw new Error(`${id}: moving composite furniture is not supported; use primitive props`);
      if (rotation[0] !== 0 || rotation[2] !== 0) throw new Error(`${id}: composite furniture supports yaw rotation only`);
      const [w, h, d] = size;
      if (Math.min(w, h, d) < 0.3) throw new Error(`${id}: furniture dimensions must be at least 0.3m`);
      const ids: string[] = [];
      const yaw = rotation[1] * Math.PI / 180;
      const part = (name: string, local: Vec3, scale: Vec3) => ids.push(addBox(`${id}_${name}`,
        [position[0] + local[0] * Math.cos(yaw) + local[2] * Math.sin(yaw), position[1] + local[1], position[2] - local[0] * Math.sin(yaw) + local[2] * Math.cos(yaw)], scale, "box", rotation));
      const seat = prop.preset === "chair" ? h * 0.5 : h;
      part("top", [0, seat - 0.05, 0], [w, 0.1, d]);
      for (const x of [-1, 1]) for (const z of [-1, 1]) part(`leg_${x}_${z}`, [x * (w / 2 - 0.05), (seat - 0.1) / 2, z * (d / 2 - 0.05)], [0.1, seat - 0.1, 0.1]);
      if (prop.preset === "chair") part("back", [0, (h + seat) / 2, d / 2 - 0.05], [w, h - seat, 0.1]);
      groups.push({ id, kind: String(prop.preset), entityIds: ids });
    } else {
      addBox(id, position, size, (prop.preset ?? "box") as Prop["propPreset"], rotation);
      Object.assign(project.cubes.at(-1)!, {
        name: prop.name ?? id,
        pathPoints: route(prop.route, id, position, "prop"),
        ...(prop.stepCount === undefined ? {} : { stepCount: prop.stepCount }),
        ...(prop.visibilityKeyframes === undefined ? {} : { visibilityKeyframes: prop.visibilityKeyframes }),
      });
    }
  }
  for (const [index, item] of list(plan.actors, "actors", 200).entries()) {
    const actor = object(item, `actors[${index}]`);
    fields(actor, ["id", "name", "position", "rotation", "height", "route", "poses", "lookAtActorId", "lookAtPoint", "orientationMode", "actions"], "actor");
    const id = claim(actor.id, "actor.id");
    const position = point(actor.position, `${id}.position`);
    const poses = list(actor.poses, `${id}.poses`).map((item, index) => {
      const pose = object(item, "pose");
      fields(pose, ["time", "preset", "parameters", "easing"], "pose");
      return { id: `${id}_pose_${index}`, time: number(pose.time, "pose.time"), easing: pose.easing ?? "smooth", pose: resolveActorPosePreset(pose.preset as ActorPosePreset, positive(actor.height, "actor.height", 1.75), pose.parameters as Parameters<typeof resolveActorPosePreset>[2]) };
    });
    project.actors.push({
      id, name: String(actor.name ?? id), position, rotation: vector(actor.rotation ?? [0, 0, 0], "actor.rotation"),
      height: positive(actor.height, "actor.height", 1.75), pose: createNeutralActorPose(), poseKeyframes: poses,
      pathPoints: route(actor.route, id, position, "actor"),
      ...(actor.orientationMode === undefined ? {} : { orientationMode: actor.orientationMode }),
      ...(actor.actions === undefined ? {} : { performanceClips: list(actor.actions, `${id}.actions`).map((value, index) => {
        const clip = object(value, `${id}.actions[${index}]`);
        fields(clip, ["actionId", "startTime", "endTime", "speed", "loop", "blendIn", "blendOut"], "action");
        return { ...clip, id: `${id}_action_${index}` };
      }) }),
      ...(actor.lookAtActorId === undefined ? {} : { lookAtActorId: actor.lookAtActorId }),
      ...(actor.lookAtPoint === undefined ? {} : { lookAtPoint: point(actor.lookAtPoint, "actor.lookAtPoint") }),
    } as VCameraProject["actors"][number]);
  }
  for (const [index, item] of list(plan.cameras, "cameras", 100).entries()) {
    const camera = object(item, `cameras[${index}]`);
    fields(camera, ["id", "name", "position", "rotation", "fov", "route", "movementMode", "aimMode", "trackingActorId", "trackingPoint", "lookAtPoint", "followOffset", "followSpeed"], "camera");
    const id = claim(camera.id, "camera.id");
    const position = point(camera.position, `${id}.position`);
    const pathPoints = route(camera.route, id, position, "camera");
    project.cameras.push({
      id, name: String(camera.name ?? id), position, rotation: vector(camera.rotation ?? [0, 0, 0], "camera.rotation"),
      fov: number(camera.fov, "camera.fov", 45), duration: 1, pathPoints,
      movementMode: camera.movementMode ?? (pathPoints.length ? "path" : "static"),
      aimMode: camera.aimMode ?? (camera.trackingActorId ? "actor" : camera.lookAtPoint ? "point" : "manual"),
      trackingActorId: camera.trackingActorId ?? null, trackingPoint: camera.trackingPoint ?? "chest",
      followOffset: vector(camera.followOffset ?? [0, 1.6, 3], "followOffset"), followSpeed: number(camera.followSpeed, "followSpeed", 6), motionPreset: null,
      ...(camera.lookAtPoint === undefined ? {} : { lookAtPoint: point(camera.lookAtPoint, "camera.lookAtPoint") }),
    } as VCameraProject["cameras"][number]);
  }
  if (!project.cameras.length) throw new Error("At least one camera is required for previs");
  project.activeCameraId = String(plan.activeCameraId ?? project.cameras[0].id);
  project.shots = list(plan.shots, "shots", 2000).map((value, index) => {
    const shot = object(value, `shots[${index}]`);
    fields(shot, ["id", "name", "startTime", "endTime", "cameraId"], "shot");
    return { ...shot, id: identifier(shot.id, "shot.id"), name: String(shot.name ?? shot.id), locked: false, metadata: {} } as VCameraProject["shots"][number];
  });
  project.cameraCuts = project.shots.map((shot) => ({ id: `${shot.id}_cut`, time: shot.startTime, cameraId: shot.cameraId, shotId: shot.id }));
  // Duration is derived by the existing runtime. A terminal hold preserves an explicit requested duration.
  const end = Math.max(1, ...[...project.actors, ...project.cameras, ...project.cubes].flatMap((entity) => entity.pathPoints.map((p) => p.time)), ...project.actors.flatMap((actor) => [...actor.poseKeyframes.map((p) => p.time), ...(actor.performanceClips ?? []).map((clip) => clip.endTime)]), ...project.shots.map((shot) => shot.endTime));
  const duration = number(plan.duration, "duration", end);
  if (duration < end) throw new Error(`duration ${duration} is shorter than the final event at ${end}`);
  if (!project.shots.length) {
    project.shots = [{ id: "previs_shot", name: "Previs", startTime: 0, endTime: duration, cameraId: project.activeCameraId, locked: false, metadata: {} }];
    project.cameraCuts = [{ id: "previs_cut", time: 0, cameraId: project.activeCameraId, shotId: "previs_shot" }];
  } else if (Math.max(...project.shots.map((shot) => shot.endTime)) < duration) {
    throw new Error("The final shot must cover the requested duration");
  }
  project.duration = duration;
  const normalized = normalizeProject(project, { repairReferences: false });
  const scene = getCompleteScenePatch(normalized);
  normalizeCompleteSceneProject(scene);
  return {
    scene,
    report: { version: SCENE_PLAN_VERSION, units: "meter", anchors, groups, reference: plan.reference ?? null, assumptions: list(plan.assumptions, "assumptions", 100), warnings: ["Routes use explicit world coordinates; automatic navigation is not implied. Run scene validate and inspect rendered frames before delivery."] },
  };
}
