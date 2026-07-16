export const VCAMERA_CONTRACT_VERSION = 1;
export const VCAMERA_PROJECT_VERSION = 2;

export const VCAMERA_LIMITS = {
  sceneTime: { minimum: 0, maximum: 3600 },
  positiveSceneTime: { minimum: 0.000001, maximum: 3600 },
  fps: { minimum: 1, maximum: 120 },
  actorHeight: { minimum: 0.1, maximum: 20 },
  rotation: { minimum: -36000, maximum: 36000 },
  scale: { minimum: 0.001, maximum: 10000 },
  fov: { minimum: 1, maximum: 179 },
  focusDistance: { minimum: 0.05, maximum: 1_000_000 },
  followSpeed: { minimum: 0.01, maximum: 100 },
  stepCount: { minimum: 2, maximum: 64 },
  collections: {
    actors: 200,
    props: 500,
    cameras: 100,
    shots: 2000,
    cameraCuts: 2000,
    pathPointsPerEntity: 2000,
    actionMarkersPerActor: 2000,
    visibilityKeyframesPerProp: 2000,
    pathPointsPerPatch: 20000,
    metadataFields: 50,
  },
} as const;

export const VCAMERA_ENUMS = {
  safeFrameRatio: ["off", "9:16", "16:9", "1:1"],
  sceneEasing: ["smooth", "linear", "ease_in", "ease_out", "ease_in_out"],
  propPreset: ["box", "thin_wall", "column", "platform", "obstacle", "door_frame", "stairs", "slope"],
  sourceType: ["primitive", "asset"],
  cameraMovementMode: ["static", "path", "follow"],
  cameraAimMode: ["manual", "actor", "point"],
  cameraTrackingPoint: ["head", "chest", "center"],
  cameraMotionPreset: [
    "push_in",
    "pull_out",
    "truck_left",
    "truck_right",
    "fixed_tracking",
    "lead_follow",
    "chase_follow",
    "orbit_left",
    "orbit_right",
    "crane_up",
    "crane_down",
    "pan_left",
    "pan_right",
    "tilt_up",
    "tilt_down",
    "zoom_in",
    "zoom_out",
    "dolly_zoom_in",
    "dolly_zoom_out",
  ],
  cameraCutAnchorKind: ["actor_path_point"],
} as const;

export const VCAMERA_DEFAULTS = {
  project: {
    version: VCAMERA_PROJECT_VERSION,
    name: "Virtual Shoot stage",
    fps: 24,
    duration: 1,
    safeFrameRatio: "off",
    activeCameraId: null,
  },
  actor: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    height: 1.75,
  },
  primitiveProp: {
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    visible: true,
    locked: false,
    sourceType: "primitive",
  },
  assetProp: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    sourceType: "asset",
  },
  stairsStepCount: 5,
  camera: {
    position: [0, 1.6, 4],
    rotation: [0, 0, 0],
    fov: 35,
    focusDistance: 4,
    duration: 3,
    movementMode: "static",
    aimMode: "manual",
    trackingActorId: null,
    trackingPoint: "chest",
    followOffset: [0, 1.6, 3],
    followSpeed: 6,
    motionPreset: null,
  },
} as const;

type FieldContract = {
  type: string;
  writable: boolean;
  required?: boolean;
  nullable?: boolean;
  clearable?: boolean;
  derived?: boolean;
  protected?: boolean;
  runtimeOnly?: boolean;
  minimum?: number;
  maximum?: number;
  enum?: keyof typeof VCAMERA_ENUMS;
  default?: unknown;
  reference?: string;
  itemType?: string;
  commands?: string[];
  notes?: string[];
};

const raw = (type: string, commands: string[], options: Omit<FieldContract, "type" | "writable" | "commands"> = {}): FieldContract => ({
  type,
  writable: true,
  commands,
  ...options,
});

const system = (type: string, options: Omit<FieldContract, "type" | "writable"> = {}): FieldContract => ({
  type,
  writable: false,
  ...options,
});

const time = (commands: string[], options: Omit<FieldContract, "type" | "writable" | "commands" | "minimum" | "maximum"> = {}): FieldContract => raw(
  "number",
  commands,
  { minimum: VCAMERA_LIMITS.sceneTime.minimum, maximum: VCAMERA_LIMITS.sceneTime.maximum, ...options },
);

const vec3 = (commands: string[], options: Omit<FieldContract, "type" | "writable" | "commands"> = {}): FieldContract => raw(
  "vec3",
  commands,
  options,
);

export const VCAMERA_FIELDS = {
  project: {
    version: system("integer", { derived: true, default: VCAMERA_PROJECT_VERSION, notes: ["Managed by normalization and compatibility upgrades."] }),
    name: raw("string", ["project set --name"], { required: true, default: VCAMERA_DEFAULTS.project.name }),
    fps: raw("number", ["project set --fps"], { required: true, ...VCAMERA_LIMITS.fps, default: VCAMERA_DEFAULTS.project.fps }),
    duration: system("number", { derived: true, minimum: 1, maximum: VCAMERA_LIMITS.sceneTime.maximum, default: VCAMERA_DEFAULTS.project.duration, notes: ["Derived from the latest authored global scene time."] }),
    safeFrameRatio: raw("enum", ["project set --safe-frame"], { required: true, enum: "safeFrameRatio", default: VCAMERA_DEFAULTS.project.safeFrameRatio }),
    cubes: raw("collection", ["prop add", "prop set", "prop translate", "prop delete", "prop path", "prop visibility"], { required: true, itemType: "prop" }),
    actors: raw("collection", ["actor add", "actor set", "actor translate", "actor delete", "actor path", "actor action"], { required: true, itemType: "actor" }),
    cameras: raw("collection", ["camera add", "camera set", "camera translate", "camera delete", "camera path"], { required: true, itemType: "camera" }),
    cameraCuts: raw("collection", ["cut add", "cut set", "cut delete", "cut clear", "shot add", "shot set", "shot delete"], { required: true, itemType: "cameraCut" }),
    shots: raw("collection", ["shot add", "shot set", "shot delete"], { required: true, itemType: "shot" }),
    activeCameraId: raw("id", ["project set --active-camera", "project set --clear-active-camera"], { nullable: true, clearable: true, reference: "camera", default: null }),
    currentTime: system("number", { runtimeOnly: true, ...VCAMERA_LIMITS.sceneTime }),
    isPlaying: system("boolean", { runtimeOnly: true }),
  },
  actor: {
    id: raw("id", ["actor add --id"], { required: true, notes: ["Stable after creation."] }),
    name: raw("string", ["actor add --name", "actor set --name"], { required: true, notes: ["Names may repeat; selectors must reject ambiguity."] }),
    position: vec3(["actor add --position", "actor set --position", "actor translate --delta"], { required: true, default: VCAMERA_DEFAULTS.actor.position }),
    rotation: vec3(["actor add --rotation", "actor set --rotation"], { required: true, ...VCAMERA_LIMITS.rotation, default: VCAMERA_DEFAULTS.actor.rotation }),
    height: raw("number", ["actor add --height", "actor set --height"], { required: true, ...VCAMERA_LIMITS.actorHeight, default: VCAMERA_DEFAULTS.actor.height }),
    lookAtActorId: raw("id", ["actor set --look-at-actor", "actor set --clear-look-at-actor", "actor set --clear-look-at"], { nullable: true, clearable: true, reference: "actor" }),
    lookAtPoint: vec3(["actor set --look-at-point", "actor set --clear-look-at-point", "actor set --clear-look-at"], { nullable: true, clearable: true }),
    actionMarkers: raw("collection", ["actor action add", "actor action set", "actor action delete", "actor action clear"], { itemType: "actionMarker" }),
    pathPoints: raw("collection", ["actor path add", "actor path set", "actor path update", "actor path delete", "actor path clear"], { required: true, itemType: "pathPoint" }),
  },
  pathPoint: {
    id: raw("id", ["actor path add --id", "prop path add --id", "camera path add --id", "path set --points-json"], { required: true, notes: ["Stable when updating a path point."] }),
    time: time(["path add --time", "path update --time", "path set --points-json"], { required: true }),
    position: vec3(["path add --position", "path update --position", "path set --points-json"], { required: true }),
    yaw: raw("number", ["path add --yaw", "path update --yaw", "path update --clear-yaw", "path set --points-json"], { nullable: true, clearable: true, ...VCAMERA_LIMITS.rotation }),
    easing: raw("enum", ["path add --easing", "path update --easing", "path update --clear-easing", "path set --points-json"], { nullable: true, clearable: true, enum: "sceneEasing" }),
  },
  cameraPathPoint: {
    rotation: vec3(["camera path add --rotation", "camera path update --rotation", "camera path update --clear-rotation", "camera path set --points-json"], { nullable: true, clearable: true, ...VCAMERA_LIMITS.rotation }),
    fov: raw("number", ["camera path add --fov", "camera path update --fov", "camera path update --clear-fov", "camera path set --points-json"], { nullable: true, clearable: true, ...VCAMERA_LIMITS.fov }),
    focusDistance: raw("number", ["camera path add --focus-distance", "camera path update --focus-distance", "camera path update --clear-focus-distance", "camera path set --points-json"], { nullable: true, clearable: true, ...VCAMERA_LIMITS.focusDistance }),
  },
  actionMarker: {
    id: raw("id", ["actor action add --id"], { required: true, notes: ["Stable when using actor action set."] }),
    time: time(["actor action add --time", "actor action set --time"], { required: true }),
    action: raw("string", ["actor action add --action", "actor action set --action"], { required: true }),
    targetActorId: raw("id", ["actor action add --target-actor", "actor action set --target-actor", "actor action set --clear-target-actor", "actor action set --clear-targets"], { nullable: true, clearable: true, reference: "actor" }),
    targetPoint: vec3(["actor action add --target-point", "actor action set --target-point", "actor action set --clear-target-point", "actor action set --clear-targets"], { nullable: true, clearable: true }),
  },
  prop: {
    id: raw("id", ["prop add --id"], { required: true, notes: ["Stable after creation."] }),
    name: raw("string", ["prop add --name", "prop set --name"], { required: true }),
    position: vec3(["prop add --position", "prop set --position", "prop translate --delta"], { required: true }),
    rotation: vec3(["prop add --rotation", "prop set --rotation"], { required: true, ...VCAMERA_LIMITS.rotation }),
    scale: vec3(["prop add --scale", "prop set --scale"], { required: true, ...VCAMERA_LIMITS.scale }),
    visible: raw("boolean", ["prop set --visible"], { required: true, default: true }),
    locked: raw("boolean", ["prop set --locked"], { required: true, default: false }),
    propPreset: raw("enum", ["prop add --preset", "prop set --preset", "prop set --clear-preset"], { nullable: true, clearable: true, enum: "propPreset" }),
    stepCount: raw("integer", ["prop add --steps", "prop set --steps", "prop set --clear-steps"], { nullable: true, clearable: true, ...VCAMERA_LIMITS.stepCount, default: VCAMERA_DEFAULTS.stairsStepCount }),
    sourceType: raw("enum", ["prop add --source-type", "prop set --source-type"], { required: true, enum: "sourceType", default: "primitive" }),
    assetId: raw("id", ["prop add --asset-id", "prop set --asset-id", "prop set --clear-asset"], { nullable: true, clearable: true, reference: "ownedModelAsset" }),
    visibilityKeyframes: raw("collection", ["prop visibility add", "prop visibility set", "prop visibility delete", "prop visibility clear"], { itemType: "visibilityKeyframe" }),
    pathPoints: raw("collection", ["prop path add", "prop path set", "prop path update", "prop path delete", "prop path clear"], { required: true, itemType: "pathPoint" }),
  },
  visibilityKeyframe: {
    id: raw("id", ["prop visibility add --id"], { required: true, notes: ["Stable when using prop visibility set."] }),
    time: time(["prop visibility add --time", "prop visibility set --time"], { required: true }),
    visible: raw("boolean", ["prop visibility add --visible", "prop visibility set --visible"], { required: true }),
  },
  camera: {
    id: raw("id", ["camera add --id"], { required: true, notes: ["Stable after creation."] }),
    name: raw("string", ["camera add --name", "camera set --name"], { required: true }),
    position: vec3(["camera add --position", "camera set --position", "camera translate --delta"], { required: true, default: VCAMERA_DEFAULTS.camera.position }),
    rotation: vec3(["camera add --rotation", "camera set --rotation"], { required: true, ...VCAMERA_LIMITS.rotation, default: VCAMERA_DEFAULTS.camera.rotation }),
    fov: raw("number", ["camera add --fov", "camera set --fov"], { required: true, ...VCAMERA_LIMITS.fov, default: VCAMERA_DEFAULTS.camera.fov }),
    focusDistance: raw("number", ["camera add --focus-distance", "camera set --focus-distance"], { required: true, ...VCAMERA_LIMITS.focusDistance, default: VCAMERA_DEFAULTS.camera.focusDistance }),
    duration: raw("number", ["camera add --duration", "camera set --duration"], { required: true, ...VCAMERA_LIMITS.positiveSceneTime, default: VCAMERA_DEFAULTS.camera.duration, notes: ["Camera metadata; project duration is derived independently."] }),
    movementMode: raw("enum", ["camera set --movement-mode"], { required: true, enum: "cameraMovementMode", default: VCAMERA_DEFAULTS.camera.movementMode }),
    aimMode: raw("enum", ["camera set --aim-mode"], { required: true, enum: "cameraAimMode", default: VCAMERA_DEFAULTS.camera.aimMode }),
    trackingActorId: raw("id", ["camera set --tracking-actor", "camera set --clear-tracking"], { nullable: true, clearable: true, reference: "actor", default: null }),
    lookAtPoint: vec3(["camera set --look-at-point", "camera set --clear-look-at"], { nullable: true, clearable: true }),
    trackingPoint: raw("enum", ["camera set --tracking-point"], { required: true, enum: "cameraTrackingPoint", default: VCAMERA_DEFAULTS.camera.trackingPoint }),
    followOffset: vec3(["camera set --follow-offset"], { required: true, default: VCAMERA_DEFAULTS.camera.followOffset }),
    followSpeed: raw("number", ["camera set --follow-speed"], { required: true, ...VCAMERA_LIMITS.followSpeed, default: VCAMERA_DEFAULTS.camera.followSpeed }),
    motionPreset: raw("enum", ["camera set --motion-preset", "camera set --clear-motion-preset"], { nullable: true, clearable: true, enum: "cameraMotionPreset", default: null, notes: ["Metadata only. Camera keyframes are supplied through path commands."] }),
    pathPoints: raw("collection", ["camera path add", "camera path set", "camera path update", "camera path delete", "camera path clear"], { required: true, itemType: "cameraPathPoint" }),
  },
  shot: {
    id: raw("id", ["shot add --id"], { required: true, notes: ["Stable after creation."] }),
    name: raw("string", ["shot add --name", "shot set --name"], { required: true }),
    startTime: time(["shot add --start-time", "shot set --start-time"], { required: true }),
    endTime: time(["shot add --end-time", "shot add --duration", "shot set --end-time", "shot set --duration"], { required: true }),
    cameraId: raw("id", ["shot add --camera", "shot set --camera"], { required: true, reference: "camera" }),
    locked: raw("boolean", ["shot add --locked", "shot set --locked"], { required: true, default: false }),
    metadata: raw("scalarMap", ["shot add --metadata-json", "shot set --metadata-json"], { required: true, default: {} }),
  },
  cameraCut: {
    id: raw("id", ["cut add --id"], { required: true, notes: ["Stable after creation."] }),
    time: time(["cut add --time", "cut set --time", "cut add --actor --point", "cut set --actor --point"], { required: true }),
    cameraId: raw("id", ["cut add --camera", "cut set --camera"], { required: true, reference: "camera" }),
    shotId: system("id", { nullable: true, reference: "shot", notes: ["Managed by shot commands."] }),
    anchor: raw("object", ["cut add --actor --point", "cut set --actor --point", "cut set --clear-anchor"], { nullable: true, clearable: true, itemType: "cameraCutAnchor" }),
  },
  cameraCutAnchor: {
    kind: system("enum", { enum: "cameraCutAnchorKind", default: "actor_path_point" }),
    actorId: raw("id", ["cut add --actor", "cut set --actor"], { required: true, reference: "actor" }),
    pointId: raw("id", ["cut add --point", "cut set --point"], { required: true, reference: "actor.pathPoint" }),
  },
} as const;

export const VCAMERA_CONTRACT = {
  contractVersion: VCAMERA_CONTRACT_VERSION,
  projectVersion: VCAMERA_PROJECT_VERSION,
  timeline: {
    mode: "global",
    unit: "seconds",
    minimum: VCAMERA_LIMITS.sceneTime.minimum,
    maximum: VCAMERA_LIMITS.sceneTime.maximum,
    description: "Every path point, action marker, visibility keyframe, shot boundary, and camera cut uses absolute time from scene second 0.",
  },
  entities: {
    actor: { projectField: "actors", idField: "id", nameField: "name", maximum: VCAMERA_LIMITS.collections.actors },
    prop: { projectField: "cubes", idField: "id", nameField: "name", maximum: VCAMERA_LIMITS.collections.props },
    camera: { projectField: "cameras", idField: "id", nameField: "name", maximum: VCAMERA_LIMITS.collections.cameras },
    shot: { projectField: "shots", idField: "id", nameField: "name", maximum: VCAMERA_LIMITS.collections.shots },
    cameraCut: { projectField: "cameraCuts", idField: "id", maximum: VCAMERA_LIMITS.collections.cameraCuts },
  },
  fields: VCAMERA_FIELDS,
  enums: VCAMERA_ENUMS,
  defaults: VCAMERA_DEFAULTS,
  limits: VCAMERA_LIMITS,
  rules: [
    { id: "global_timeline", description: "All authored times are absolute global scene seconds in the range 0..3600." },
    { id: "stable_ids", description: "Internal references use stable IDs. Renaming an entity never changes its ID." },
    { id: "duplicate_names", description: "Names may repeat. Name selectors that match more than one entity fail and require an ID." },
    { id: "active_camera_reference", description: "activeCameraId is null or references an existing camera." },
    { id: "actor_look_at_reference", description: "Actor lookAtActorId references another existing actor, never itself." },
    { id: "camera_follow_reference", description: "movementMode=follow requires trackingActorId." },
    { id: "camera_actor_aim_reference", description: "aimMode=actor requires trackingActorId." },
    { id: "camera_point_aim_reference", description: "aimMode=point requires lookAtPoint." },
    { id: "owned_asset", description: "sourceType=asset requires an assetId owned by the current user; arbitrary external model URLs are unsupported." },
    { id: "shot_order", description: "Shots are sorted by startTime, end after they start, and do not overlap on the main timeline." },
    { id: "shot_cut_sync", description: "Each shot owns one camera cut at shot.startTime with the same cameraId." },
    { id: "cut_anchor_sync", description: "An actor-path-point camera cut anchor uses the same absolute time as its referenced path point." },
    { id: "zero_time_origin", description: "A zero-time path point is the canonical initial position. Raw set --position refuses to diverge from it unless --sync-origin is explicit." },
    { id: "derived_duration", description: "Project duration is derived from the latest authored track, marker, shot end, or camera cut." },
    { id: "actor_delete_cleanup", description: "Deleting an actor clears actor look-at/action references, removes its anchored cuts, and resets cameras that tracked it using the same cleanup rules as the Virtual Shoot editor." },
    { id: "camera_lifecycle_cleanup", description: "Adding the first camera makes it active. Deleting a camera removes its shots and cuts; deleting the active camera selects the first remaining camera or null." },
    { id: "shot_lifecycle_cleanup", description: "Adding or editing a shot creates or synchronizes its managed camera cut. Deleting a shot also deletes that managed cut." },
    { id: "revision_safety", description: "Every mutation sends baseRevision and fails on conflicts without overwrite retries." },
  ],
  rawCommands: [
    "project set",
    "actor add|set|translate|delete|path|action",
    "prop add|set|translate|delete|path|visibility",
    "camera add|set|translate|delete|path",
    "shot add|set|delete",
    "cut add|set|delete|clear",
  ],
  rawCommandEffects: {
    "actor|prop|camera set --sync-origin": ["Updates the entity base position and every zero-time path point only."],
    "actor|prop|camera translate": ["Translates the entity base position and every path point position by the declared delta."],
    "actor delete": ["Cleans actor references, actor-anchored cuts, and camera tracking state according to actor_delete_cleanup."],
    "camera add": ["Sets activeCameraId only when no active camera exists."],
    "camera delete": ["Removes dependent shots and cuts and updates activeCameraId according to camera_lifecycle_cleanup."],
    "shot add|set": ["Creates or synchronizes the shot-managed camera cut."],
    "shot delete": ["Removes the shot-managed camera cut."],
    "cut add|set --actor --point": ["Copies the referenced actor path point's global time into the cut."],
  },
  compoundHelpers: {
    "camera follow": {
      stableForAutomation: false,
      status: "compound_helper",
      modifies: ["camera.movementMode", "camera.aimMode", "camera.trackingActorId", "camera.trackingPoint", "camera.followOffset", "camera.followSpeed"],
      optionalModifies: ["camera.motionPreset"],
      warning: "Automation should use camera set with explicit raw fields.",
    },
    "camera aim": {
      stableForAutomation: false,
      status: "compound_helper",
      modifiesByMode: {
        actor: ["camera.aimMode", "camera.trackingActorId"],
        point: ["camera.aimMode", "camera.lookAtPoint"],
        manual: ["camera.aimMode"],
      },
      warning: "Automation should use camera set with explicit raw fields.",
    },
  },
  unsupportedCommands: {
    "camera preset": {
      supported: false,
      replacement: "Generate exact global-time camera keyframes and use camera set plus camera path set.",
    },
  },
  derivedFields: ["project.version", "project.duration", "cameraCut.shotId", "cameraCut.time when anchor is set"],
  runtimeOnlyFields: ["project.currentTime", "project.isPlaying"],
  protectedFields: [
    "project.takes",
    "project.savedScenes",
    "project.activeSavedSceneId",
    "recording.*",
    "media.*",
    "task.*",
    "result.*",
    "billing.*",
  ],
  mutationSafety: {
    endpoint: "/canvas/{canvasId}/v-camera",
    confirmationFlag: "--yes",
    dryRunFlag: "--dry-run",
    revisionField: "baseRevision",
    retriesOnConflict: false,
    genericNodeDataUpdateAllowed: false,
  },
} as const;

export function getVCameraCapabilities(): typeof VCAMERA_CONTRACT {
  return JSON.parse(JSON.stringify(VCAMERA_CONTRACT)) as typeof VCAMERA_CONTRACT;
}
