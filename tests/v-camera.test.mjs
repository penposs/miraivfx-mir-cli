import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  createMotionPresetPatch,
  defaultVCameraProject,
  normalizeProject,
  parsePathPoints,
  resolveByIdOrName,
} from "../dist/v-camera/project.js";
import { handleVCameraCommand } from "../dist/commands/v-camera.js";

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
  assert.equal(project.duration, 30);
  assert.deepEqual(project.actors, []);
  assert.deepEqual(project.cameraCuts, []);
});

test("legacy cameras receive the current motion fields", () => {
  const project = normalizeProject({
    ...defaultVCameraProject(),
    cameras: [{ id: "legacy", name: "Legacy", position: [1, 2, 3], rotation: [0, 0, 0], fov: 40, duration: 3 }],
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

test("path JSON accepts millisecond precision and sorts by time", () => {
  const points = parsePathPoints(JSON.stringify([
    { time: 2.125, position: [2, 0.5, 3] },
    { id: "first", time: 0.025, position: [0, 0, 0], yaw: 12.5 },
  ]));
  assert.equal(points[0].id, "first");
  assert.equal(points[0].time, 0.025);
  assert.equal(points[1].time, 2.125);
});

test("push-in preset creates a playable camera path aimed at the actor", () => {
  const patch = createMotionPresetPatch({ preset: "push_in", camera, actor, duration: 6 });
  assert.equal(patch.movementMode, "path");
  assert.equal(patch.aimMode, "actor");
  assert.equal(patch.trackingActorId, "actor-1");
  assert.equal(patch.pathPoints.length, 2);
  assert.equal(patch.pathPoints[1].time, 6);
  assert.ok(patch.pathPoints[1].position[2] < camera.position[2]);
});

test("orbit preset creates a smooth seven-point half orbit", () => {
  const patch = createMotionPresetPatch({ preset: "orbit_right", camera, actor, duration: 8 });
  assert.equal(patch.movementMode, "path");
  assert.equal(patch.pathPoints.length, 7);
  assert.equal(patch.pathPoints[0].time, 0);
  assert.equal(patch.pathPoints[6].time, 8);
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

test("dry-run computes a camera preset without issuing a write", async () => {
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
      "camera", "preset", "--canvas-id", "canvas-1", "--camera", "camera-1",
      "--actor", "actor-1", "--preset", "orbit_left", "--duration", "7.5", "--dry-run",
    ], false);
  } finally {
    console.log = originalLog;
  }
  assert.equal(postCount, 0);
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
  ], false), /--steps must be an integer between 2 and 64/);
  await assert.rejects(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "prop", "set", "--canvas-id", "canvas-1", "--prop", stairs.id,
    "--steps", "2.5", "--dry-run",
  ], false), /--steps must be an integer between 2 and 64/);
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

test("camera follow derives its offset from the currently placed camera", async () => {
  const project = { ...defaultVCameraProject(), actors: [actor], cameras: [camera] };
  const calls = [];
  const api = mutationApi(project, calls);
  await withMutedConsole(() => handleVCameraCommand(api, "https://miraivfx.art", [
    "camera", "follow", "--canvas-id", "canvas-1", "--camera", camera.id,
    "--actor", actor.id, "--yes", "--json",
  ], true));

  const updated = calls.find((call) => call.method === "POST").body.patch.cameras[0];
  assert.deepEqual(updated.followOffset, [0, 1.6, 6]);
  assert.equal(updated.trackingActorId, actor.id);
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
