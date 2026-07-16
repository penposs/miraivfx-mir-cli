import type { Actor, Prop, VCameraProject, Vec3 } from "./project.js";

export interface SpatialBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
}

const round = (value: number) => Number(value.toFixed(3));

function rotatePointXYZ(point: Vec3, rotation: Vec3): Vec3 {
  const [xAngle, yAngle, zAngle] = rotation.map((value) => (value * Math.PI) / 180) as Vec3;
  const cx = Math.cos(xAngle);
  const sx = Math.sin(xAngle);
  const cy = Math.cos(yAngle);
  const sy = Math.sin(yAngle);
  const cz = Math.cos(zAngle);
  const sz = Math.sin(zAngle);
  const afterX: Vec3 = [point[0], point[1] * cx - point[2] * sx, point[1] * sx + point[2] * cx];
  const afterY: Vec3 = [afterX[0] * cy + afterX[2] * sy, afterX[1], -afterX[0] * sy + afterX[2] * cy];
  return [
    afterY[0] * cz - afterY[1] * sz,
    afterY[0] * sz + afterY[1] * cz,
    afterY[2],
  ];
}

function boundsFromLocalCorners(position: Vec3, rotation: Vec3, localMin: Vec3, localMax: Vec3): SpatialBounds {
  const corners: Vec3[] = [];
  for (const x of [localMin[0], localMax[0]]) {
    for (const y of [localMin[1], localMax[1]]) {
      for (const z of [localMin[2], localMax[2]]) {
        const rotated = rotatePointXYZ([x, y, z], rotation);
        corners.push([
          rotated[0] + position[0],
          rotated[1] + position[1],
          rotated[2] + position[2],
        ]);
      }
    }
  }
  const min = [0, 1, 2].map((axis) => round(Math.min(...corners.map((point) => point[axis])))) as Vec3;
  const max = [0, 1, 2].map((axis) => round(Math.max(...corners.map((point) => point[axis])))) as Vec3;
  return {
    min,
    max,
    center: [0, 1, 2].map((axis) => round((min[axis] + max[axis]) / 2)) as Vec3,
    size: [0, 1, 2].map((axis) => round(max[axis] - min[axis])) as Vec3,
  };
}

export function getPropBasePoseBounds(prop: Prop): SpatialBounds {
  return boundsFromLocalCorners(
    prop.position,
    prop.rotation,
    prop.scale.map((value) => -value / 2) as Vec3,
    prop.scale.map((value) => value / 2) as Vec3,
  );
}

export function getActorBasePoseBounds(actor: Actor): SpatialBounds {
  const halfWidth = actor.height * 0.23;
  const halfDepth = actor.height * 0.16;
  return boundsFromLocalCorners(
    actor.position,
    actor.rotation,
    [-halfWidth, 0, -halfDepth],
    [halfWidth, actor.height, halfDepth],
  );
}

function containsPoint(bounds: SpatialBounds, point: Vec3) {
  return point.every((value, axis) => value >= bounds.min[axis] && value <= bounds.max[axis]);
}

export function getProjectSpatialSummary(project: VCameraProject) {
  const entities = [
    ...project.actors.map((actor) => ({
      type: "actor" as const,
      id: actor.id,
      name: actor.name,
      anchor: "feet" as const,
      bounds: getActorBasePoseBounds(actor),
    })),
    ...project.cubes.map((prop) => ({
      type: "prop" as const,
      id: prop.id,
      name: prop.name,
      anchor: "geometry_center" as const,
      bounds: getPropBasePoseBounds(prop),
    })),
  ];
  const cameraIntersections = project.cameras.flatMap((camera) => {
    const intersected = entities.filter((entity) => containsPoint(entity.bounds, camera.position));
    return intersected.map((entity) => ({
      cameraId: camera.id,
      cameraName: camera.name,
      entityType: entity.type,
      entityId: entity.id,
      entityName: entity.name,
      severity: "obvious_base_pose_intersection" as const,
    }));
  });
  return {
    scope: "base_pose_proxy_bounds",
    exactPhysics: false,
    entities,
    cameraIntersections,
  };
}
