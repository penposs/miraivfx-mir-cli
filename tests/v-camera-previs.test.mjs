import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileScenePlan } from '../dist/v-camera/scene-plan.js';
import { validateSceneMotion } from '../dist/v-camera/scene-validation.js';
import { normalizeCompleteSceneProject } from '../dist/v-camera/project.js';
import { interpolatePathPosition } from '../dist/v-camera/path-interpolation.js';

const plan = JSON.parse(await readFile(new URL('../examples/v-camera-spatial-plan.json', import.meta.url), 'utf8'));
const exec = promisify(execFile);

test('spatial plan compiles to a canonical atomic scene with stable IDs and a terminal hold', () => {
  const first = compileScenePlan(plan), second = compileScenePlan(plan);
  assert.deepEqual(first, second);
  const scene = normalizeCompleteSceneProject(first.scene);
  assert.equal(scene.duration, 12);
  assert.equal(scene.actors.length, 2);
  assert.equal(scene.shots.at(-1).endTime, 12);
  assert.deepEqual(interpolatePathPosition(scene.actors[0], 10), [-0.4, 0, -4]);
  assert.equal(first.report.groups.length, 4);
  assert.ok(scene.cubes.some((prop) => prop.id === 'table_top'));
});

test('generated doorway stays open to both actors and the moving camera', () => {
  const { scene } = compileScenePlan(plan);
  const result = validateSceneMotion(normalizeCompleteSceneProject(scene));
  assert.equal(result.passed, true, JSON.stringify(result.issues));
});

test('validation detects a wall collision during the route, not only at the base pose', () => {
  const input = structuredClone(plan);
  input.props.push({ id: 'block', preset: 'thin_wall', position: [0, 1.5, 0], size: [8, 3, 0.2] });
  const { scene } = compileScenePlan(input);
  const result = validateSceneMotion(normalizeCompleteSceneProject(scene));
  const issue = result.issues.find((issue) => issue.entityId === 'lead' && issue.otherId === 'block');
  assert.ok(issue);
  assert.ok(issue.startTime > 3 && issue.endTime < 5);
});

test('compile rejects ambiguous or impossible source data rather than dropping it', () => {
  for (const mutate of [
    (p) => { p.units = 'pixel'; },
    (p) => { p.actors[0].position = 'missing'; },
    (p) => { p.rooms[0].doors[0].width = 30; },
    (p) => { p.actors[0].route[1].time = 0; },
    (p) => { p.actors[0].route[0].position = [50, 0, 0]; },
    (p) => { p.duration = 4; },
    (p) => { p.actors[0].unsupported = true; },
  ]) {
    const input = structuredClone(plan); mutate(input);
    assert.throws(() => compileScenePlan(input));
  }
});

test('pose compilation uses actor height when resolving a seated pose', () => {
  const input = structuredClone(plan);
  input.actors[0].height = 2;
  input.actors[0].poses = [{ time: 10, preset: 'sit_neutral', parameters: { seatHeight: 0.5 } }];
  const { scene } = compileScenePlan(input);
  assert.equal(scene.actors[0].poseKeyframes[0].pose.rootOffset[1], -0.56);
});

test('CLI compiles offline, refuses overwrite, and reports local validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mir-previs-test-'));
  const out = join(dir, 'scene.json');
  const args = ['dist/cli.js', 'canvas', 'v-camera', 'scene', 'compile', '--file', 'examples/v-camera-spatial-plan.json', '--out', out, '--json'];
  const result = JSON.parse((await exec(process.execPath, args)).stdout);
  assert.equal(result.ok, true);
  await assert.rejects(exec(process.execPath, args), /Output exists/);
  const check = JSON.parse((await exec(process.execPath, ['dist/cli.js', 'canvas', 'v-camera', 'scene', 'validate', '--file', out, '--json'])).stdout);
  assert.equal(check.passed, true);
});

test('smooth trajectories retain the same timing as the frontend between waypoints', () => {
  assert.deepEqual(interpolatePathPosition({ position: [0, 0, 0], pathPoints: [
    { id: 'a', time: 0, position: [0, 0, 0], easing: 'smooth' },
    { id: 'b', time: 4, position: [4, 0, 0], easing: 'smooth' },
  ] }, 1), [1, 0, 0]);
});

test('scene compile/apply roundtrip retains actor orientation and timed performance clips', () => {
  const input = structuredClone(plan);
  input.actors[0].orientationMode = 'custom';
  input.actors[0].actions = [{ actionId: 'natural_walk', startTime: 0, endTime: 8, speed: 0.7 }];
  const { scene } = compileScenePlan(input);
  const loaded = normalizeCompleteSceneProject(scene);
  assert.equal(loaded.actors[0].orientationMode, 'custom');
  assert.equal(loaded.actors[0].performanceClips[0].actionId, 'natural_walk');
  assert.equal(loaded.actors[0].performanceClips[0].speed, 0.7);
  input.actors[0].actions.push({ actionId: 'natural_run', startTime: 4, endTime: 10 });
  assert.throws(() => compileScenePlan(input), /overlap/);
});
