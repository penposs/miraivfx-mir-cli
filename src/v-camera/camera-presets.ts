import { randomUUID } from "node:crypto";
import type {
  Actor,
  Camera,
  CameraMotionPreset,
  CameraPathPoint,
  SceneEasing,
  Vec3,
} from "./project.js";
import { applySceneEasing, interpolatePathPosition } from "./path-interpolation.js";

export interface CameraPresetPatchInput {
  preset: CameraMotionPreset;
  camera: Camera;
  actor?: Actor;
  startTime: number;
  duration: number;
  easing: SceneEasing;
  amountScale: number;
  preserveSubjectScale: boolean;
}

const round = (value: number) => Number(value.toFixed(3));
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function normalizeDegrees(value: number) {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return round(normalized);
}

function rotateLocalOffset(offset: Vec3, yawDegrees: number): Vec3 {
  const yaw = (yawDegrees * Math.PI) / 180;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return [
    round(offset[0] * cosine + offset[2] * sine),
    round(offset[1]),
    round(-offset[0] * sine + offset[2] * cosine),
  ];
}

function getActorPositionAtTime(actor: Actor, time: number): Vec3 {
  return interpolatePathPosition(actor, time);
}

function getActorYawAtTime(actor: Actor, time: number) {
  const explicit = [...actor.pathPoints]
    .filter((point) => typeof point.yaw === "number" && point.time <= time)
    .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))[0];
  return explicit?.yaw ?? actor.rotation[1];
}

function makePoint(
  time: number,
  position: Vec3,
  patch: Omit<Partial<CameraPathPoint>, "id" | "time" | "position"> = {},
): CameraPathPoint {
  return {
    id: `camera_path_${randomUUID()}`,
    time: round(time),
    position: position.map(round) as Vec3,
    ...patch,
  };
}

function getViewBasis(cameraPosition: Vec3, targetPosition: Vec3) {
  let deltaX = targetPosition[0] - cameraPosition[0];
  let deltaZ = targetPosition[2] - cameraPosition[2];
  let distance = Math.hypot(deltaX, deltaZ);
  if (distance < 0.2) {
    deltaX = 0;
    deltaZ = -1;
    distance = 1;
  }
  return {
    distance,
    forward: [deltaX / distance, 0, deltaZ / distance] as Vec3,
    right: [-deltaZ / distance, 0, deltaX / distance] as Vec3,
  };
}

function addScaled(position: Vec3, direction: Vec3, amount: number): Vec3 {
  return [
    round(position[0] + direction[0] * amount),
    round(position[1] + direction[1] * amount),
    round(position[2] + direction[2] * amount),
  ];
}

function createOrbitPoints(
  cameraPosition: Vec3,
  targetPosition: Vec3,
  startTime: number,
  duration: number,
  direction: -1 | 1,
  easing: SceneEasing,
  amountScale: number,
) {
  const offsetX = cameraPosition[0] - targetPosition[0];
  const offsetZ = cameraPosition[2] - targetPosition[2];
  const radius = clamp(Math.hypot(offsetX, offsetZ), 1.5, 12);
  const startAngle = Math.atan2(offsetZ, offsetX);
  return Array.from({ length: 7 }, (_, index) => {
    const timelineAmount = index / 6;
    const angle = startAngle + direction * Math.PI * amountScale * applySceneEasing(timelineAmount, easing);
    return makePoint(startTime + duration * timelineAmount, [
      targetPosition[0] + Math.cos(angle) * radius,
      cameraPosition[1],
      targetPosition[2] + Math.sin(angle) * radius,
    ], { easing: "linear" });
  });
}

function getDollyZoomFov(startFov: number, startDistance: number, endDistance: number) {
  const startRadians = (clamp(startFov, 8, 110) * Math.PI) / 180;
  const endRadians = 2 * Math.atan(
    (Math.max(0.1, startDistance) * Math.tan(startRadians / 2)) / Math.max(0.1, endDistance),
  );
  return round(clamp((endRadians * 180) / Math.PI, 8, 110));
}

function presetModes(preset: CameraMotionPreset) {
  if (preset === "fixed_tracking") return { movementMode: "static" as const, aimMode: "actor" as const };
  if (preset === "lead_follow" || preset === "chase_follow") {
    return { movementMode: "follow" as const, aimMode: "actor" as const };
  }
  if (["pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "zoom_out"].includes(preset)) {
    return { movementMode: "path" as const, aimMode: "manual" as const };
  }
  return { movementMode: "path" as const, aimMode: "actor" as const };
}

export function createCameraPresetPatch({
  preset,
  camera,
  actor,
  startTime,
  duration,
  easing,
  amountScale,
  preserveSubjectScale,
}: CameraPresetPatchInput): Partial<Camera> {
  const endTime = round(startTime + duration);
  const startPosition = [...camera.position] as Vec3;
  const actorPosition = actor ? getActorPositionAtTime(actor, startTime) : undefined;
  const actorYaw = actor ? getActorYawAtTime(actor, startTime) : 0;
  const basis = getViewBasis(startPosition, actorPosition ?? addScaled(startPosition, [0, 0, -1], 4));
  const modes = presetModes(preset);
  const basePatch: Partial<Camera> = {
    duration: round(duration),
    movementMode: modes.movementMode,
    aimMode: modes.aimMode,
    motionPreset: preset,
    ...(actor ? { trackingActorId: actor.id } : {}),
  };

  if (preset === "fixed_tracking") return basePatch;
  if (preset === "lead_follow" || preset === "chase_follow") {
    if (!actor || !actorPosition) throw new Error(`${preset} requires --actor`);
    const worldOffset: Vec3 = [
      startPosition[0] - actorPosition[0],
      startPosition[1] - actorPosition[1],
      startPosition[2] - actorPosition[2],
    ];
    const localOffset = rotateLocalOffset(worldOffset, -actorYaw);
    const distance = clamp(Math.hypot(localOffset[0], localOffset[2]) * amountScale, 1.5, 18);
    return {
      ...basePatch,
      followOffset: [localOffset[0], localOffset[1], preset === "lead_follow" ? -distance : distance],
    };
  }
  if ((preset === "orbit_left" || preset === "orbit_right") && actorPosition) {
    return {
      ...basePatch,
      pathPoints: createOrbitPoints(
        startPosition,
        actorPosition,
        startTime,
        duration,
        preset === "orbit_left" ? -1 : 1,
        easing,
        amountScale,
      ),
    };
  }

  if (preset === "pan_left" || preset === "pan_right" || preset === "tilt_up" || preset === "tilt_down") {
    const endRotation = [...camera.rotation] as Vec3;
    if (preset === "pan_left" || preset === "pan_right") {
      endRotation[1] = normalizeDegrees(endRotation[1] + (preset === "pan_left" ? 45 : -45) * amountScale);
    } else {
      endRotation[0] = round(clamp(endRotation[0] + (preset === "tilt_up" ? 30 : -30) * amountScale, -89, 89));
    }
    return {
      ...basePatch,
      pathPoints: [
        makePoint(startTime, startPosition, { rotation: [...camera.rotation], easing }),
        makePoint(endTime, startPosition, { rotation: endRotation, easing }),
      ],
    };
  }

  if (preset === "zoom_in" || preset === "zoom_out") {
    const endFov = preset === "zoom_in"
      ? clamp(camera.fov * Math.pow(0.62, amountScale), 8, 110)
      : clamp(camera.fov * Math.pow(1.55, amountScale), 8, 110);
    return {
      ...basePatch,
      pathPoints: [
        makePoint(startTime, startPosition, { fov: camera.fov, easing }),
        makePoint(endTime, startPosition, { fov: round(endFov), easing }),
      ],
    };
  }

  let endPosition = startPosition;
  if (preset === "push_in") {
    endPosition = addScaled(startPosition, basis.forward, Math.max(0.6, basis.distance * 0.45) * amountScale);
  } else if (preset === "pull_out") {
    endPosition = addScaled(startPosition, basis.forward, -Math.max(1.2, basis.distance * 0.65) * amountScale);
  } else if (preset === "truck_left" || preset === "truck_right") {
    const distance = clamp(basis.distance * 0.75, 1.5, 6) * amountScale;
    endPosition = addScaled(startPosition, basis.right, preset === "truck_left" ? -distance : distance);
  } else if (preset === "crane_up" || preset === "crane_down") {
    endPosition = [
      startPosition[0],
      round(startPosition[1] + (preset === "crane_up" ? 2.2 : -2.2) * amountScale),
      startPosition[2],
    ];
  }

  if (preset === "dolly_zoom_in" || preset === "dolly_zoom_out") {
    const moveAmount = preset === "dolly_zoom_in"
      ? Math.max(0.6, basis.distance * 0.42) * amountScale
      : -Math.max(1.2, basis.distance * 0.6) * amountScale;
    endPosition = addScaled(startPosition, basis.forward, moveAmount);
    const endFov = preserveSubjectScale
      ? getDollyZoomFov(camera.fov, basis.distance, Math.max(0.2, basis.distance - moveAmount))
      : camera.fov;
    return {
      ...basePatch,
      pathPoints: [
        makePoint(startTime, startPosition, { fov: camera.fov, easing }),
        makePoint(endTime, endPosition, { fov: endFov, easing }),
      ],
    };
  }

  return {
    ...basePatch,
    pathPoints: [
      makePoint(startTime, startPosition, { easing }),
      makePoint(endTime, endPosition, { easing }),
    ],
  };
}

export function mergePresetPathPoints(
  existing: CameraPathPoint[],
  generated: CameraPathPoint[],
  startTime: number,
  endTime: number,
) {
  return [
    ...existing.filter((point) => point.time < startTime || point.time > endTime),
    ...generated,
  ].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}
