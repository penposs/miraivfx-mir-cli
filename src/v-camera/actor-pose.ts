import { VCAMERA_ENUMS, VCAMERA_LIMITS } from "./contract.js";
import { interpolatePathPosition, applySceneEasing } from "./path-interpolation.js";
import type { Actor, ActorPose, ActorPosePreset, ActorPosePresetParameters, SceneEasing, Vec3 } from "./project.js";

const round = (value: number) => Number(value.toFixed(3));
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function createNeutralActorPose(): ActorPose {
  return {
    rootOffset: [0, 0, 0],
    jointRotations: {},
    sourcePreset: "stand_neutral",
    presetParameters: { intensity: 1, mirror: false },
  };
}

function mirrorJointId(jointId: string) {
  if (jointId.endsWith("_l")) return `${jointId.slice(0, -2)}_r`;
  if (jointId.endsWith("_r")) return `${jointId.slice(0, -2)}_l`;
  return jointId;
}

export function resolveActorPosePreset(
  preset: ActorPosePreset,
  actorHeight: number,
  parameters: ActorPosePresetParameters = {},
): ActorPose {
  if (!(VCAMERA_ENUMS.actorPosePreset as readonly string[]).includes(preset)) throw new Error(`Unsupported pose preset: ${preset}`);
  const intensity = clamp(parameters.intensity ?? 1, VCAMERA_LIMITS.poseIntensity.minimum, VCAMERA_LIMITS.poseIntensity.maximum);
  const seatHeight = clamp(parameters.seatHeight ?? 0.45, VCAMERA_LIMITS.seatHeight.minimum, VCAMERA_LIMITS.seatHeight.maximum);
  let rootOffset: Vec3 = [0, 0, 0];
  let rotations: Record<string, Vec3> = {};
  if (preset === "stand_attention") rotations = { upper_arm_l: [0, 0, -3], upper_arm_r: [0, 0, 3], spine_upper: [-2, 0, 0] };
  else if (preset === "sit_neutral" || preset === "sit_hands_on_thighs") {
    rootOffset = [0, seatHeight - actorHeight * 0.53, 0];
    rotations = {
      upper_leg_l: [-88, 0, 3], upper_leg_r: [-88, 0, -3],
      lower_leg_l: [88, 0, 0], lower_leg_r: [88, 0, 0],
      foot_l: [0, 0, 0], foot_r: [0, 0, 0],
      ...(preset === "sit_hands_on_thighs" ? {
        upper_arm_l: [-42, 0, -12] as Vec3, upper_arm_r: [-42, 0, 12] as Vec3,
        lower_arm_l: [-48, 0, 0] as Vec3, lower_arm_r: [-48, 0, 0] as Vec3,
      } : {}),
    };
  } else if (preset === "bow") rotations = { spine_lower: [18, 0, 0], spine_upper: [34, 0, 0], neck: [-12, 0, 0] };
  else if (preset === "hand_on_chest") rotations = { upper_arm_r: [-38, 0, 28], lower_arm_r: [-82, 15, 0], hand_r: [0, 0, -12] };
  else if (preset === "raise_hand") rotations = { upper_arm_r: [0, 0, 154], lower_arm_r: [0, 0, -18], hand_r: [0, 0, -8] };
  else if (preset === "support_chin") rotations = { upper_arm_r: [-28, 0, 25], lower_arm_r: [-118, 8, 0], hand_r: [18, 0, -8], head: [8, -8, 0] };
  else if (preset === "kneel") {
    rootOffset = [0, -actorHeight * 0.22, 0];
    rotations = { upper_leg_l: [-34, 0, 2], upper_leg_r: [-34, 0, -2], lower_leg_l: [112, 0, 0], lower_leg_r: [112, 0, 0], spine_upper: [8, 0, 0] };
  } else if (preset === "crouch") {
    rootOffset = [0, -actorHeight * 0.18, 0];
    rotations = { upper_leg_l: [-58, 0, 4], upper_leg_r: [-58, 0, -4], lower_leg_l: [92, 0, 0], lower_leg_r: [92, 0, 0], spine_lower: [12, 0, 0], spine_upper: [10, 0, 0] };
  } else if (preset === "lie_supine" || preset === "lie_prone") {
    rootOffset = [0, -actorHeight * 0.47, 0];
    rotations = { pelvis: [preset === "lie_supine" ? -90 : 90, 0, 0], head: [preset === "lie_supine" ? 8 : -8, 0, 0] };
  }
  let resolved = Object.fromEntries(Object.entries(rotations).map(([joint, rotation]) => [
    joint,
    rotation.map((value) => round(value * intensity)) as Vec3,
  ]));
  if (parameters.mirror) {
    resolved = Object.fromEntries(Object.entries(resolved).map(([joint, rotation]) => [
      mirrorJointId(joint),
      [rotation[0], -rotation[1], -rotation[2]] as Vec3,
    ]));
  }
  return {
    rootOffset: rootOffset.map((value) => round(value * intensity)) as Vec3,
    jointRotations: resolved,
    sourcePreset: preset,
    presetParameters: { seatHeight, intensity, mirror: parameters.mirror === true },
  };
}

export function getActorTrackingPointApproximation(height: number, pose: ActorPose, point: "head" | "chest" | "center"): Vec3 {
  const pelvis = height * 0.53 + pose.rootOffset[1];
  const torsoPitch = (pose.jointRotations.pelvis?.[0] ?? 0) + (pose.jointRotations.spine_lower?.[0] ?? 0) + (pose.jointRotations.spine_upper?.[0] ?? 0);
  const torsoScale = Math.max(0.15, Math.cos((torsoPitch * Math.PI) / 180));
  const heightOffset = point === "head" ? height * 0.37 : point === "chest" ? height * 0.2 : height * 0.04;
  return [pose.rootOffset[0], round(pelvis + heightOffset * torsoScale), pose.rootOffset[2]];
}

type Quaternion = [number, number, number, number];

const degreesToRadians = (value: number) => (value * Math.PI) / 180;
const radiansToDegrees = (value: number) => (value * 180) / Math.PI;

function eulerXyzToQuaternion(rotation: Vec3): Quaternion {
  const x = degreesToRadians(rotation[0]) / 2;
  const y = degreesToRadians(rotation[1]) / 2;
  const z = degreesToRadians(rotation[2]) / 2;
  const cx = Math.cos(x); const sx = Math.sin(x);
  const cy = Math.cos(y); const sy = Math.sin(y);
  const cz = Math.cos(z); const sz = Math.sin(z);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

function slerpQuaternion(start: Quaternion, end: Quaternion, amount: number): Quaternion {
  let target = end;
  let cosine = start.reduce((sum, value, index) => sum + value * end[index], 0);
  if (cosine < 0) {
    cosine = -cosine;
    target = end.map((value) => -value) as Quaternion;
  }
  if (cosine > 0.9995) {
    const blended = start.map((value, index) => value + (target[index] - value) * amount) as Quaternion;
    const length = Math.hypot(...blended) || 1;
    return blended.map((value) => value / length) as Quaternion;
  }
  const angle = Math.acos(Math.min(1, Math.max(-1, cosine)));
  const sine = Math.sin(angle);
  const startWeight = Math.sin((1 - amount) * angle) / sine;
  const endWeight = Math.sin(amount * angle) / sine;
  return start.map((value, index) => value * startWeight + target[index] * endWeight) as Quaternion;
}

function quaternionToEulerXyz([x, y, z, w]: Quaternion): Vec3 {
  const clampValue = (value: number) => Math.min(1, Math.max(-1, value));
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const rotationY = Math.asin(clampValue(m13));
  const nearPole = Math.abs(m13) >= 0.9999999;
  return [
    round(radiansToDegrees(nearPole ? Math.atan2(m32, m22) : Math.atan2(-m23, m33))),
    round(radiansToDegrees(rotationY)),
    round(radiansToDegrees(nearPole ? 0 : Math.atan2(-m12, m11))),
  ];
}

function interpolatePose(start: ActorPose, end: ActorPose, amount: number): ActorPose {
  const progress = Math.min(1, Math.max(0, amount));
  const joints = new Set([...Object.keys(start.jointRotations), ...Object.keys(end.jointRotations)]);
  const jointRotations = Object.fromEntries([...joints].map((joint) => {
    const startRotation = start.jointRotations[joint as keyof typeof start.jointRotations] ?? [0, 0, 0];
    const endRotation = end.jointRotations[joint as keyof typeof end.jointRotations] ?? [0, 0, 0];
    return [joint, quaternionToEulerXyz(slerpQuaternion(
      eulerXyzToQuaternion(startRotation),
      eulerXyzToQuaternion(endRotation),
      progress,
    ))];
  }));
  return {
    rootOffset: ([0, 1, 2] as const).map((axis) => {
      const startValue = start.rootOffset[axis];
      const endValue = end.rootOffset[axis];
      return startValue === endValue ? startValue : round(startValue + (endValue - startValue) * progress);
    }) as Vec3,
    jointRotations,
    sourcePreset: progress >= 1 ? end.sourcePreset ?? null : null,
    ...(progress >= 1 && end.presetParameters ? { presetParameters: { ...end.presetParameters } } : {}),
  };
}

export function getActorPoseAtTime(
  actor: Pick<Actor, "pose" | "poseKeyframes">,
  time: number,
): ActorPose {
  const frames = [...actor.poseKeyframes].sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  if (!frames.length) return actor.pose;
  const timeline = frames[0].time > 0
    ? [{ id: "origin", time: 0, pose: actor.pose, easing: "smooth" as SceneEasing }, ...frames]
    : frames;
  if (time <= timeline[0].time) return timeline[0].pose;
  const last = timeline[timeline.length - 1];
  if (time >= last.time) return last.pose;
  for (let index = 0; index < timeline.length - 1; index += 1) {
    const start = timeline[index];
    const end = timeline[index + 1];
    if (time < start.time || time > end.time) continue;
    const normalized = (time - start.time) / (end.time - start.time);
    return interpolatePose(start.pose, end.pose, applySceneEasing(normalized, end.easing ?? start.easing ?? "smooth"));
  }
  return actor.pose;
}

export function getActorTrackingPointWorldApproximation(
  actor: Actor,
  time: number,
  point: "head" | "chest" | "center",
): Vec3 {
  const position = interpolatePathPosition(actor, time);
  const local = getActorTrackingPointApproximation(actor.height, getActorPoseAtTime(actor, time), point);
  const yaw = degreesToRadians(actor.rotation[1]);
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return [
    round(position[0] + local[0] * cosine + local[2] * sine),
    round(position[1] + local[1]),
    round(position[2] - local[0] * sine + local[2] * cosine),
  ];
}
