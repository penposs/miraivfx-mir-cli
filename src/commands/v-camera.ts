import { randomUUID } from "node:crypto";
import { ApiClient } from "../api/client.js";
import { getFlagValue, hasFlag } from "../core/args.js";
import { json, text } from "../core/output.js";
import {
  VCAMERA_DEFAULTS,
  VCAMERA_ENUMS,
  VCAMERA_LIMITS,
} from "../v-camera/contract.js";
import {
  Actor,
  Camera,
  CameraShot,
  cameraOffsetInActorSpace,
  CameraTrackingPoint,
  clone,
  defaultVCameraProject,
  isMotionPreset,
  isRecord,
  normalizeProject,
  parseCameraPathPoints,
  parsePathPoints,
  parsePropPathPoints,
  parseVec3,
  PathPoint,
  PROP_DEFAULTS,
  Prop,
  PropPreset,
  resolveByIdOrName,
  SafeFrameRatio,
  SceneEasing,
  SCENE_EASINGS,
  VCameraProject,
  Vec3,
} from "../v-camera/project.js";
import { createCameraPresetPatch, mergePresetPathPoints } from "../v-camera/camera-presets.js";
import { getProjectSpatialSummary } from "../v-camera/spatial.js";

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
  "version" | "name" | "fps" | "duration" | "safeFrameRatio" |
  "cubes" | "actors" | "cameras" | "cameraCuts" | "shots" | "activeCameraId"
>>;

interface MutationResult {
  patch: ProjectPatch;
  operation: string;
  entityId?: string;
  warnings?: string[];
  sideEffects?: string[];
}

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
  if (["path", "action", "visibility"].includes(rawAction)) {
    action = `path-${tail[0] ?? ""}`;
    if (rawAction !== "path") action = `${rawAction}-${tail[0] ?? ""}`;
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
      warnings: mutation.warnings ?? [],
      side_effects: mutation.sideEffects ?? [],
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
    warnings: mutation.warnings ?? [],
    side_effects: mutation.sideEffects ?? [],
    url,
  };
  asJson ? json(payload) : text(`Updated ${mutation.operation} on V-camera node ${response.data.node_id}`);
}

function mutateProject(
  project: VCameraProject,
  subject: string,
  action: string,
  args: string[],
): MutationResult {
  if (subject === "project" && action === "set") return mutateProjectSettings(project, args);
  if (subject === "actor") return mutateActor(project, action, args);
  if (subject === "prop" || subject === "object") return mutateProp(project, action, args);
  if (subject === "camera") return mutateCamera(project, action, args);
  if (subject === "shot") return mutateShot(project, action, args);
  if (subject === "cut") return mutateCut(project, action, args);
  throw new Error(`Unsupported V-camera command: ${subject} ${action}`);
}

function mutateProjectSettings(project: VCameraProject, args: string[]) {
  const patch: ProjectPatch = {};
  const name = getFlagValue(args, "--name");
  const fps = optionalNumber(args, "--fps", VCAMERA_LIMITS.fps.minimum, VCAMERA_LIMITS.fps.maximum);
  const duration = optionalNumber(args, "--duration", VCAMERA_LIMITS.positiveSceneTime.minimum, VCAMERA_LIMITS.positiveSceneTime.maximum);
  const safeFrame = getFlagValue(args, "--safe-frame");
  const activeCameraSelector = getFlagValue(args, "--active-camera");
  const clearActiveCamera = hasFlag(args, "--clear-active-camera");
  if (activeCameraSelector && clearActiveCamera) throw new Error("Use either --active-camera or --clear-active-camera");
  if (name !== undefined) patch.name = requireText(name, "--name");
  if (fps !== undefined) patch.fps = fps;
  if (duration !== undefined) patch.duration = duration;
  if (safeFrame !== undefined) {
    if (!["off", "9:16", "16:9", "1:1"].includes(safeFrame)) throw new Error("Invalid --safe-frame");
    patch.safeFrameRatio = safeFrame as SafeFrameRatio;
  }
  if (activeCameraSelector) patch.activeCameraId = resolveByIdOrName(project.cameras, activeCameraSelector, "Camera").id;
  if (clearActiveCamera) patch.activeCameraId = null;
  if (!Object.keys(patch).length) throw new Error("No project fields provided");
  return {
    patch,
    operation: "project.set",
    ...(duration !== undefined
      ? { warnings: ["project.duration is derived from authored global scene time and may be normalized by the server."] }
      : {}),
  };
}

function mutateActor(project: VCameraProject, action: string, args: string[]) {
  const actors = clone(project.actors);
  if (action === "add") {
    ensureCollectionCapacity(actors, VCAMERA_LIMITS.collections.actors, "actors");
    const id = getFlagValue(args, "--id") ?? `actor_${randomUUID()}`;
    const actor: Actor = {
      id,
      name: getFlagValue(args, "--name") ?? nextNumericName(actors),
      position: parseVec3(getFlagValue(args, "--position"), "--position") ?? [...VCAMERA_DEFAULTS.actor.position] as Vec3,
      rotation: parseRotationVec3(getFlagValue(args, "--rotation"), "--rotation") ?? [...VCAMERA_DEFAULTS.actor.rotation] as Vec3,
      height: optionalNumber(args, "--height", VCAMERA_LIMITS.actorHeight.minimum, VCAMERA_LIMITS.actorHeight.maximum) ?? VCAMERA_DEFAULTS.actor.height,
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
    const rotation = parseRotationVec3(getFlagValue(args, "--rotation"), "--rotation");
    const height = optionalNumber(args, "--height", VCAMERA_LIMITS.actorHeight.minimum, VCAMERA_LIMITS.actorHeight.maximum);
    const lookAtActorSelector = getFlagValue(args, "--look-at-actor");
    const lookAtPoint = parseVec3(getFlagValue(args, "--look-at-point"), "--look-at-point");
    const clearLookAt = hasFlag(args, "--clear-look-at");
    const clearLookAtActor = hasFlag(args, "--clear-look-at-actor");
    const clearLookAtPoint = hasFlag(args, "--clear-look-at-point");
    const syncOrigin = hasFlag(args, "--sync-origin");
    const lookAtActor = lookAtActorSelector
      ? resolveByIdOrName(actors, lookAtActorSelector, "Actor")
      : undefined;
    if (lookAtActor?.id === actor.id) throw new Error("--look-at-actor cannot reference the same actor");
    if (syncOrigin && position === undefined) throw new Error("--sync-origin requires --position");
    if (name === undefined && position === undefined && rotation === undefined && height === undefined && !lookAtActor && !lookAtPoint && !clearLookAt && !clearLookAtActor && !clearLookAtPoint) {
      throw new Error("No actor fields provided");
    }
    actors[index] = {
      ...actor,
      ...(name !== undefined ? { name: requireText(name, "--name") } : {}),
      ...(position ? setOwnerPosition(actor, position, syncOrigin) : {}),
      ...(rotation ? { rotation } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(lookAtActor ? { lookAtActorId: lookAtActor.id } : {}),
      ...(lookAtPoint ? { lookAtPoint } : {}),
      ...(clearLookAtActor ? { lookAtActorId: null } : {}),
      ...(clearLookAtPoint ? { lookAtPoint: null } : {}),
      ...(clearLookAt ? { lookAtActorId: null, lookAtPoint: null } : {}),
    };
    return {
      patch: { actors },
      operation: "actor.set",
      entityId: actor.id,
      ...(syncOrigin ? { sideEffects: ["Synchronized every zero-time actor path point to the new base position."] } : {}),
    };
  }
  if (action === "translate") {
    const delta = parseVec3(getFlagValue(args, "--delta"), "--delta");
    if (!delta) throw new Error("--delta is required");
    actors[index] = translateOwnerAndPath(actor, delta);
    return {
      patch: { actors },
      operation: "actor.translate",
      entityId: actor.id,
      sideEffects: ["Translated actor.position and every actor.pathPoints[].position by --delta."],
    };
  }
  if (action === "delete") {
    const cameras = project.cameras.map((camera) => camera.trackingActorId === actor.id
      ? { ...camera, movementMode: camera.movementMode === "follow" ? "static" as const : camera.movementMode, aimMode: "manual" as const, trackingActorId: null, motionPreset: null }
      : camera);
    const remainingActors = actors.filter((item) => item.id !== actor.id).map((item) => ({
      ...item,
      ...(item.lookAtActorId === actor.id ? { lookAtActorId: null } : {}),
      actionMarkers: (item.actionMarkers ?? []).map((marker) => marker.targetActorId === actor.id
        ? { ...marker, targetActorId: undefined }
        : marker),
    }));
    return {
      patch: {
        actors: remainingActors,
        cameras,
        cameraCuts: project.cameraCuts.filter((cut) => cut.anchor?.actorId !== actor.id),
      },
      operation: "actor.delete",
      entityId: actor.id,
      sideEffects: [
        "Cleared references to the deleted actor from other actors and action markers.",
        "Removed camera cuts anchored to the deleted actor.",
        "Reset cameras that tracked the deleted actor using the Virtual Shoot actor-deletion rules.",
      ],
    };
  }
  if (action === "action-add") {
    const markerId = getFlagValue(args, "--id") ?? `action_${randomUUID()}`;
    const markers = clone(actor.actionMarkers ?? []);
    ensureCollectionCapacity(markers, VCAMERA_LIMITS.collections.actionMarkersPerActor, "actor action markers");
    ensureUniqueId(markers, markerId, "Action marker");
    const targetActorSelector = getFlagValue(args, "--target-actor");
    const targetActor = targetActorSelector ? resolveByIdOrName(actors, targetActorSelector, "Actor") : undefined;
    const targetPoint = parseVec3(getFlagValue(args, "--target-point"), "--target-point");
    markers.push({
      id: markerId,
      time: requiredNumber(args, "--time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum),
      action: requireText(requireFlag(args, "--action"), "--action"),
      ...(targetActor ? { targetActorId: targetActor.id } : {}),
      ...(targetPoint ? { targetPoint } : {}),
    });
    actors[index] = { ...actor, actionMarkers: markers.sort((a, b) => a.time - b.time) };
    const markerTime = markers.find((marker) => marker.id === markerId)?.time ?? 0;
    return { patch: { actors, ...(markerTime > project.duration ? { duration: markerTime } : {}) }, operation: "actor.action.add", entityId: markerId };
  }
  if (action === "action-set") {
    const markerId = requireFlag(args, "--marker");
    const markers = clone(actor.actionMarkers ?? []);
    const markerIndex = markers.findIndex((marker) => marker.id === markerId);
    if (markerIndex < 0) throw new Error(`Action marker not found: ${markerId}`);
    const time = optionalNumber(args, "--time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
    const markerAction = getFlagValue(args, "--action");
    const targetActorSelector = getFlagValue(args, "--target-actor");
    const targetActor = targetActorSelector ? resolveByIdOrName(actors, targetActorSelector, "Actor") : undefined;
    const targetPoint = parseVec3(getFlagValue(args, "--target-point"), "--target-point");
    const clearTargetActor = hasFlag(args, "--clear-target-actor");
    const clearTargetPoint = hasFlag(args, "--clear-target-point");
    const clearTargets = hasFlag(args, "--clear-targets");
    if (targetActor && (clearTargetActor || clearTargets)) throw new Error("Use either --target-actor or a target clear flag");
    if (targetPoint && (clearTargetPoint || clearTargets)) throw new Error("Use either --target-point or a target clear flag");
    if ([time, markerAction, targetActor, targetPoint].every((value) => value === undefined)
      && !clearTargetActor && !clearTargetPoint && !clearTargets) {
      throw new Error("No action marker fields provided");
    }
    let updatedMarker = {
      ...markers[markerIndex],
      ...(time !== undefined ? { time } : {}),
      ...(markerAction !== undefined ? { action: requireText(markerAction, "--action") } : {}),
      ...(targetActor ? { targetActorId: targetActor.id } : {}),
      ...(targetPoint ? { targetPoint } : {}),
    };
    if (clearTargetActor || clearTargets) {
      const { targetActorId: _targetActorId, ...rest } = updatedMarker;
      updatedMarker = rest;
    }
    if (clearTargetPoint || clearTargets) {
      const { targetPoint: _targetPoint, ...rest } = updatedMarker;
      updatedMarker = rest;
    }
    markers[markerIndex] = updatedMarker;
    markers.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    actors[index] = { ...actor, actionMarkers: markers };
    const markerTime = updatedMarker.time;
    return {
      patch: { actors, ...(markerTime > project.duration ? { duration: markerTime } : {}) },
      operation: "actor.action.set",
      entityId: markerId,
    };
  }
  if (action === "action-delete") {
    const markerId = requireFlag(args, "--marker");
    if (!(actor.actionMarkers ?? []).some((marker) => marker.id === markerId)) throw new Error(`Action marker not found: ${markerId}`);
    actors[index] = { ...actor, actionMarkers: (actor.actionMarkers ?? []).filter((marker) => marker.id !== markerId) };
    return { patch: { actors }, operation: "actor.action.delete", entityId: markerId };
  }
  if (action === "action-clear") {
    actors[index] = { ...actor, actionMarkers: [] };
    return { patch: { actors }, operation: "actor.action.clear", entityId: actor.id };
  }
  return mutatePath(project, "actor", actor, actors, index, action, args);
}

function mutateProp(project: VCameraProject, action: string, args: string[]) {
  const props = clone(project.cubes);
  if (action === "add") {
    ensureCollectionCapacity(props, VCAMERA_LIMITS.collections.props, "props");
    const assetId = getFlagValue(args, "--asset-id");
    const sourceTypeValue = getFlagValue(args, "--source-type");
    if (sourceTypeValue !== undefined && !(VCAMERA_ENUMS.sourceType as readonly string[]).includes(sourceTypeValue)) {
      throw new Error("--source-type must be primitive or asset");
    }
    const sourceType = (sourceTypeValue ?? (assetId ? "asset" : "primitive")) as Prop["sourceType"];
    if (sourceType === "asset" && !assetId) throw new Error("--asset-id is required when --source-type is asset");
    const presetValue = getFlagValue(args, "--preset") ?? (sourceType === "primitive" ? "box" : undefined);
    if (presetValue !== undefined && !(presetValue in PROP_DEFAULTS)) throw new Error("Invalid --preset");
    const preset = presetValue as PropPreset | undefined;
    const defaults = preset ? PROP_DEFAULTS[preset] : undefined;
    const scale = parseScaleVec3(getFlagValue(args, "--scale"), "--scale")
      ?? (sourceType === "asset" ? [...VCAMERA_DEFAULTS.assetProp.scale] as Vec3 : [...(defaults as { scale: Vec3 }).scale] as Vec3);
    const id = getFlagValue(args, "--id") ?? `cube_${randomUUID()}`;
    ensureUniqueId(props, id, "Prop");
    const prop: Prop = {
      id,
      name: getFlagValue(args, "--name") ?? `${defaults?.name ?? "Asset"} ${props.length + 1}`,
      position: parseVec3(getFlagValue(args, "--position"), "--position")
        ?? (sourceType === "asset" ? [...VCAMERA_DEFAULTS.assetProp.position] as Vec3 : [0, scale[1] / 2, 0]),
      rotation: parseRotationVec3(getFlagValue(args, "--rotation"), "--rotation") ?? [0, 0, 0],
      scale,
      visible: true,
      locked: false,
      sourceType,
      ...(assetId ? { assetId: requireText(assetId, "--asset-id") } : {}),
      ...(preset ? { propPreset: preset } : {}),
      ...(getFlagValue(args, "--steps") !== undefined || preset === "stairs"
        ? { stepCount: optionalInteger(args, "--steps", VCAMERA_LIMITS.stepCount.minimum, VCAMERA_LIMITS.stepCount.maximum) ?? VCAMERA_DEFAULTS.stairsStepCount }
        : {}),
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
    const rotation = parseRotationVec3(getFlagValue(args, "--rotation"), "--rotation");
    const scale = parseScaleVec3(getFlagValue(args, "--scale"), "--scale");
    const visible = optionalBoolean(args, "--visible");
    const locked = optionalBoolean(args, "--locked");
    const steps = optionalInteger(args, "--steps", VCAMERA_LIMITS.stepCount.minimum, VCAMERA_LIMITS.stepCount.maximum);
    const presetValue = getFlagValue(args, "--preset");
    if (presetValue !== undefined && !(presetValue in PROP_DEFAULTS)) throw new Error("Invalid --preset");
    const sourceTypeValue = getFlagValue(args, "--source-type");
    if (sourceTypeValue !== undefined && !["primitive", "asset"].includes(sourceTypeValue)) {
      throw new Error("--source-type must be primitive or asset");
    }
    const assetId = getFlagValue(args, "--asset-id");
    const clearAsset = hasFlag(args, "--clear-asset");
    const clearPreset = hasFlag(args, "--clear-preset");
    const clearSteps = hasFlag(args, "--clear-steps");
    const syncOrigin = hasFlag(args, "--sync-origin");
    if (assetId && clearAsset) throw new Error("Use either --asset-id or --clear-asset");
    if (presetValue && clearPreset) throw new Error("Use either --preset or --clear-preset");
    if (steps !== undefined && clearSteps) throw new Error("Use either --steps or --clear-steps");
    if (syncOrigin && position === undefined) throw new Error("--sync-origin requires --position");
    if ([name, position, rotation, scale, visible, locked, steps, presetValue, sourceTypeValue, assetId].every((value) => value === undefined)
      && !clearAsset && !clearPreset && !clearSteps) {
      throw new Error("No prop fields provided");
    }
    let nextProp: Prop = {
      ...prop,
      ...(name !== undefined ? { name: requireText(name, "--name") } : {}),
      ...(position ? setOwnerPosition(prop, position, syncOrigin) : {}),
      ...(rotation ? { rotation } : {}),
      ...(scale ? { scale } : {}),
      ...(visible !== undefined ? { visible } : {}),
      ...(locked !== undefined ? { locked } : {}),
      ...(steps !== undefined ? { stepCount: steps } : {}),
      ...(presetValue !== undefined ? { propPreset: presetValue as PropPreset } : {}),
      ...(sourceTypeValue !== undefined ? { sourceType: sourceTypeValue as Prop["sourceType"] } : {}),
      ...(assetId !== undefined ? { assetId: requireText(assetId, "--asset-id") } : {}),
    };
    if (clearAsset) {
      const { assetId: _assetId, ...withoutAsset } = nextProp;
      nextProp = withoutAsset;
    }
    if (clearPreset) {
      const { propPreset: _propPreset, ...withoutPreset } = nextProp;
      nextProp = withoutPreset;
    }
    if (clearSteps) {
      const { stepCount: _stepCount, ...withoutSteps } = nextProp;
      nextProp = withoutSteps;
    }
    if (nextProp.sourceType === "asset" && !nextProp.assetId) {
      throw new Error("--asset-id is required when --source-type is asset");
    }
    props[index] = nextProp;
    return {
      patch: { cubes: props },
      operation: "prop.set",
      entityId: prop.id,
      ...(syncOrigin ? { sideEffects: ["Synchronized every zero-time prop path point to the new base position."] } : {}),
    };
  }
  if (action === "translate") {
    const delta = parseVec3(getFlagValue(args, "--delta"), "--delta");
    if (!delta) throw new Error("--delta is required");
    props[index] = translateOwnerAndPath(prop, delta);
    return {
      patch: { cubes: props },
      operation: "prop.translate",
      entityId: prop.id,
      sideEffects: ["Translated prop.position and every prop.pathPoints[].position by --delta."],
    };
  }
  if (action === "delete") {
    return { patch: { cubes: props.filter((item) => item.id !== prop.id) }, operation: "prop.delete", entityId: prop.id };
  }
  if (action === "visibility-add") {
    const keyframeId = getFlagValue(args, "--id") ?? `visibility_${randomUUID()}`;
    const keyframes = clone(prop.visibilityKeyframes ?? []);
    ensureCollectionCapacity(keyframes, VCAMERA_LIMITS.collections.visibilityKeyframesPerProp, "prop visibility keyframes");
    ensureUniqueId(keyframes, keyframeId, "Visibility keyframe");
    const time = requiredNumber(args, "--time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
    const visible = optionalBoolean(args, "--visible");
    if (visible === undefined) throw new Error("--visible is required");
    keyframes.push({ id: keyframeId, time, visible });
    props[index] = { ...prop, visibilityKeyframes: keyframes.sort((a, b) => a.time - b.time) };
    return { patch: { cubes: props, ...(time > project.duration ? { duration: time } : {}) }, operation: "prop.visibility.add", entityId: keyframeId };
  }
  if (action === "visibility-set") {
    const keyframeId = requireFlag(args, "--keyframe");
    const keyframes = clone(prop.visibilityKeyframes ?? []);
    const keyframeIndex = keyframes.findIndex((keyframe) => keyframe.id === keyframeId);
    if (keyframeIndex < 0) throw new Error(`Visibility keyframe not found: ${keyframeId}`);
    const time = optionalNumber(args, "--time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
    const visible = optionalBoolean(args, "--visible");
    if (time === undefined && visible === undefined) throw new Error("No visibility keyframe fields provided");
    keyframes[keyframeIndex] = {
      ...keyframes[keyframeIndex],
      ...(time !== undefined ? { time } : {}),
      ...(visible !== undefined ? { visible } : {}),
    };
    keyframes.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    props[index] = { ...prop, visibilityKeyframes: keyframes };
    const keyframeTime = keyframes.find((keyframe) => keyframe.id === keyframeId)?.time ?? 0;
    return {
      patch: { cubes: props, ...(keyframeTime > project.duration ? { duration: keyframeTime } : {}) },
      operation: "prop.visibility.set",
      entityId: keyframeId,
    };
  }
  if (action === "visibility-delete") {
    const keyframeId = requireFlag(args, "--keyframe");
    if (!(prop.visibilityKeyframes ?? []).some((keyframe) => keyframe.id === keyframeId)) throw new Error(`Visibility keyframe not found: ${keyframeId}`);
    props[index] = { ...prop, visibilityKeyframes: (prop.visibilityKeyframes ?? []).filter((keyframe) => keyframe.id !== keyframeId) };
    return { patch: { cubes: props }, operation: "prop.visibility.delete", entityId: keyframeId };
  }
  if (action === "visibility-clear") {
    props[index] = { ...prop, visibilityKeyframes: [] };
    return { patch: { cubes: props }, operation: "prop.visibility.clear", entityId: prop.id };
  }
  return mutatePath(project, "prop", prop, props, index, action, args);
}

function mutateCamera(project: VCameraProject, action: string, args: string[]) {
  const cameras = clone(project.cameras);
  if (action === "add") {
    ensureCollectionCapacity(cameras, VCAMERA_LIMITS.collections.cameras, "cameras");
    const id = getFlagValue(args, "--id") ?? `camera_${randomUUID()}`;
    ensureUniqueId(cameras, id, "Camera");
    const camera: Camera = {
      id,
      name: getFlagValue(args, "--name") ?? `Camera ${cameras.length + 1}`,
      position: parseVec3(getFlagValue(args, "--position"), "--position") ?? [...VCAMERA_DEFAULTS.camera.position] as Vec3,
      rotation: parseRotationVec3(getFlagValue(args, "--rotation"), "--rotation") ?? [...VCAMERA_DEFAULTS.camera.rotation] as Vec3,
      fov: optionalNumber(args, "--fov", VCAMERA_LIMITS.fov.minimum, VCAMERA_LIMITS.fov.maximum) ?? VCAMERA_DEFAULTS.camera.fov,
      focusDistance: optionalNumber(args, "--focus-distance", VCAMERA_LIMITS.focusDistance.minimum, VCAMERA_LIMITS.focusDistance.maximum) ?? VCAMERA_DEFAULTS.camera.focusDistance,
      duration: optionalNumber(args, "--duration", VCAMERA_LIMITS.positiveSceneTime.minimum, VCAMERA_LIMITS.positiveSceneTime.maximum) ?? VCAMERA_DEFAULTS.camera.duration,
      pathPoints: [],
      movementMode: "static",
      aimMode: "manual",
      trackingActorId: null,
      trackingPoint: VCAMERA_DEFAULTS.camera.trackingPoint,
      followOffset: [...VCAMERA_DEFAULTS.camera.followOffset] as Vec3,
      followSpeed: VCAMERA_DEFAULTS.camera.followSpeed,
      motionPreset: null,
    };
    return {
      patch: { cameras: [...cameras, camera], activeCameraId: project.activeCameraId ?? id },
      operation: "camera.add",
      entityId: id,
      ...(project.activeCameraId === null
        ? { sideEffects: ["Set activeCameraId to the new camera because no active camera existed."] }
        : {}),
    };
  }

  const selector = requireFlag(args, "--camera");
  const camera = resolveByIdOrName(cameras, selector, "Camera");
  const index = cameras.findIndex((item) => item.id === camera.id);
  if (action === "preset") {
    const presetValue = requireFlag(args, "--preset");
    if (!isMotionPreset(presetValue)) throw new Error("Invalid --preset");
    const startTime = optionalNumber(
      args,
      "--start-time",
      VCAMERA_LIMITS.sceneTime.minimum,
      VCAMERA_LIMITS.sceneTime.maximum,
    ) ?? 0;
    const duration = requiredNumber(
      args,
      "--duration",
      VCAMERA_LIMITS.positiveSceneTime.minimum,
      VCAMERA_LIMITS.positiveSceneTime.maximum,
    );
    if (startTime + duration > VCAMERA_LIMITS.sceneTime.maximum) {
      throw new Error(`--start-time + --duration cannot exceed ${VCAMERA_LIMITS.sceneTime.maximum}`);
    }
    const actorSelector = getFlagValue(args, "--actor");
    const actor = actorSelector ? resolveByIdOrName(project.actors, actorSelector, "Actor") : undefined;
    const actorRequired = !["pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "zoom_out"].includes(presetValue);
    if (actorRequired && !actor) throw new Error(`--actor is required for ${presetValue}`);
    const easingValue = getFlagValue(args, "--easing") ?? "smooth";
    if (!(SCENE_EASINGS as readonly string[]).includes(easingValue)) throw new Error("Invalid --easing");
    const amountScale = optionalNumber(args, "--amount", 0.5, 1.5) ?? 1;
    const preserveSubjectScale = optionalBoolean(args, "--preserve-subject-scale") ?? true;
    const generatedPatch = createCameraPresetPatch({
      preset: presetValue,
      camera,
      actor,
      startTime,
      duration,
      easing: easingValue as SceneEasing,
      amountScale,
      preserveSubjectScale,
    });
    const generatedPoints = generatedPatch.pathPoints ?? [];
    const pathPoints = generatedPoints.length > 0
      ? mergePresetPathPoints(camera.pathPoints, generatedPoints, startTime, startTime + duration)
      : camera.pathPoints;
    cameras[index] = {
      ...camera,
      ...generatedPatch,
      pathPoints,
    };
    return {
      patch: {
        cameras,
        ...(startTime + duration > project.duration ? { duration: startTime + duration } : {}),
      },
      operation: "camera.preset",
      entityId: camera.id,
      sideEffects: generatedPoints.length > 0
        ? [`Generated editable camera path points from ${startTime}s to ${startTime + duration}s.`]
        : ["Applied explicit camera tracking settings without creating artificial path points."],
    };
  }
  if (action === "set") {
    const name = getFlagValue(args, "--name");
    const position = parseVec3(getFlagValue(args, "--position"), "--position");
    const rotation = parseRotationVec3(getFlagValue(args, "--rotation"), "--rotation");
    const fov = optionalNumber(args, "--fov", VCAMERA_LIMITS.fov.minimum, VCAMERA_LIMITS.fov.maximum);
    const focusDistance = optionalNumber(args, "--focus-distance", VCAMERA_LIMITS.focusDistance.minimum, VCAMERA_LIMITS.focusDistance.maximum);
    const duration = optionalNumber(args, "--duration", VCAMERA_LIMITS.positiveSceneTime.minimum, VCAMERA_LIMITS.positiveSceneTime.maximum);
    const movementModeValue = getFlagValue(args, "--movement-mode");
    if (movementModeValue !== undefined && !["static", "path", "follow"].includes(movementModeValue)) {
      throw new Error("--movement-mode must be static, path, or follow");
    }
    const aimModeValue = getFlagValue(args, "--aim-mode");
    if (aimModeValue !== undefined && !["manual", "actor", "point"].includes(aimModeValue)) {
      throw new Error("--aim-mode must be manual, actor, or point");
    }
    const trackingActorSelector = getFlagValue(args, "--tracking-actor");
    const clearTracking = hasFlag(args, "--clear-tracking");
    if (trackingActorSelector && clearTracking) throw new Error("Use either --tracking-actor or --clear-tracking");
    const trackingActor = trackingActorSelector
      ? resolveByIdOrName(project.actors, trackingActorSelector, "Actor")
      : undefined;
    const trackingPointValue = getFlagValue(args, "--tracking-point");
    if (trackingPointValue !== undefined && !["head", "chest", "center"].includes(trackingPointValue)) {
      throw new Error("--tracking-point must be head, chest, or center");
    }
    const lookAtPoint = parseVec3(getFlagValue(args, "--look-at-point"), "--look-at-point");
    const clearLookAt = hasFlag(args, "--clear-look-at");
    if (lookAtPoint && clearLookAt) throw new Error("Use either --look-at-point or --clear-look-at");
    const followOffset = parseVec3(getFlagValue(args, "--follow-offset"), "--follow-offset");
    const followSpeed = optionalNumber(args, "--follow-speed", VCAMERA_LIMITS.followSpeed.minimum, VCAMERA_LIMITS.followSpeed.maximum);
    const motionPresetValue = getFlagValue(args, "--motion-preset");
    const clearMotionPreset = hasFlag(args, "--clear-motion-preset");
    const syncOrigin = hasFlag(args, "--sync-origin");
    if (motionPresetValue !== undefined && !["none", "null"].includes(motionPresetValue) && !isMotionPreset(motionPresetValue)) {
      throw new Error("Invalid --motion-preset");
    }
    if (motionPresetValue !== undefined && clearMotionPreset) throw new Error("Use either --motion-preset or --clear-motion-preset");
    if (syncOrigin && position === undefined) throw new Error("--sync-origin requires --position");
    if (
      [
        name, position, rotation, fov, focusDistance, duration, movementModeValue, aimModeValue,
        trackingActorSelector, trackingPointValue, lookAtPoint, followOffset, followSpeed, motionPresetValue,
      ].every((value) => value === undefined)
      && !clearTracking
      && !clearLookAt
      && !clearMotionPreset
    ) {
      throw new Error("No camera fields provided");
    }
    const nextCamera: Camera = {
      ...camera,
      ...(name !== undefined ? { name: requireText(name, "--name") } : {}),
      ...(position ? setOwnerPosition(camera, position, syncOrigin) : {}),
      ...(rotation ? { rotation } : {}),
      ...(fov !== undefined ? { fov } : {}),
      ...(focusDistance !== undefined ? { focusDistance } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(movementModeValue !== undefined ? { movementMode: movementModeValue as Camera["movementMode"] } : {}),
      ...(aimModeValue !== undefined ? { aimMode: aimModeValue as Camera["aimMode"] } : {}),
      ...(trackingActor ? { trackingActorId: trackingActor.id } : {}),
      ...(clearTracking ? { trackingActorId: null } : {}),
      ...(trackingPointValue !== undefined ? { trackingPoint: trackingPointValue as CameraTrackingPoint } : {}),
      ...(lookAtPoint ? { lookAtPoint } : {}),
      ...(clearLookAt ? { lookAtPoint: null } : {}),
      ...(followOffset ? { followOffset } : {}),
      ...(followSpeed !== undefined ? { followSpeed } : {}),
      ...(motionPresetValue !== undefined
        ? { motionPreset: ["none", "null"].includes(motionPresetValue) ? null : motionPresetValue as Camera["motionPreset"] }
        : {}),
      ...(clearMotionPreset ? { motionPreset: null } : {}),
    };
    if (nextCamera.movementMode === "follow" && !nextCamera.trackingActorId) {
      throw new Error("--tracking-actor is required when --movement-mode is follow");
    }
    if (nextCamera.aimMode === "actor" && !nextCamera.trackingActorId) {
      throw new Error("--tracking-actor is required when --aim-mode is actor");
    }
    if (nextCamera.aimMode === "point" && !nextCamera.lookAtPoint) {
      throw new Error("--look-at-point is required when --aim-mode is point");
    }
    cameras[index] = nextCamera;
    return {
      patch: { cameras },
      operation: "camera.set",
      entityId: camera.id,
      ...(syncOrigin ? { sideEffects: ["Synchronized every zero-time camera path point to the new base position."] } : {}),
    };
  }
  if (action === "translate") {
    const delta = parseVec3(getFlagValue(args, "--delta"), "--delta");
    if (!delta) throw new Error("--delta is required");
    cameras[index] = translateOwnerAndPath(camera, delta);
    return {
      patch: { cameras },
      operation: "camera.translate",
      entityId: camera.id,
      sideEffects: ["Translated camera.position and every camera.pathPoints[].position by --delta."],
    };
  }
  if (action === "delete") {
    const remaining = cameras.filter((item) => item.id !== camera.id);
    return {
      patch: {
        cameras: remaining,
        cameraCuts: project.cameraCuts.filter((cut) => cut.cameraId !== camera.id),
        shots: project.shots.filter((shot) => shot.cameraId !== camera.id),
        activeCameraId: project.activeCameraId === camera.id ? remaining[0]?.id ?? null : project.activeCameraId,
      },
      operation: "camera.delete",
      entityId: camera.id,
      sideEffects: [
        "Removed shots and camera cuts that referenced the deleted camera.",
        ...(project.activeCameraId === camera.id
          ? ["Selected the first remaining camera as active, or null when none remained."]
          : []),
      ],
    };
  }
  if (action === "follow") {
    const actor = resolveByIdOrName(project.actors, requireFlag(args, "--actor"), "Actor");
    const trackingPoint = (getFlagValue(args, "--tracking-point") ?? "chest") as CameraTrackingPoint;
    if (!["head", "chest", "center"].includes(trackingPoint)) throw new Error("Invalid --tracking-point");
    const offset = parseVec3(getFlagValue(args, "--offset"), "--offset");
    const deriveOffset = hasFlag(args, "--derive-offset");
    const clearMotionPreset = hasFlag(args, "--clear-motion-preset");
    if (offset && deriveOffset) throw new Error("Use either --offset or --derive-offset");
    if (!offset && !deriveOffset) throw new Error("camera follow requires --offset; use --derive-offset to explicitly derive it from the current placement");
    cameras[index] = {
      ...camera,
      movementMode: "follow",
      aimMode: "actor",
      trackingActorId: actor.id,
      trackingPoint,
      followOffset: offset ?? cameraOffsetInActorSpace(camera, actor),
      followSpeed: optionalNumber(args, "--speed", VCAMERA_LIMITS.followSpeed.minimum, VCAMERA_LIMITS.followSpeed.maximum) ?? camera.followSpeed,
      ...(clearMotionPreset ? { motionPreset: null } : {}),
    };
    return {
      patch: { cameras },
      operation: "camera.follow",
      entityId: camera.id,
      warnings: ["camera follow is a compound helper. Automation should use camera set with explicit raw fields."],
      sideEffects: [
        "Set movementMode=follow and aimMode=actor.",
        "Set trackingActorId, trackingPoint, followOffset, and followSpeed.",
        ...(clearMotionPreset ? ["Cleared motionPreset."] : []),
      ],
    };
  }
  if (action === "aim") {
    const actorSelector = getFlagValue(args, "--actor");
    const point = parseVec3(getFlagValue(args, "--point"), "--point");
    const manual = hasFlag(args, "--manual");
    if ([Boolean(actorSelector), Boolean(point), manual].filter(Boolean).length !== 1) {
      throw new Error("Use exactly one of --actor, --point, or --manual");
    }
    const actor = actorSelector ? resolveByIdOrName(project.actors, actorSelector, "Actor") : undefined;
    cameras[index] = {
      ...camera,
      aimMode: actor ? "actor" : point ? "point" : "manual",
      ...(actor ? { trackingActorId: actor.id } : {}),
      ...(point ? { lookAtPoint: point } : {}),
    };
    return {
      patch: { cameras },
      operation: "camera.aim",
      entityId: camera.id,
      warnings: ["camera aim is a compound helper. Automation should use camera set with explicit raw fields."],
      sideEffects: actor
        ? ["Set aimMode=actor and trackingActorId."]
        : point
          ? ["Set aimMode=point and lookAtPoint."]
          : ["Set aimMode=manual."],
    };
  }
  return mutatePath(project, "camera", camera, cameras, index, action, args);
}

function mutateShot(project: VCameraProject, action: string, args: string[]) {
  const shots = clone(project.shots);
  if (action === "add") {
    ensureCollectionCapacity(shots, VCAMERA_LIMITS.collections.shots, "shots");
    const id = getFlagValue(args, "--id") ?? `shot_${randomUUID()}`;
    ensureUniqueId(shots, id, "Shot");
    const camera = resolveByIdOrName(project.cameras, requireFlag(args, "--camera"), "Camera");
    const startTime = optionalNumber(args, "--start-time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum)
      ?? (shots.length ? Math.max(...shots.map((shot) => shot.endTime)) : 0);
    const endTime = resolveShotEndTime(args, startTime);
    const shot: CameraShot = {
      id,
      name: getFlagValue(args, "--name") ?? `Shot ${shots.length + 1}`,
      startTime,
      endTime,
      cameraId: camera.id,
      locked: optionalBoolean(args, "--locked") ?? false,
      metadata: parseMetadataJson(getFlagValue(args, "--metadata-json")),
    };
    const nextShots = [...shots, shot].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
    ensureShotsDoNotOverlap(nextShots);
    const cutId = `camera_cut_${randomUUID()}`;
    const cameraCuts = [
      ...project.cameraCuts.filter((cut) => Math.abs(cut.time - startTime) > 0.001),
      { id: cutId, time: startTime, cameraId: camera.id, shotId: id },
    ].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    return {
      patch: { shots: nextShots, cameraCuts, ...(endTime > project.duration ? { duration: endTime } : {}) },
      operation: "shot.add",
      entityId: id,
      sideEffects: ["Created the shot-managed camera cut at shot.startTime."],
    };
  }

  const selector = requireFlag(args, "--shot");
  const shot = resolveByIdOrName(shots, selector, "Shot");
  const index = shots.findIndex((item) => item.id === shot.id);
  if (action === "delete") {
    if (shot.locked) throw new Error(`Shot is locked: ${shot.name}`);
    return {
      patch: {
        shots: shots.filter((item) => item.id !== shot.id),
        cameraCuts: project.cameraCuts.filter((cut) => cut.shotId !== shot.id),
      },
      operation: "shot.delete",
      entityId: shot.id,
      sideEffects: ["Removed the camera cut managed by the deleted shot."],
    };
  }
  if (action !== "set") throw new Error(`Unsupported shot action: ${action}`);

  const name = getFlagValue(args, "--name");
  const cameraSelector = getFlagValue(args, "--camera");
  const camera = cameraSelector ? resolveByIdOrName(project.cameras, cameraSelector, "Camera") : undefined;
  const startTime = optionalNumber(args, "--start-time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
  const endTimeFlag = optionalNumber(args, "--end-time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
  const duration = optionalNumber(args, "--duration", VCAMERA_LIMITS.positiveSceneTime.minimum, VCAMERA_LIMITS.positiveSceneTime.maximum);
  const locked = optionalBoolean(args, "--locked");
  const metadataValue = getFlagValue(args, "--metadata-json");
  const metadata = metadataValue === undefined ? undefined : parseMetadataJson(metadataValue);
  if (endTimeFlag !== undefined && duration !== undefined) throw new Error("Use either --end-time or --duration");
  if ([name, camera, startTime, endTimeFlag, duration, locked, metadata].every((value) => value === undefined)) {
    throw new Error("No shot fields provided");
  }
  if (shot.locked && locked !== false) throw new Error(`Shot is locked: ${shot.name}. Unlock it before editing.`);
  const nextStart = startTime ?? shot.startTime;
  const originalDuration = shot.endTime - shot.startTime;
  const nextEnd = endTimeFlag ?? (duration !== undefined ? nextStart + duration : nextStart + originalDuration);
  if (nextEnd <= nextStart || nextEnd > VCAMERA_LIMITS.sceneTime.maximum) {
    throw new Error(`Shot end time must be after start time and no later than ${VCAMERA_LIMITS.sceneTime.maximum} seconds`);
  }
  const updatedShot: CameraShot = {
    ...shot,
    ...(name !== undefined ? { name: requireText(name, "--name") } : {}),
    ...(camera ? { cameraId: camera.id } : {}),
    startTime: nextStart,
    endTime: nextEnd,
    ...(locked !== undefined ? { locked } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
  shots[index] = updatedShot;
  shots.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  ensureShotsDoNotOverlap(shots);
  const existingCut = project.cameraCuts.find((cut) => cut.shotId === shot.id);
  const linkedCut = {
    id: existingCut?.id ?? `camera_cut_${randomUUID()}`,
    time: updatedShot.startTime,
    cameraId: updatedShot.cameraId,
    shotId: updatedShot.id,
  };
  const cameraCuts = [
    ...project.cameraCuts.filter((cut) => (
      cut.shotId !== shot.id && Math.abs(cut.time - updatedShot.startTime) > 0.001
    )),
    linkedCut,
  ]
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return {
    patch: { shots, cameraCuts, ...(nextEnd > project.duration ? { duration: nextEnd } : {}) },
    operation: "shot.set",
    entityId: shot.id,
    sideEffects: ["Synchronized the shot-managed camera cut to the shot start time and camera."],
  };
}

function mutateCut(project: VCameraProject, action: string, args: string[]) {
  if (action === "clear") {
    if (project.shots.length) throw new Error("Camera cuts linked to shots cannot be cleared; delete the shots instead");
    return { patch: { cameraCuts: [] }, operation: "cut.clear" };
  }
  if (action === "delete") {
    const cutId = requireFlag(args, "--cut");
    const cut = project.cameraCuts.find((item) => item.id === cutId);
    if (!cut) throw new Error(`Camera cut not found: ${cutId}`);
    if (cut.shotId) throw new Error("This camera cut is managed by a shot; delete the shot instead");
    return { patch: { cameraCuts: project.cameraCuts.filter((cut) => cut.id !== cutId) }, operation: "cut.delete", entityId: cutId };
  }
  if (action === "set") {
    const cutId = requireFlag(args, "--cut");
    const cut = project.cameraCuts.find((item) => item.id === cutId);
    if (!cut) throw new Error(`Camera cut not found: ${cutId}`);
    if (cut.shotId) throw new Error("This camera cut is managed by a shot; edit the shot instead");
    const cameraSelector = getFlagValue(args, "--camera");
    const camera = cameraSelector ? resolveByIdOrName(project.cameras, cameraSelector, "Camera") : undefined;
    const requestedTime = optionalNumber(args, "--time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
    const actorSelector = getFlagValue(args, "--actor");
    const pointId = getFlagValue(args, "--point");
    const clearAnchor = hasFlag(args, "--clear-anchor");
    if (Boolean(actorSelector) !== Boolean(pointId)) throw new Error("Anchored cuts require both --actor and --point");
    if (actorSelector && (requestedTime !== undefined || clearAnchor)) {
      throw new Error("Use either --actor with --point, or --time with optional --clear-anchor");
    }
    if (cut.anchor && requestedTime !== undefined && !clearAnchor) {
      throw new Error("Changing the time of an anchored cut requires --clear-anchor");
    }
    let nextAnchor = cut.anchor;
    let nextTime = requestedTime ?? cut.time;
    if (actorSelector && pointId) {
      const actor = resolveByIdOrName(project.actors, actorSelector, "Actor");
      const point = actor.pathPoints.find((item) => item.id === pointId);
      if (!point) throw new Error(`Actor path point not found: ${pointId}`);
      nextAnchor = { kind: "actor_path_point", actorId: actor.id, pointId };
      nextTime = point.time;
    } else if (clearAnchor) {
      nextAnchor = undefined;
    }
    if (!camera && requestedTime === undefined && !actorSelector && !clearAnchor) throw new Error("No camera cut fields provided");
    if (project.cameraCuts.some((item) => item.id !== cutId && Math.abs(item.time - nextTime) <= 0.001)) {
      throw new Error(`A camera cut already exists at ${nextTime} seconds`);
    }
    const cameraCuts = project.cameraCuts.map((item) => item.id === cutId
      ? {
          ...item,
          ...(camera ? { cameraId: camera.id } : {}),
          time: nextTime,
          ...(nextAnchor ? { anchor: nextAnchor } : { anchor: undefined }),
        }
      : item).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    return {
      patch: { cameraCuts, ...(nextTime > project.duration ? { duration: nextTime } : {}) },
      operation: "cut.set",
      entityId: cutId,
    };
  }
  if (action !== "add") throw new Error(`Unsupported cut action: ${action}`);
  ensureCollectionCapacity(project.cameraCuts, VCAMERA_LIMITS.collections.cameraCuts, "camera cuts");
  const camera = resolveByIdOrName(project.cameras, requireFlag(args, "--camera"), "Camera");
  const requestedTime = optionalNumber(args, "--time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
  const actorSelector = getFlagValue(args, "--actor");
  const pointId = getFlagValue(args, "--point");
  let anchor: { kind: "actor_path_point"; actorId: string; pointId: string } | undefined;
  let time = requestedTime;
  if (actorSelector || pointId) {
    if (!actorSelector || !pointId) throw new Error("Anchored cuts require both --actor and --point");
    if (requestedTime !== undefined) throw new Error("Use either --time or --actor with --point");
    const actor = resolveByIdOrName(project.actors, actorSelector, "Actor");
    const point = actor.pathPoints.find((item) => item.id === pointId);
    if (!point) throw new Error(`Actor path point not found: ${pointId}`);
    anchor = { kind: "actor_path_point", actorId: actor.id, pointId };
    time = point.time;
  }
  if (time === undefined) throw new Error("--time is required for an unanchored camera cut");
  if (project.cameraCuts.some((cut) => Math.abs(cut.time - time) <= 0.001)) {
    throw new Error(`A camera cut already exists at ${time} seconds`);
  }
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

function resolveShotEndTime(args: string[], startTime: number): number {
  const endTime = optionalNumber(args, "--end-time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
  const duration = optionalNumber(args, "--duration", VCAMERA_LIMITS.positiveSceneTime.minimum, VCAMERA_LIMITS.positiveSceneTime.maximum);
  if (endTime !== undefined && duration !== undefined) throw new Error("Use either --end-time or --duration");
  if (endTime === undefined && duration === undefined) throw new Error("--end-time or --duration is required");
  const resolved = endTime ?? startTime + (duration as number);
  if (resolved <= startTime || resolved > VCAMERA_LIMITS.sceneTime.maximum) {
    throw new Error(`Shot end time must be after start time and no later than ${VCAMERA_LIMITS.sceneTime.maximum} seconds`);
  }
  return resolved;
}

function ensureShotsDoNotOverlap(shots: CameraShot[]): void {
  for (let index = 1; index < shots.length; index += 1) {
    if (shots[index].startTime < shots[index - 1].endTime) {
      throw new Error(`Shot ${shots[index].name} overlaps ${shots[index - 1].name}`);
    }
  }
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
    ensureCollectionCapacity(pathPoints, VCAMERA_LIMITS.collections.pathPointsPerEntity, `${subject} path points`);
    const time = requiredNumber(args, "--time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
    const position = parseVec3(getFlagValue(args, "--position"), "--position");
    if (!position) throw new Error("--position is required");
    const yaw = subject === "actor"
      ? optionalNumber(args, "--yaw", VCAMERA_LIMITS.rotation.minimum, VCAMERA_LIMITS.rotation.maximum)
      : undefined;
    if (subject !== "actor" && getFlagValue(args, "--yaw") !== undefined) {
      throw new Error(`${subject} path points use --rotation, not --yaw`);
    }
    const rotation = subject !== "actor"
      ? parseRotationVec3(getFlagValue(args, "--rotation"), "--rotation")
      : undefined;
    const easingValue = getFlagValue(args, "--easing");
    if (easingValue !== undefined && !(SCENE_EASINGS as readonly string[]).includes(easingValue)) throw new Error("Invalid --easing");
    const id = getFlagValue(args, "--id") ?? `path_${randomUUID()}`;
    if (pathPoints.some((point) => point.id === id)) throw new Error(`Path point id already exists: ${id}`);
    pathPoints.push({
      id,
      time,
      position,
      ...(yaw !== undefined ? { yaw } : {}),
      ...(easingValue !== undefined ? { easing: easingValue as SceneEasing } : {}),
      ...(rotation ? { rotation } : {}),
      ...(subject === "camera" && getFlagValue(args, "--fov") !== undefined
        ? { fov: requiredNumber(args, "--fov", VCAMERA_LIMITS.fov.minimum, VCAMERA_LIMITS.fov.maximum) }
        : {}),
      ...(subject === "camera" && getFlagValue(args, "--focus-distance") !== undefined
        ? { focusDistance: requiredNumber(args, "--focus-distance", VCAMERA_LIMITS.focusDistance.minimum, VCAMERA_LIMITS.focusDistance.maximum) }
        : {}),
    });
  } else if (action === "path-set") {
    pathPoints = subject === "camera"
      ? parseCameraPathPoints(getFlagValue(args, "--points-json"))
      : subject === "prop"
        ? parsePropPathPoints(getFlagValue(args, "--points-json"))
        : parsePathPoints(getFlagValue(args, "--points-json"));
    if (pathPoints.length > VCAMERA_LIMITS.collections.pathPointsPerEntity) {
      throw new Error(`${subject} path points cannot exceed ${VCAMERA_LIMITS.collections.pathPointsPerEntity}`);
    }
  } else if (action === "path-update") {
    const pointId = requireFlag(args, "--point");
    const pointIndex = pathPoints.findIndex((point) => point.id === pointId);
    if (pointIndex < 0) throw new Error(`Path point not found: ${pointId}`);
    const time = optionalNumber(args, "--time", VCAMERA_LIMITS.sceneTime.minimum, VCAMERA_LIMITS.sceneTime.maximum);
    const position = parseVec3(getFlagValue(args, "--position"), "--position");
    const yaw = subject === "actor"
      ? optionalNumber(args, "--yaw", VCAMERA_LIMITS.rotation.minimum, VCAMERA_LIMITS.rotation.maximum)
      : undefined;
    if (subject !== "actor" && getFlagValue(args, "--yaw") !== undefined) {
      throw new Error(`${subject} path points use --rotation, not --yaw`);
    }
    const easingValue = getFlagValue(args, "--easing");
    if (easingValue !== undefined && !(SCENE_EASINGS as readonly string[]).includes(easingValue)) throw new Error("Invalid --easing");
    const clearYaw = subject === "actor" && hasFlag(args, "--clear-yaw");
    if (subject !== "actor" && hasFlag(args, "--clear-yaw")) {
      throw new Error(`${subject} path points do not support --clear-yaw`);
    }
    const clearEasing = hasFlag(args, "--clear-easing");
    const rotation = subject !== "actor" ? parseRotationVec3(getFlagValue(args, "--rotation"), "--rotation") : undefined;
    const fov = subject === "camera" ? optionalNumber(args, "--fov", VCAMERA_LIMITS.fov.minimum, VCAMERA_LIMITS.fov.maximum) : undefined;
    const focusDistance = subject === "camera"
      ? optionalNumber(args, "--focus-distance", VCAMERA_LIMITS.focusDistance.minimum, VCAMERA_LIMITS.focusDistance.maximum)
      : undefined;
    const clearRotation = subject !== "actor" && hasFlag(args, "--clear-rotation");
    const clearFov = subject === "camera" && hasFlag(args, "--clear-fov");
    const clearFocusDistance = subject === "camera" && hasFlag(args, "--clear-focus-distance");
    if (yaw !== undefined && clearYaw) throw new Error("Use either --yaw or --clear-yaw");
    if (easingValue !== undefined && clearEasing) throw new Error("Use either --easing or --clear-easing");
    if (rotation && clearRotation) throw new Error("Use either --rotation or --clear-rotation");
    if (fov !== undefined && clearFov) throw new Error("Use either --fov or --clear-fov");
    if (focusDistance !== undefined && clearFocusDistance) throw new Error("Use either --focus-distance or --clear-focus-distance");
    if ([time, position, yaw, easingValue, rotation, fov, focusDistance].every((value) => value === undefined)
      && !clearYaw && !clearEasing && !clearRotation && !clearFov && !clearFocusDistance) {
      throw new Error("No path point fields provided");
    }
    let updatedPoint = {
      ...pathPoints[pointIndex],
      ...(time !== undefined ? { time } : {}),
      ...(position ? { position } : {}),
      ...(yaw !== undefined ? { yaw } : {}),
      ...(easingValue !== undefined ? { easing: easingValue as SceneEasing } : {}),
      ...(rotation ? { rotation } : {}),
      ...(fov !== undefined ? { fov } : {}),
      ...(focusDistance !== undefined ? { focusDistance } : {}),
    } as PathPoint & { rotation?: Vec3; fov?: number; focusDistance?: number };
    if (clearYaw) updatedPoint = omitKey(updatedPoint, "yaw");
    if (clearEasing) updatedPoint = omitKey(updatedPoint, "easing");
    if (clearRotation) updatedPoint = omitKey(updatedPoint, "rotation");
    if (clearFov) updatedPoint = omitKey(updatedPoint, "fov");
    if (clearFocusDistance) updatedPoint = omitKey(updatedPoint, "focusDistance");
    pathPoints[pointIndex] = updatedPoint;
  } else if (action === "path-clear") {
    pathPoints = [];
  } else if (action === "path-delete") {
    const pointId = requireFlag(args, "--point");
    if (!pathPoints.some((point) => point.id === pointId)) throw new Error(`Path point not found: ${pointId}`);
    pathPoints = pathPoints.filter((point) => point.id !== pointId);
  } else {
    throw new Error(`Unsupported ${subject} action: ${action}`);
  }
  pathPoints.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  ensureUniquePathPointIds(pathPoints);
  ensureUniquePathPointTimes(pathPoints);
  const zeroPoint = pathPoints.find((point) => point.time <= 0);
  owners[index] = {
    ...owner,
    ...(zeroPoint ? { position: [...zeroPoint.position] as Vec3 } : {}),
    pathPoints,
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
    json({
      canvas_id: canvas.id,
      node_id: String(node.id),
      revision: canvas.revision ?? 0,
      project,
      spatial_summary: getProjectSpatialSummary(project),
    });
    return;
  }
  text([
    `V-camera node: ${String(node.id)}`,
    `Project: ${project.name}`,
    `Actors: ${project.actors.length}`,
    `Props: ${project.cubes.length}`,
    `Cameras: ${project.cameras.length}`,
    `Shots: ${project.shots.length}`,
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

function setOwnerPosition<T extends { position: Vec3; pathPoints: PathPoint[] }>(owner: T, position: Vec3, syncOrigin: boolean) {
  const hasZeroTimePoint = (owner.pathPoints ?? []).some((point) => point.time === 0);
  if (hasZeroTimePoint && !syncOrigin) {
    throw new Error("The entity has a zero-time path point. Update that point directly or repeat with --sync-origin; the path will not be translated implicitly.");
  }
  return {
    position,
    ...(syncOrigin
      ? {
          pathPoints: (owner.pathPoints ?? []).map((point) => point.time === 0
            ? { ...point, position: [...position] as Vec3 }
            : point),
        }
      : {}),
  };
}

function translateOwnerAndPath<T extends { position: Vec3; pathPoints: PathPoint[] }>(owner: T, delta: Vec3): T {
  return {
    ...owner,
    position: addVec3(owner.position, delta),
    pathPoints: (owner.pathPoints ?? []).map((point) => ({
      ...point,
      position: addVec3(point.position, delta),
    })),
  };
}

function addVec3(value: Vec3, delta: Vec3): Vec3 {
  return [value[0] + delta[0], value[1] + delta[1], value[2] + delta[2]];
}

function parseScaleVec3(value: string | undefined, flag: string): Vec3 | undefined {
  const scale = parseVec3(value, flag);
  if (!scale) return undefined;
  if (scale.some((item) => item < VCAMERA_LIMITS.scale.minimum || item > VCAMERA_LIMITS.scale.maximum)) {
    throw new Error(`${flag} values must be between ${VCAMERA_LIMITS.scale.minimum} and ${VCAMERA_LIMITS.scale.maximum}`);
  }
  return scale;
}

function parseRotationVec3(value: string | undefined, flag: string): Vec3 | undefined {
  const rotation = parseVec3(value, flag);
  if (!rotation) return undefined;
  if (rotation.some((item) => item < VCAMERA_LIMITS.rotation.minimum || item > VCAMERA_LIMITS.rotation.maximum)) {
    throw new Error(`${flag} values must be between ${VCAMERA_LIMITS.rotation.minimum} and ${VCAMERA_LIMITS.rotation.maximum}`);
  }
  return rotation;
}

function ensureCollectionCapacity(items: unknown[], maximum: number, label: string): void {
  if (items.length >= maximum) throw new Error(`${label} cannot exceed ${maximum}`);
}

function omitKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> & Partial<Pick<T, K>> {
  const result = { ...value };
  delete result[key];
  return result;
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

function ensureUniquePathPointTimes(points: PathPoint[]): void {
  const times = new Set<number>();
  for (const point of points) {
    const time = Number(point.time.toFixed(3));
    if (times.has(time)) throw new Error(`Path point time already exists: ${time}`);
    times.add(time);
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

function parseMetadataJson(value: string | undefined): Record<string, string | number | boolean | null> {
  if (value === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("--metadata-json must be valid JSON");
  }
  if (!isRecord(parsed)) throw new Error("--metadata-json must be a JSON object");
  if (Object.keys(parsed).length > VCAMERA_LIMITS.collections.metadataFields) {
    throw new Error(`--metadata-json must contain at most ${VCAMERA_LIMITS.collections.metadataFields} fields`);
  }
  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, item] of Object.entries(parsed)) {
    const key = requireText(rawKey, "--metadata-json key");
    if (key.length > 80) throw new Error("--metadata-json keys must be at most 80 characters");
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      metadata[key] = item;
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      metadata[key] = item;
      continue;
    }
    throw new Error(`--metadata-json field ${key} must be a JSON scalar`);
  }
  return metadata;
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
    "Usage: mir-cli canvas v-camera <capabilities|inspect|create|project|actor|prop|camera|shot|cut> ...",
    "  capabilities --json: offline, versioned Virtual Shoot parameter contract",
    "  actor/prop/camera: add | set | translate | delete | path add | path set | path update | path delete | path clear",
    "  actor: action add | action set | action delete | action clear",
    "  prop: visibility add | visibility set | visibility delete | visibility clear",
    "  camera: preset --preset <name> --start-time <seconds> --duration <seconds>",
    "  camera: follow | aim are compound helpers; automation should use camera set",
    "  shot: add | set | delete",
    "  cut: add | set | delete | clear",
    "All path point, shot, and camera cut times are absolute scene times.",
    "Raw set commands change only explicitly supplied fields. Use translate to move a base position and its entire path together.",
    "Use --dry-run to inspect a change without writing it; mutations otherwise require --yes.",
  ].join("\n");
}
