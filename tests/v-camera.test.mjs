import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  defaultVCameraProject,
  normalizeProject,
  parseCameraPathPoints,
  parsePathPoints,
  resolveByIdOrName,
} from "../dist/v-camera/project.js";
import { handleVCameraCommand } from "../dist/commands/v-camera.js";
import { createCameraPresetPatch } from "../dist/v-camera/camera-presets.js";
import { VCAMERA_CONTRACT } from "../dist/v-camera/contract.js";
import { getActorBasePoseBounds, getProjectSpatialSummary, getPropBasePoseBounds } from "../dist/v-camera/spatial.js";

const execFileAsync = promisify(execFile);

const actor = {
  id: "actor-1",
  name: "Lead",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  height: 1.75,
  pathPoints: [],
};

const camera = {
  id: "camera-1",
  name: "Camera 1",
  position: [0, 1.6, 6],
  rotation: [0, 180, 0],
  fov: 35,
  duration: 5,
  pathPoints: [],
  movementMode: "static",
  aimMode: "manual",
  trackingActorId: null,
  trackingPoint: "chest",
  followOffset: [0, 1.6, 3],
  followSpeed: 6,
  motionPreset: null,
};

test("default project starts with editable V-camera collections", () => {
  const project = defaultVCameraProject();
  assert.equal(project.version, 3);
  assert.equal(project.duration, 1);
  assert.deepEqual(project.actors, []);
  assert.deepEqual(project.cameraCuts, []);
});

test("props without an explicit proxy preset use the published box fallback", () => {
  const project = normalizeProject({
    ...defaultVCameraProject(),
    cubes: [{
      id: "prop-1",
      name: "Reference",
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      locked: false,
      sourceType: "primitive",
      pathPoints: [],
    }],
  });

  assert.equal(project.cubes[0].propPreset, "box");
});

test("legacy path data migrates to version 3 with stable duplicate timing and typed rotations", () => {
  const project = normalizeProject({
    ...defaultVCameraProject(),
    version: 2,
    actors: [{
      ...actor,
      pathPoints: [
        { id: "b", time: 1, position: [2, 0, 0] },
        { id: "a", time: 1, position: [1, 0, 0] },
      ],
    }],
    cubes: [{
      id: "prop-1",
      name: "Wall",
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      locked: false,
      sourceType: "primitive",
      pathPoints: [{ id: "prop-path", time: 2, position: [1, 0.5, 0], yaw: 45 }],
    }],
    cameras: [{
      ...camera,
      pathPoints: [{ id: "camera-path", time: 2, position: [0, 1.6, 2], yaw: -30 }],
    }],
  });
  assert.equal(project.version, 3);
  assert.deepEqual(project.actors[0].pathPoints.map((point) => [point.id, point.time]), [
    ["a", 1],
    ["b", 1.001],
  ]);
  assert.deepEqual(project.cubes[0].pathPoints[0].rotation, [0, 45, 0]);
  assert.deepEqual(project.cameras[0].pathPoints[0].rotation, [0, -30, 0]);
});

test("version 3 rejects duplicate path times and camera yaw", () => {
  assert.throws(() => normalizeProject({
    ...defaultVCameraProject(),
    actors: [{
      ...actor,
      pathPoints: [
        { id: "a", time: 1, position: [1, 0, 0] },
        { id: "b", time: 1, position: [2, 0, 0] },
      ],
    }],
  }), /duplicate time 1/);
  assert.throws(() => parseCameraPathPoints(JSON.stringify([
    { id: "camera-path", time: 1, position: [0, 1.6, 2], yaw: 45 },
  ])), /yaw is not supported/);
});

test("proxy geometry exposes base-pose world bounds and obvious camera intersections", () => {
  const prop = {
    id: "prop-1",
    name: "Box",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [2, 1, 4],
    visible: true,
    locked: false,
    sourceType: "primitive",
    pathPoints: [],
  };
  assert.deepEqual(getPropBasePoseBounds(prop), {
    min: [-1, 0, -2],
    max: [1, 1, 2],
    center: [0, 0.5, 0],
    size: [2, 1, 4],
  });
  assert.equal(getActorBasePoseBounds(actor).min[1], 0);
  const summary = getProjectSpatialSummary({
    ...defaultVCameraProject(),
    actors: [actor],
    cubes: [prop],
    cameras: [{ ...camera, position: [0, 0.5, 0] }],
  });
  assert.equal(summary.scope, "base_pose_proxy_bounds");
  assert.ok(summary.cameraIntersections.some((item) => item.entityId === prop.id));
});

test("incomplete cameras receive the current motion fields", () => {
  const project = normalizeProject({
    ...defaultVCameraProject(),
    cameras: [{ id: "camera-minimal", name: "Minimal", position: [1, 2, 3], rotation: [0, 0, 0], fov: 40, duration: 3 }],
  });
  assert.equal(project.cameras[0].movementMode, "static");
  assert.equal(project.cameras[0].trackingPoint, "chest");
  assert.deepEqual(project.cameras[0].pathPoints, []);
});

test("zero-time path points become the canonical entity position", () => {
  const project = normalizeProject({
    ...defaultVCameraProject(),
    actors: [{ ...actor, position: [9, 9, 9], pathPoints: [{ id: "origin", time: 0, position: [1, 2, 3] }] }],
    cameras: [{ ...camera, position: [9, 9, 9], pathPoints: [{ id: "camera-origin", time: 0, position: [4, 5, 6] }] }],
  });
  assert.deepEqual(project.actors[0].position, [1, 2, 3]);
  assert.deepEqual(project.cameras[0].position, [4, 5, 6]);
});

test("remote project validation rejects malformed path points with a stable error", () => {
  assert.throws(() => normalizeProject({
    ...defaultVCameraProject(),
    actors: [{ ...actor, pathPoints: [null] }],
  }), /Invalid V-camera project data: actors\[0\]\.pathPoints\[0\] must be an object/);
});

test("remote project validation rejects unknown entity fields before they can be written", () => {
  assert.throws(() => normalizeProject({
    ...defaultVCameraProject(),
    actors: [{ ...actor, unsupportedField: "must-not-survive" }],
  }), /Invalid V-camera project data: actors\[0\]\.unsupportedField is not supported/);
});

test("dangling scene references are repaired during inspection", () => {
  const project = normalizeProject({
    ...defaultVCameraProject(),
    actors: [{
      ...actor,
      lookAtActorId: "deleted-actor",
      actionMarkers: [{ id: "cue-1", time: 1, action: "look", targetActorId: "deleted-actor" }],
    }],
    cameras: [{
      ...camera,
      movementMode: "follow",
      aimMode: "actor",
      trackingActorId: "deleted-actor",
    }],
  });

  assert.equal(project.actors[0].lookAtActorId, null);
  assert.equal(project.actors[0].actionMarkers[0].targetActorId, undefined);
  assert.equal(project.cameras[0].trackingActorId, null);
  assert.equal(project.cameras[0].movementMode, "static");
  assert.equal(project.cameras[0].aimMode, "manual");
});

test("path JSON accepts millisecond precision and sorts by time", () => {
  const points = parsePathPoints(JSON.stringify([
    { time: 2.125, position: [2, 0.5, 3] },
    { id: "first", time: 0.025, position: [0, 0, 0], yaw: 12.5 },
  ]));
  assert.equal(points[0].id, "first");
  assert.equal(points[0].time, 0.025);
  assert.equal(points[1].time, 2.125);
});

test("normalization derives duration from the latest authored track", () => {
  const project = normalizeProject({
    ...defaultVCameraProject(),
    duration: 30,
    actors: [{
      ...actor,
      pathPoints: [
        { id: "start", time: 0, position: [0, 0, 0] },
        { id: "end", time: 6.25, position: [1, 0, 0] },
      ],
    }],
  });
  assert.equal(project.duration, 6.25);
});

test("camera path JSON preserves rich absolute keyframes", () => {
  const points = parseCameraPathPoints(JSON.stringify([
    { id: "end", time: 13, position: [0, 2, 4], rotation: [0, 10, 0], fov: 55, focusDistance: 6, easing: "ease_out" },
    { id: "start", time: 8, position: [0, 1.6, 6], fov: 35 },
  ]));
  assert.deepEqual(points.map((point) => point.time), [8, 13]);
  assert.equal(points[1].fov, 55);
  assert.equal(points[1].focusDistance, 6);
  assert.equal(points[1].easing, "ease_out");
});

test("entity selectors reject duplicate names and accept exact ids", () => {
  const items = [{ id: "a", name: "Camera" }, { id: "b", name: "Camera" }];
  assert.equal(resolveByIdOrName(items, "a", "Camera").id, "a");
  assert.throws(() => resolveByIdOrName(items, "Camera", "Camera"), /ambiguous/);
});

test("actor add writes through the revision-protected V-camera endpoint", async () => {
  const calls = [];
  const api = {
    async getJson(path) {
      calls.push({ method: "GET", path });
      return {
        success: true,
        data: {
          id: "canvas-1",
          project_id: "project-1",
          name: "Canvas",
          revision: 12,
          nodes: [{ id: "vcamera-node", type: "v-camera", data: { vCameraProject: defaultVCameraProject() } }],
        },
      };
    },
    async postJson(path, body) {
      calls.push({ method: "POST", path, body });
      return {
        success: true,
        data: {
          canvas_id: "canvas-1",
          project_id: "project-1",
          node_id: "vcamera-node",
          revision: 13,
          clientModifiedAt: 1234,
          changedFields: ["actors"],
        },
      };
    },
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    await handleVCameraCommand(api, "https://miraivfx.art", [
      "actor", "add", "--canvas-id", "canvas-1", "--node-id", "vcamera-node",
      "--name", "Hero", "--position", "1,0,2", "--yes", "--json",
    ], true);
  } finally {
    console.log = originalLog;
  }

  assert.equal(calls[1].path, "/canvas/canvas-1/v-camera");
  assert.equal(calls[1].body.baseRevision, 12);
  assert.equal(calls[1].body.nodeId, "vcamera-node");
  assert.equal(calls[1].body.patch.actors[0].name, "Hero");
  assert.deepEqual(calls[1].body.patch.actors[0].position, [1, 0, 2]);
  assert.equal("takes" in calls[1].body.patch, false);
});

test("dry-run maps camera fields without issuing a write", async () => {
  const project = { ...defaultVCameraProject(), actors: [actor], cameras: [camera] };
  let postCount = 0;
  const api = {
    async getJson() {
      return {
        success: true,
        data: {
          id: "canvas-1",
          project_id: "project-1",
          name: "Canvas",
          revision: 4,
          nodes: [{ id: "vcamera-node", type: "v-camera", data: { vCameraProject: project } }],
        },
      };
    },
    async postJson() {
      postCount += 1;
      throw new Error("dry-run must not write");
    },
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    await handleVCameraCommand(api, "https://miraivfx.art", [
      "camera", "set", "--canvas-id", "canvas-1", "--camera", "camera-1",
      "--movement-mode", "follow", "--aim-mode", "actor", "--tracking-actor", "actor-1",
      "--motion-preset", "orbit_left", "--dry-run",
    ], false);
  } finally {
    console.log = originalLog;
  }
  assert.equal(postCount, 0);
});

test("camera set maps server motion fields without generating a path", async () => {
  const project = { ...defaultVCameraProject(), actors: [actor], cameras: [camera] };
  const calls = [];
  const api = mutationApi(project, calls);
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "camera", "set", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--movement-mode", "follow", "--aim-mode", "actor", "--tracking-actor", actor.id,
    "--tracking-point", "head", "--follow-offset", "1,2,3", "--follow-speed", "7",
    "--motion-preset", "chase_follow", "--yes", "--json",
  ], true));

  const patch = calls.find((call) => call.method === "POST").body.patch;
  const updated = patch.cameras[0];
  assert.equal(updated.movementMode, "follow");
  assert.equal(updated.aimMode, "actor");
  assert.equal(updated.trackingActorId, actor.id);
  assert.equal(updated.trackingPoint, "head");
  assert.deepEqual(updated.followOffset, [1, 2, 3]);
  assert.equal(updated.followSpeed, 7);
  assert.equal(updated.motionPreset, "chase_follow");
  assert.deepEqual(updated.pathPoints, []);
  assert.equal("duration" in patch, false);
});

test("camera set maps point aim and clears preset without changing path points", async () => {
  const authoredPath = [
    { id: "camera-start", time: 8, position: [0, 1.6, 6] },
    { id: "camera-end", time: 13, position: [2, 2, 3], fov: 50 },
  ];
  const project = {
    ...defaultVCameraProject(),
    actors: [actor],
    cameras: [{ ...camera, pathPoints: authoredPath, motionPreset: "push_in" }],
  };
  const calls = [];
  const api = mutationApi(project, calls);
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "camera", "set", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--movement-mode", "path", "--aim-mode", "point", "--look-at-point", "4,1,2",
    "--motion-preset", "none", "--yes", "--json",
  ], true));

  const updated = calls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.equal(updated.movementMode, "path");
  assert.equal(updated.aimMode, "point");
  assert.deepEqual(updated.lookAtPoint, [4, 1, 2]);
  assert.equal(updated.motionPreset, null);
  assert.deepEqual(updated.pathPoints, authoredPath);
});

test("camera path set stores exact keyframes without changing independent camera fields", async () => {
  const project = {
    ...defaultVCameraProject(),
    actors: [actor],
    cameras: [{ ...camera, movementMode: "static", motionPreset: "orbit_left" }],
  };
  const calls = [];
  const api = mutationApi(project, calls);
  const points = [
    { id: "start", time: 8, position: [0, 1.6, 6], rotation: [0, 180, 0], fov: 35 },
    { id: "end", time: 13, position: [2, 2, 3], rotation: [0, 150, 0], fov: 52, easing: "ease_out" },
  ];
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "camera", "path", "set", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--points-json", JSON.stringify(points), "--yes", "--json",
  ], true));

  const patch = calls.find((call) => call.method === "POST").body.patch;
  assert.deepEqual(patch.cameras[0].pathPoints, points);
  assert.equal(patch.cameras[0].movementMode, "static");
  assert.equal(patch.cameras[0].motionPreset, "orbit_left");
  assert.equal(patch.duration, 13);
});

test("project and prop commands expose independent server fields", async () => {
  const prop = {
    id: "prop-1",
    name: "Reference",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    sourceType: "asset",
    assetId: "asset-1",
    propPreset: "box",
    pathPoints: [],
  };
  const base = { ...defaultVCameraProject(), cameras: [camera], activeCameraId: null, cubes: [prop] };
  const projectCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(base, projectCalls), "https://miraivfx.art", [
    "project", "set", "--canvas-id", "canvas-1", "--active-camera", camera.id, "--yes", "--json",
  ], true));
  assert.equal(projectCalls.find((call) => call.method === "POST").body.patch.activeCameraId, camera.id);

  const propCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(base, propCalls), "https://miraivfx.art", [
    "prop", "set", "--canvas-id", "canvas-1", "--prop", prop.id,
    "--preset", "slope", "--source-type", "primitive", "--clear-asset", "--yes", "--json",
  ], true));
  const updated = propCalls.find((call) => call.method === "POST").body.patch.cubes[0];
  assert.equal(updated.propPreset, "slope");
  assert.equal(updated.sourceType, "primitive");
  assert.equal("assetId" in updated, false);
});

test("shot add creates a camera cut at the shot start on the global timeline", async () => {
  const project = { ...defaultVCameraProject(), duration: 4, actors: [actor], cameras: [camera] };
  const calls = [];
  const api = mutationApi(project, calls);
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "shot", "add", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--name", "S02 Push in", "--start-time", "8", "--duration", "5",
    "--metadata-json", '{"scriptRef":"S02","priority":2}', "--yes", "--json",
  ], true));

  const patch = calls.find((call) => call.method === "POST").body.patch;
  assert.equal(patch.shots[0].startTime, 8);
  assert.equal(patch.shots[0].endTime, 13);
  assert.equal(patch.cameraCuts[0].time, 8);
  assert.equal(patch.cameraCuts[0].cameraId, camera.id);
  assert.equal(patch.cameraCuts[0].shotId, patch.shots[0].id);
  assert.deepEqual(patch.shots[0].metadata, { scriptRef: "S02", priority: 2 });
  assert.equal(patch.duration, 13);
});

test("shot add rejects overlaps on the global timeline", async () => {
  const project = {
    ...defaultVCameraProject(),
    cameras: [camera],
    shots: [{ id: "shot-1", name: "Shot 1", startTime: 0, endTime: 5, cameraId: camera.id, locked: false, metadata: {} }],
    cameraCuts: [{ id: "cut-1", time: 0, cameraId: camera.id, shotId: "shot-1" }],
  };
  await assert.rejects(() => handleVCameraCommand(mutationApi(project, []), "https://miraivfx.art", [
    "shot", "add", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--start-time", "4", "--duration", "3", "--dry-run", "--json",
  ], true), /overlaps/);
});

test("camera follow mode requires an explicit tracking actor", async () => {
  const project = { ...defaultVCameraProject(), actors: [actor], cameras: [camera] };
  const api = mutationApi(project, []);
  await assert.rejects(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "camera", "set", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--movement-mode", "follow", "--dry-run",
  ], false), /--tracking-actor is required/);
});

test("V-camera create dry-run never contacts the API even when --yes is present", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "dist/cli.js", "canvas", "v-camera", "create",
    "--canvas-id", "canvas-1", "--x", "0", "--y", "0",
    "--yes", "--dry-run", "--json",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MIRAIVFX_API_BASE: "http://127.0.0.1:1",
      MIRAIVFX_TOKEN: "dry-run-test-token",
    },
  });
  const payload = JSON.parse(stdout);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.canvas_id, "canvas-1");
  assert.equal(payload.ops[0].type, "add_node");
  assert.equal(payload.ops[0].node.type, "v-camera");
});

test("V-camera help exits before canvas validation", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "dist/cli.js", "canvas", "v-camera", "--help",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, MIRAIVFX_TOKEN: "help-test-token" },
  });
  assert.match(stdout, /Usage: mir-cli canvas v-camera/);
});

test("stair step counts must be integers for both add and set", async () => {
  const stairs = {
    id: "stairs-1",
    name: "Stairs",
    position: [0, 0.375, 0],
    rotation: [0, 0, 0],
    scale: [1.6, 0.75, 1.4],
    visible: true,
    locked: false,
    propPreset: "stairs",
    stepCount: 6,
    pathPoints: [],
  };
  const project = { ...defaultVCameraProject(), cubes: [stairs] };
  const api = mutationApi(project, []);

  await assert.rejects(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "prop", "add", "--canvas-id", "canvas-1", "--preset", "stairs",
    "--steps", "2.5", "--dry-run",
  ], false), /--steps must be an integer between 2 and 20/);
  await assert.rejects(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "prop", "set", "--canvas-id", "canvas-1", "--prop", stairs.id,
    "--steps", "2.5", "--dry-run",
  ], false), /--steps must be an integer between 2 and 20/);
});

test("actor path edits keep anchored cuts aligned and synchronize the origin", async () => {
  const project = {
    ...defaultVCameraProject(),
    actors: [{
      ...actor,
      pathPoints: [{ id: "anchor-point", time: 1, position: [1, 0, 1] }],
    }],
    cameras: [camera],
    activeCameraId: camera.id,
    cameraCuts: [{
      id: "cut-1",
      time: 1,
      cameraId: camera.id,
      anchor: { kind: "actor_path_point", actorId: actor.id, pointId: "anchor-point" },
    }],
  };
  const calls = [];
  const api = mutationApi(project, calls);
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "actor", "path", "set", "--canvas-id", "canvas-1", "--actor", actor.id,
    "--points-json", JSON.stringify([
      { id: "origin", time: 0, position: [3, 0, 4] },
      { id: "anchor-point", time: 2.125, position: [6, 0, 8] },
    ]),
    "--yes", "--json",
  ], true));

  const patch = calls.find((call) => call.method === "POST").body.patch;
  assert.deepEqual(patch.actors[0].position, [3, 0, 4]);
  assert.equal(patch.cameraCuts[0].time, 2.125);
});

test("clearing an actor path also removes cuts anchored to its points", async () => {
  const pathActor = { ...actor, pathPoints: [{ id: "point-1", time: 2, position: [1, 0, 2] }] };
  const project = {
    ...defaultVCameraProject(),
    actors: [pathActor],
    cameras: [camera],
    cameraCuts: [{
      id: "cut-1",
      time: 2,
      cameraId: camera.id,
      anchor: { kind: "actor_path_point", actorId: actor.id, pointId: "point-1" },
    }],
  };
  const calls = [];
  const api = mutationApi(project, calls);
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "actor", "path", "clear", "--canvas-id", "canvas-1", "--actor", actor.id,
    "--yes", "--json",
  ], true));

  const patch = calls.find((call) => call.method === "POST").body.patch;
  assert.deepEqual(patch.actors[0].pathPoints, []);
  assert.deepEqual(patch.cameraCuts, []);
});

test("camera follow derives its offset only when explicitly requested", async () => {
  const project = { ...defaultVCameraProject(), actors: [actor], cameras: [camera] };
  const calls = [];
  const api = mutationApi(project, calls);
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "camera", "follow", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--actor", actor.id, "--derive-offset", "--yes", "--json",
  ], true));

  const updated = calls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.deepEqual(updated.followOffset, [0, 1.6, 6]);
  assert.equal(updated.trackingActorId, actor.id);
});

test("Virtual Shoot capabilities is offline and machine readable", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "dist/cli.js", "canvas", "v-camera", "capabilities", "--json",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MIRAIVFX_TOKEN: "",
      MIRAIVFX_API_BASE: "http://127.0.0.1:1",
    },
  });
  const contract = JSON.parse(stdout);
  assert.equal(contract.contractVersion, 2);
  assert.equal(contract.projectVersion, 3);
  assert.equal(contract.timeline.mode, "single_global_timeline");
  assert.equal(contract.timeline.maximum, 3600);
  assert.equal(contract.fields.camera.fov.maximum, 179);
  assert.equal(contract.fields.camera.motionPreset.notes[0], "Metadata only. Applying a preset generates editable global-time keyframes or follow settings.");
  assert.equal(contract.spatial.unit, "meter");
  assert.equal(contract.spatial.camera.fovType, "vertical");
  assert.equal(contract.runtimeEffects["camera.pathPoints.focusDistance"], "metadata-only");
  assert.ok(contract.protectedFields.includes("project.takes"));
  assert.equal(contract.limits.sceneTime.maximum, 3600);
  assert.equal(contract.limits.scale.maximum, 10000);
  assert.equal(contract.limits.focusDistance.maximum, 1000000);
  assert.equal(contract.fields.camera.fov.minimum, 1);
  assert.ok(contract.rawCommandEffects["camera delete"]);
  assert.equal(contract.compoundHelpers["camera follow"].stableForAutomation, false);
});

test("capabilities covers every formal scene entity field", () => {
  assert.deepEqual(Object.keys(VCAMERA_CONTRACT.fields.project).sort(), [
    "activeCameraId", "actors", "cameraCuts", "cameras", "cubes", "currentTime", "duration",
    "fps", "isPlaying", "name", "safeFrameRatio", "shots", "version",
  ]);
  assert.deepEqual(Object.keys(VCAMERA_CONTRACT.fields.actor).sort(), [
    "actionMarkers", "height", "id", "lookAtActorId", "lookAtPoint", "name", "pathPoints",
    "position", "rotation",
  ]);
  assert.deepEqual(Object.keys(VCAMERA_CONTRACT.fields.prop).sort(), [
    "assetId", "id", "locked", "name", "pathPoints", "position", "propPreset", "rotation",
    "scale", "sourceType", "stepCount", "visibilityKeyframes", "visible",
  ]);
  assert.deepEqual(Object.keys(VCAMERA_CONTRACT.fields.camera).sort(), [
    "aimMode", "duration", "focusDistance", "followOffset", "followSpeed", "fov", "id",
    "lookAtPoint", "motionPreset", "movementMode", "name", "pathPoints", "position", "rotation",
    "trackingActorId", "trackingPoint",
  ]);
  assert.deepEqual(Object.keys(VCAMERA_CONTRACT.fields.shot).sort(), [
    "cameraId", "endTime", "id", "locked", "metadata", "name", "startTime",
  ]);
  assert.deepEqual(Object.keys(VCAMERA_CONTRACT.fields.cameraCut).sort(), [
    "anchor", "cameraId", "id", "shotId", "time",
  ]);
  assert.deepEqual(Object.keys(VCAMERA_CONTRACT.fields.propPathPoint).sort(), [
    "easing", "id", "position", "rotation", "time",
  ]);
});

test("path JSON rejects global times beyond the formal scene maximum", () => {
  assert.throws(() => parsePathPoints(JSON.stringify([
    { id: "too-late", time: 3600.001, position: [0, 0, 0] },
  ])), /between 0 and 3600/);
});

test("raw position set preserves paths and zero-time origins require explicit synchronization", async () => {
  const pathActor = {
    ...actor,
    pathPoints: [{ id: "later", time: 2, position: [2, 0, 0] }],
  };
  const preserveCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi({
    ...defaultVCameraProject(), actors: [pathActor],
  }, preserveCalls), "https://miraivfx.art", [
    "actor", "set", "--canvas-id", "canvas-1", "--actor", actor.id,
    "--position", "5,0,5", "--yes", "--json",
  ], true));
  const preserved = preserveCalls.find((call) => call.method === "POST").body.patch.actors[0];
  assert.deepEqual(preserved.position, [5, 0, 5]);
  assert.deepEqual(preserved.pathPoints, pathActor.pathPoints);

  const originActor = {
    ...actor,
    pathPoints: [{ id: "origin", time: 0, position: [0, 0, 0] }],
  };
  await assert.rejects(() => handleVCameraCommand(mutationApi({
    ...defaultVCameraProject(), actors: [originActor],
  }, []), "https://miraivfx.art", [
    "actor", "set", "--canvas-id", "canvas-1", "--actor", actor.id,
    "--position", "5,0,5", "--dry-run",
  ], false), /zero-time path point/);

  const syncCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi({
    ...defaultVCameraProject(), actors: [originActor],
  }, syncCalls), "https://miraivfx.art", [
    "actor", "set", "--canvas-id", "canvas-1", "--actor", actor.id,
    "--position", "5,0,5", "--sync-origin", "--yes", "--json",
  ], true));
  const synced = syncCalls.find((call) => call.method === "POST").body.patch.actors[0];
  assert.deepEqual(synced.position, [5, 0, 5]);
  assert.deepEqual(synced.pathPoints[0].position, [5, 0, 5]);
});

test("translate moves an entity base position and every path point", async () => {
  const pathCamera = {
    ...camera,
    pathPoints: [
      { id: "start", time: 0, position: [0, 1.6, 6] },
      { id: "end", time: 3, position: [1, 1.6, 4] },
    ],
  };
  const calls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi({
    ...defaultVCameraProject(), cameras: [pathCamera],
  }, calls), "https://miraivfx.art", [
    "camera", "translate", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--delta", "2,1,-1", "--yes", "--json",
  ], true));
  const translated = calls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.deepEqual(translated.position, [2, 2.6, 5]);
  assert.deepEqual(translated.pathPoints[0].position, [2, 2.6, 5]);
  assert.deepEqual(translated.pathPoints[1].position, [3, 2.6, 3]);
});

test("prop and camera raw position updates preserve authored paths", async () => {
  const prop = {
    id: "prop-path",
    name: "Moving prop",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    sourceType: "primitive",
    propPreset: "box",
    pathPoints: [{ id: "prop-point", time: 2, position: [2, 0.5, 3] }],
  };
  const pathCamera = {
    ...camera,
    pathPoints: [{ id: "camera-point", time: 2, position: [2, 1.6, 3] }],
  };
  const project = { ...defaultVCameraProject(), cubes: [prop], cameras: [pathCamera] };

  const propCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(project, propCalls), "https://miraivfx.art", [
    "prop", "set", "--canvas-id", "canvas-1", "--prop", prop.id,
    "--position", "5,1,6", "--yes", "--json",
  ], true));
  const updatedProp = propCalls.find((call) => call.method === "POST").body.patch.cubes[0];
  assert.deepEqual(updatedProp.position, [5, 1, 6]);
  assert.deepEqual(updatedProp.pathPoints, prop.pathPoints);

  const cameraCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(project, cameraCalls), "https://miraivfx.art", [
    "camera", "set", "--canvas-id", "canvas-1", "--camera", pathCamera.id,
    "--position", "5,2,6", "--yes", "--json",
  ], true));
  const updatedCamera = cameraCalls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.deepEqual(updatedCamera.position, [5, 2, 6]);
  assert.deepEqual(updatedCamera.pathPoints, pathCamera.pathPoints);
});

test("camera and prop creation use the formal Virtual Shoot defaults", async () => {
  const cameraCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(defaultVCameraProject(), cameraCalls), "https://miraivfx.art", [
    "camera", "add", "--canvas-id", "canvas-1", "--yes", "--json",
  ], true));
  const createdCamera = cameraCalls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.deepEqual(createdCamera.position, [0, 1.6, 4]);
  assert.deepEqual(createdCamera.rotation, [0, 0, 0]);
  assert.equal(createdCamera.focusDistance, 4);

  const assetCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(defaultVCameraProject(), assetCalls), "https://miraivfx.art", [
    "prop", "add", "--canvas-id", "canvas-1", "--asset-id", "asset-1", "--yes", "--json",
  ], true));
  const asset = assetCalls.find((call) => call.method === "POST").body.patch.cubes[0];
  assert.equal(asset.sourceType, "asset");
  assert.equal("propPreset" in asset, false);
  assert.deepEqual(asset.scale, [1, 1, 1]);

  const stairsCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(defaultVCameraProject(), stairsCalls), "https://miraivfx.art", [
    "prop", "add", "--canvas-id", "canvas-1", "--preset", "stairs", "--yes", "--json",
  ], true));
  assert.equal(stairsCalls.find((call) => call.method === "POST").body.patch.cubes[0].stepCount, 5);
});

test("camera compound helpers require explicit derivation and preserve unrelated fields", async () => {
  const project = {
    ...defaultVCameraProject(),
    actors: [actor],
    cameras: [{ ...camera, motionPreset: "orbit_left", lookAtPoint: [9, 9, 9] }],
  };
  await assert.rejects(() => handleVCameraCommand(mutationApi(project, []), "https://miraivfx.art", [
    "camera", "follow", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--actor", actor.id, "--dry-run",
  ], false), /requires --offset/);

  const calls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(project, calls), "https://miraivfx.art", [
    "camera", "follow", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--actor", actor.id, "--offset", "0,2,4", "--yes", "--json",
  ], true));
  const followed = calls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.equal(followed.motionPreset, "orbit_left");
  assert.deepEqual(followed.lookAtPoint, [9, 9, 9]);

  const aimCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(project, aimCalls), "https://miraivfx.art", [
    "camera", "aim", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--manual", "--yes", "--json",
  ], true));
  const aimed = aimCalls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.equal(aimed.aimMode, "manual");
  assert.equal(aimed.trackingActorId, null);
  assert.deepEqual(aimed.lookAtPoint, [9, 9, 9]);
});

test("prop optional primitive fields can be cleared explicitly", async () => {
  const stairs = {
    id: "stairs-1",
    name: "Stairs",
    position: [0, 0.375, 0],
    rotation: [0, 0, 0],
    scale: [1.6, 0.75, 1.4],
    visible: true,
    locked: false,
    sourceType: "primitive",
    propPreset: "stairs",
    stepCount: 5,
    pathPoints: [],
  };
  const calls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi({
    ...defaultVCameraProject(), cubes: [stairs],
  }, calls), "https://miraivfx.art", [
    "prop", "set", "--canvas-id", "canvas-1", "--prop", stairs.id,
    "--clear-preset", "--clear-steps", "--yes", "--json",
  ], true));
  const updated = calls.find((call) => call.method === "POST").body.patch.cubes[0];
  assert.equal("propPreset" in updated, false);
  assert.equal("stepCount" in updated, false);
});

test("camera preset creates globally timed editable paths and expands project duration", async () => {
  const calls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi({
    ...defaultVCameraProject(),
    actors: [actor],
    cameras: [camera],
    activeCameraId: camera.id,
  }, calls), "https://miraivfx.art", [
    "camera", "preset", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--actor", actor.id, "--preset", "push_in", "--start-time", "8", "--duration", "5",
    "--yes", "--json",
  ], true));
  const patch = calls.find((call) => call.method === "POST").body.patch;
  assert.deepEqual(patch.cameras[0].pathPoints.map((point) => point.time), [8, 13]);
  assert.equal(patch.cameras[0].motionPreset, "push_in");
  assert.equal(patch.duration, 13);
});

test("camera presets sample actor motion with the same eased cubic path used by the node", () => {
  const movingActor = {
    ...actor,
    pathPoints: [
      { id: "p1", time: 10, position: [10, 0, 0], easing: "smooth" },
      { id: "p2", time: 20, position: [0, 0, 0], easing: "smooth" },
    ],
  };
  const input = {
    preset: "push_in",
    camera,
    startTime: 5,
    duration: 2,
    easing: "smooth",
    amountScale: 1,
    preserveSubjectScale: true,
  };
  const movingPatch = createCameraPresetPatch({ ...input, actor: movingActor });
  const expectedPatch = createCameraPresetPatch({
    ...input,
    actor: { ...actor, position: [5.625, 0, 0] },
  });

  assert.deepEqual(
    movingPatch.pathPoints.map((point) => point.position),
    expectedPatch.pathPoints.map((point) => point.position),
  );
});

test("orbit preset offsets every generated keyframe and tracking presets do not fake zero-time points", async () => {
  const orbitCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi({
    ...defaultVCameraProject(),
    actors: [actor],
    cameras: [camera],
  }, orbitCalls), "https://miraivfx.art", [
    "camera", "preset", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--actor", actor.id, "--preset", "orbit_left", "--start-time", "8", "--duration", "5",
    "--yes", "--json",
  ], true));
  const orbit = orbitCalls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.equal(orbit.pathPoints[0].time, 8);
  assert.equal(orbit.pathPoints.at(-1).time, 13);
  assert.ok(orbit.pathPoints.every((point) => point.time >= 8));

  const trackingCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi({
    ...defaultVCameraProject(),
    actors: [actor],
    cameras: [camera],
  }, trackingCalls), "https://miraivfx.art", [
    "camera", "preset", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--actor", actor.id, "--preset", "fixed_tracking", "--start-time", "8", "--duration", "5",
    "--yes", "--json",
  ], true));
  const tracking = trackingCalls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.deepEqual(tracking.pathPoints, []);
  assert.equal(tracking.movementMode, "static");
  assert.equal(tracking.aimMode, "actor");
});

test("action markers and visibility keyframes update in place", async () => {
  const prop = {
    id: "prop-1",
    name: "Reference",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    sourceType: "primitive",
    propPreset: "box",
    visibilityKeyframes: [{ id: "visibility-1", time: 2, visible: true }],
    pathPoints: [],
  };
  const markedActor = {
    ...actor,
    actionMarkers: [{ id: "action-1", time: 1, action: "wait", targetPoint: [0, 0, 0] }],
  };
  const base = { ...defaultVCameraProject(), actors: [markedActor], cubes: [prop] };

  const actionCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(base, actionCalls), "https://miraivfx.art", [
    "actor", "action", "set", "--canvas-id", "canvas-1", "--actor", actor.id,
    "--marker", "action-1", "--time", "3.25", "--action", "turn_head",
    "--clear-target-point", "--yes", "--json",
  ], true));
  const marker = actionCalls.find((call) => call.method === "POST").body.patch.actors[0].actionMarkers[0];
  assert.equal(marker.id, "action-1");
  assert.equal(marker.time, 3.25);
  assert.equal(marker.action, "turn_head");
  assert.equal("targetPoint" in marker, false);

  const visibilityCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(base, visibilityCalls), "https://miraivfx.art", [
    "prop", "visibility", "set", "--canvas-id", "canvas-1", "--prop", prop.id,
    "--keyframe", "visibility-1", "--time", "4.125", "--visible", "false", "--yes", "--json",
  ], true));
  const keyframe = visibilityCalls.find((call) => call.method === "POST").body.patch.cubes[0].visibilityKeyframes[0];
  assert.equal(keyframe.id, "visibility-1");
  assert.equal(keyframe.time, 4.125);
  assert.equal(keyframe.visible, false);
});

test("path update preserves IDs and camera keyframe fields are independently clearable", async () => {
  const project = {
    ...defaultVCameraProject(),
    cameras: [{
      ...camera,
      pathPoints: [{ id: "camera-point", time: 8, position: [0, 1.6, 6], fov: 35, focusDistance: 5 }],
    }],
  };
  const calls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(project, calls), "https://miraivfx.art", [
    "camera", "path", "update", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--point", "camera-point", "--time", "8.125", "--position", "1,2,3",
    "--fov", "50", "--clear-focus-distance", "--yes", "--json",
  ], true));
  const point = calls.find((call) => call.method === "POST").body.patch.cameras[0].pathPoints[0];
  assert.equal(point.id, "camera-point");
  assert.equal(point.time, 8.125);
  assert.equal(point.fov, 50);
  assert.equal("focusDistance" in point, false);
});

test("cut set can attach and explicitly clear an actor path anchor", async () => {
  const pathActor = { ...actor, pathPoints: [{ id: "point-1", time: 6.5, position: [1, 0, 2] }] };
  const cut = { id: "cut-1", time: 2, cameraId: camera.id };
  const base = { ...defaultVCameraProject(), actors: [pathActor], cameras: [camera], cameraCuts: [cut] };
  const anchorCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi(base, anchorCalls), "https://miraivfx.art", [
    "cut", "set", "--canvas-id", "canvas-1", "--cut", cut.id,
    "--actor", actor.id, "--point", "point-1", "--yes", "--json",
  ], true));
  const anchored = anchorCalls.find((call) => call.method === "POST").body.patch.cameraCuts[0];
  assert.equal(anchored.time, 6.5);
  assert.equal(anchored.anchor.pointId, "point-1");

  const clearCalls = [];
  await withMutedConsole(() => handleVCameraCommand(mutationApi({ ...base, cameraCuts: [anchored] }, clearCalls), "https://miraivfx.art", [
    "cut", "set", "--canvas-id", "canvas-1", "--cut", cut.id,
    "--time", "7", "--clear-anchor", "--yes", "--json",
  ], true));
  const cleared = clearCalls.find((call) => call.method === "POST").body.patch.cameraCuts[0];
  assert.equal(cleared.time, 7);
  assert.equal(cleared.anchor, undefined);
});

test("anchored cuts derive their time from the actor path point", async () => {
  const pathActor = { ...actor, pathPoints: [{ id: "point-1", time: 3.375, position: [1, 0, 2] }] };
  const project = { ...defaultVCameraProject(), actors: [pathActor], cameras: [camera] };
  const calls = [];
  const api = mutationApi(project, calls);
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "cut", "add", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--actor", actor.id, "--point", "point-1", "--yes", "--json",
  ], true));

  const cut = calls.find((call) => call.method === "POST").body.patch.cameraCuts[0];
  assert.equal(cut.time, 3.375);
  assert.equal(cut.anchor.pointId, "point-1");
});

test("revision conflicts fail without retrying or overwriting", async () => {
  let postCount = 0;
  const project = { ...defaultVCameraProject(), actors: [actor] };
  const api = {
    ...mutationApi(project, []),
    async postJson() {
      postCount += 1;
      throw new Error("HTTP 409 revision_conflict");
    },
  };
  await assert.rejects(() => withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "actor", "set", "--canvas-id", "canvas-1", "--actor", actor.id, "--name", "Hero", "--yes",
  ], false)), /revision_conflict/);
  assert.equal(postCount, 1);
});

function mutationApi(project, calls) {
  return {
    async getJson(path) {
      calls.push({ method: "GET", path });
      return {
        success: true,
        data: {
          id: "canvas-1",
          project_id: "project-1",
          name: "Canvas",
          revision: 12,
          nodes: [{ id: "vcamera-node", type: "v-camera", data: { vCameraProject: project } }],
        },
      };
    },
    async postJson(path, body) {
      calls.push({ method: "POST", path, body });
      return {
        success: true,
        data: {
          canvas_id: "canvas-1",
          project_id: "project-1",
          node_id: "vcamera-node",
          revision: 13,
          clientModifiedAt: 1234,
          changedFields: Object.keys(body.patch),
        },
      };
    },
  };
}

async function withMutedConsole(callback) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    await callback();
  } finally {
    console.log = originalLog;
  }
}
