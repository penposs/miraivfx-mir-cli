import { interpolatePathPosition, applyScenePathProgress } from './path-interpolation.js';
import type { Prop, Vec3, VCameraProject } from './project.js';

export type SceneIssue = {
  code: string; severity: 'warning'; entityId: string; otherId?: string;
  startTime: number; endTime: number; position: Vec3; message: string;
};
const round = (n: number) => Number(n.toFixed(3));
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));

function propRotation(prop: Prop, time: number): Vec3 {
  const points = [...prop.pathPoints].sort((a, b) => a.time - b.time);
  if (!points.length) return prop.rotation;
  if (points[0].time > 0) points.unshift({ id: 'origin', time: 0, position: prop.position, rotation: prop.rotation });
  let previous = prop.rotation;
  const resolved = points.map((point) => { previous = point.rotation ?? previous; return { ...point, rotation: previous }; });
  if (time <= resolved[0].time) return resolved[0].rotation;
  for (let i = 1; i < resolved.length; i++) {
    const a = resolved[i - 1], b = resolved[i];
    if (time > b.time) continue;
    const amount = applyScenePathProgress((time - a.time) / (b.time - a.time), b.easing ?? a.easing);
    return a.rotation.map((v, axis) => v + (((b.rotation[axis] - v + 180) % 360 + 360) % 360 - 180) * amount) as Vec3;
  }
  return resolved.at(-1)!.rotation;
}

function inverseRotate(point: Vec3, rotation: Vec3): Vec3 {
  let [x, y, z] = point;
  // Invert THREE.Euler's intrinsic XYZ matrix (Rx * Ry * Rz).
  const [rx, ry, rz] = rotation.map((value) => -value * Math.PI / 180);
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x, y, z];
}

function parts(prop: Prop): Array<{ center: Vec3; size: Vec3 }> {
  if (prop.propPreset === 'door_frame') return [
    { center: [-0.43, 0, 0], size: [0.14, 1, 1] },
    { center: [0.43, 0, 0], size: [0.14, 1, 1] },
    { center: [0, 0.43, 0], size: [1, 0.14, 1] },
  ];
  if (prop.propPreset === 'stairs') {
    const count = prop.stepCount ?? 5;
    return Array.from({ length: count }, (_, index) => {
      const height = (index + 1) / count;
      return { center: [0, -0.5 + height / 2, -0.5 + (index + 0.5) / count] as Vec3, size: [1, height, 1 / count] as Vec3 };
    });
  }
  return [{ center: [0, 0, 0], size: [1, 1, 1] }];
}

function visible(prop: Prop, time: number) {
  let value = prop.visible;
  for (const frame of [...(prop.visibilityKeyframes ?? [])].sort((a, b) => a.time - b.time)) {
    if (frame.time > time) break;
    value = frame.visible;
  }
  return value;
}

function sphereTouches(point: Vec3, radius: number, prop: Prop, position: Vec3, rotation: Vec3) {
  const local = inverseRotate(point.map((value, axis) => value - position[axis]) as Vec3, rotation);
  return parts(prop).some((part) => {
    const closest = local.map((value, axis) => {
      const center = part.center[axis] * prop.scale[axis];
      const half = part.size[axis] * prop.scale[axis] / 2;
      return Math.min(center + half, Math.max(center - half, value));
    }) as Vec3;
    return distance(local, closest) < Math.max(0, radius - 0.005);
  });
}

export function validateSceneMotion(project: VCameraProject, step = 0.1) {
  if (!Number.isFinite(step) || step < 1 / 120 || step > 10) throw new Error('Validation --step must be between 1/120 and 10 seconds');
  const count = Math.ceil(project.duration / step) + 1;
  const complexity = count * (project.cubes.length * (project.actors.length * 3 + project.cameras.length) + project.actors.length ** 2);
  if (count > 20000 || complexity > 15_000_000) throw new Error('Scene validation budget exceeded; increase --step or validate a smaller scene');
  const issues: SceneIssue[] = [];
  const open = new Map<string, SceneIssue>();
  let truncated = false;
  const report = (code: string, entityId: string, time: number, position: Vec3, message: string, otherId?: string) => {
    const key = `${code}:${entityId}:${otherId ?? ''}`;
    const previous = open.get(key);
    if (previous && time - previous.endTime <= step * 1.1) { previous.endTime = round(time); return; }
    if (issues.length >= 500) { truncated = true; return; }
    const issue: SceneIssue = { code, severity: 'warning', entityId, otherId, startTime: round(time), endTime: round(time), position: position.map(round) as Vec3, message };
    open.set(key, issue); issues.push(issue);
  };
  const ignoredCameras = project.cameras.filter((camera) => camera.movementMode === 'follow').map((camera) => camera.id);
  for (let index = 0; index < count; index++) {
    const time = Math.min(project.duration, index * step);
    const props = project.cubes.filter((prop) => visible(prop, time)).map((prop) => ({ prop, position: interpolatePathPosition(prop, time), rotation: propRotation(prop, time) }));
    const actors = project.actors.map((actor) => ({ actor, position: interpolatePathPosition(actor, time) }));
    for (const { actor, position } of actors) {
      const radius = Math.min(0.25, actor.height * 0.12);
      for (const obstacle of props) {
        if ([0.2, 0.5, 0.85].some((fraction) => sphereTouches([position[0], position[1] + actor.height * fraction, position[2]], radius, obstacle.prop, obstacle.position, obstacle.rotation))) {
          report('actor_prop_intersection', actor.id, time, position, 'Standing-body proxy intersects a prop; inspect poses and rendered frames.', obstacle.prop.id);
        }
      }
      if (index > 0) {
        const priorTime = Math.max(0, time - step);
        const speed = distance(position, interpolatePathPosition(actor, priorTime)) / Math.max(0.0001, time - priorTime);
        if (speed > 4) report('actor_high_speed', actor.id, time, position, `Travel speed ${speed.toFixed(2)} m/s exceeds 4 m/s; check scene scale and timing.`);
      }
    }
    for (let a = 0; a < actors.length; a++) for (let b = a + 1; b < actors.length; b++) {
      const first = actors[a], second = actors[b];
      if (Math.abs(first.position[1] - second.position[1]) < Math.min(first.actor.height, second.actor.height)
        && Math.hypot(first.position[0] - second.position[0], first.position[2] - second.position[2]) < (first.actor.height + second.actor.height) * 0.1) {
        report('actor_overlap', first.actor.id, time, first.position, 'Actor footprint proxies overlap.', second.actor.id);
      }
    }
    for (const camera of project.cameras) {
      if (camera.movementMode === 'follow') continue;
      const position = camera.movementMode === 'path' ? interpolatePathPosition(camera, time) : camera.position;
      for (const obstacle of props) {
        if (sphereTouches(position, 0.08, obstacle.prop, obstacle.position, obstacle.rotation)) report('camera_prop_intersection', camera.id, time, position, 'Camera clearance proxy intersects a prop.', obstacle.prop.id);
      }
    }
  }
  return {
    schemaValid: true, passed: issues.length === 0, scope: 'sampled_proxy_geometry', step, samples: count, issues, truncated,
    limitations: [
      'Sampling may miss intersections between sample times; this is not a continuous physics solver.',
      'Actor checks use standing-body proxies, not animated skeletons. Seated and lying poses need rendered inspection.',
      'Slopes and cylinders use conservative boxes. Ground support, shot visibility and story semantics are not validated.',
      ...(ignoredCameras.length ? [`Follow camera collision checks skipped: ${ignoredCameras.join(', ')}. Use scene sample/capture for runtime poses.`] : []),
    ],
  };
}
