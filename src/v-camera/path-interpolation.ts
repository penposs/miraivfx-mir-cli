import type { SceneEasing, ScenePathPoint, Vec3 } from "./project.js";

export const DEFAULT_SCENE_PATH_EASING: SceneEasing = "smooth";

const clampUnit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export function applySceneEasing(amount: number, easing?: SceneEasing) {
  const value = clampUnit(amount);
  if (easing === "linear") return value;
  if (easing === "ease_in") return value * value;
  if (easing === "ease_out") return 1 - (1 - value) * (1 - value);
  if (easing === "ease_in_out") return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
  return value * value * (3 - 2 * value);
}

export function interpolatePathSegmentPosition(
  start: Pick<ScenePathPoint, "position">,
  end: Pick<ScenePathPoint, "position">,
  amount: number,
): Vec3 {
  const progress = clampUnit(amount);
  return ([0, 1, 2] as const).map((axis) => {
    const startValue = start.position[axis];
    const endValue = end.position[axis];
    if (startValue === endValue || progress <= 0) return startValue;
    if (progress >= 1) return endValue;
    return startValue + (endValue - startValue) * progress;
  }) as Vec3;
}

export function interpolatePathPosition<T extends ScenePathPoint>(
  target: { position: Vec3; pathPoints: T[] },
  time: number,
): Vec3 {
  const points = [...target.pathPoints].sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  if (points.length === 0) return [...target.position];
  const timeline = points[0].time > 0
    ? [{ id: "origin", time: 0, position: [...target.position] as Vec3 } as T, ...points]
    : points;
  if (time <= timeline[0].time) return [...timeline[0].position];
  const last = timeline[timeline.length - 1];
  if (time >= last.time) return [...last.position];
  for (let index = 0; index < timeline.length - 1; index += 1) {
    const start = timeline[index];
    const end = timeline[index + 1];
    if (time < start.time || time > end.time) continue;
    const normalizedTime = (time - start.time) / (end.time - start.time);
    return interpolatePathSegmentPosition(
      start,
      end,
      applySceneEasing(normalizedTime, end.easing ?? start.easing ?? DEFAULT_SCENE_PATH_EASING),
    );
  }
  return [...target.position];
}
