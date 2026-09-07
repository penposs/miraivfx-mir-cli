import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { getFlagValue, hasFlag } from '../core/args.js';
import { json, text } from '../core/output.js';
import { loadRuntimeConfig } from '../core/config.js';
import { ApiClient } from '../api/client.js';
import { compileScenePlan } from '../v-camera/scene-plan.js';
import { validateSceneMotion } from '../v-camera/scene-validation.js';
import { normalizeProject, isRecord, type VCameraProject } from '../v-camera/project.js';

export const LOCAL_SCENE_COMMANDS = ['compile', 'validate', 'sample', 'capture', 'render'] as const;
const flag = (args: string[], name: string) => {
  const result = getFlagValue(args, name);
  if (!result) throw new Error(`${name} is required`);
  return result;
};
const numeric = (args: string[], name: string, fallback: number) => {
  const raw = getFlagValue(args, name);
  const result = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(result)) throw new Error(`${name} must be finite`);
  return result;
};
async function sourceProject(args: string[]): Promise<VCameraProject> {
  const file = getFlagValue(args, '--file');
  const canvasId = getFlagValue(args, '--canvas-id');
  if (file && canvasId) throw new Error('Use either --file or --canvas-id/--node-id');
  if (file) {
    const source = JSON.parse(await readFile(file, 'utf8'));
    if (!isRecord(source) || !Array.isArray(source.cubes) || !Array.isArray(source.actors) || !Array.isArray(source.cameras)) throw new Error('Expected a scene export; run scene compile first for a spatial plan');
    return normalizeProject(source, { repairReferences: false });
  }
  if (!canvasId) throw new Error('--file or --canvas-id/--node-id is required');
  const nodeId = flag(args, '--node-id');
  const config = await loadRuntimeConfig();
  const api = new ApiClient({ baseUrl: config.apiBase, token: config.token });
  const response = await api.getJson<{ success: boolean; data?: { nodes?: unknown[] } }>(`/canvas/${encodeURIComponent(canvasId)}`);
  if (!response.success || !response.data) throw new Error('Unable to read canvas');
  const node = response.data.nodes?.find((item) => isRecord(item) && item.id === nodeId && item.type === 'v-camera');
  if (!isRecord(node) || !isRecord(node.data)) throw new Error('Virtual Shoot node not found');
  return normalizeProject(node.data.vCameraProject, { repairReferences: false });
}
async function outputFile(path: string, data: string | Uint8Array, overwrite: boolean) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { flag: overwrite ? 'w' : 'wx' });
}

export async function handleLocalSceneCommand(action: string, args: string[]) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    text('mir-cli canvas v-camera scene <compile|validate|sample|capture|render> --file <json>\ncompile --out <scene.json> [--report <report.json>]\nvalidate [--step 0.1]\nsample --times 0,2,4\ncapture --times 0,2,4 --out <directory> [--view camera|overview]\nrender --out <video.mp4|video.webm> [--start 0 --end <seconds> --fps 24]\nBrowser commands: --app-url <updated frontend origin> [--browser-path <Chromium executable>] [--width 1280 --height 720]\nSource may also be --canvas-id <id> --node-id <id>. Outputs never overwrite unless --overwrite is passed.');
    return;
  }
  const asJson = hasFlag(args, '--json');
  const overwrite = hasFlag(args, '--overwrite');
  if (action === 'compile') {
    const result = compileScenePlan(JSON.parse(await readFile(flag(args, '--file'), 'utf8')));
    const out = resolve(flag(args, '--out'));
    const report = getFlagValue(args, '--report');
    if (report && resolve(report) === out) throw new Error('Scene and report outputs must be different files');
    if (!overwrite && [out, ...(report ? [resolve(report)] : [])].some(existsSync)) throw new Error('Output exists; choose another path or use --overwrite');
    await outputFile(out, `${JSON.stringify(result.scene, null, 2)}\n`, overwrite);
    if (report) await outputFile(resolve(report), `${JSON.stringify(result.report, null, 2)}\n`, overwrite);
    const payload = { ok: true, operation: 'scene.compile', file: out, report: report ? resolve(report) : null, counts: { props: result.scene.cubes.length, actors: result.scene.actors.length, cameras: result.scene.cameras.length }, warnings: result.report.warnings };
    asJson ? json(payload) : text(`Compiled scene: ${out}`);
    return;
  }
  const project = await sourceProject(args);
  if (action === 'validate') {
    const result = validateSceneMotion(project, numeric(args, '--step', 0.1));
    asJson ? json(result) : text(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 2;
    return;
  }
  const view = getFlagValue(args, '--view') ?? 'camera';
  if (view !== 'camera' && view !== 'overview') throw new Error('--view must be camera or overview');
  const cameraId = getFlagValue(args, '--camera');
  if (cameraId && !project.cameras.some((camera) => camera.id === cameraId)) throw new Error('--camera must be an existing camera ID');
  const times = (getFlagValue(args, '--times') ?? getFlagValue(args, '--time') ?? '0').split(',').map(Number);
  if (!times.length || times.length > 120 || times.some((time) => !Number.isFinite(time) || time < 0 || time > project.duration)) throw new Error('--times must contain 1..120 scene times within duration');
  const start = numeric(args, '--start', 0), end = numeric(args, '--end', project.duration), fps = numeric(args, '--fps', Math.min(60, project.fps));
  const timeout = numeric(args, '--timeout', 300);
  if (timeout < 1 || timeout > 3600) throw new Error('--timeout must be between 1 and 3600 seconds');
  const out = action === 'sample' ? undefined : resolve(flag(args, '--out'));
  const format = out ? extname(out).slice(1).toLowerCase() : '';
  if (action === 'render' && (start < 0 || end <= start || end > project.duration || !Number.isInteger(fps) || fps < 1 || fps > 60 || Math.ceil((end - start) * fps) > 18000 || !['mp4', 'webm'].includes(format))) throw new Error('Invalid render range/fps or output extension; use .mp4 or .webm and at most 18,000 frames');
  if (action === 'render' && out && existsSync(out) && !overwrite) throw new Error('Output exists; choose another path or use --overwrite');
  const files = out && action === 'capture' ? times.map((time, index) => join(out, `${String(index).padStart(3, '0')}-${time.toFixed(3)}-${view}.png`)) : [];
  if (!overwrite && files.some(existsSync)) throw new Error('Capture output exists; choose another directory or use --overwrite');
  const config = await loadRuntimeConfig();
  const width = numeric(args, '--width', project.safeFrameRatio === '9:16' ? 720 : 1280);
  const height = numeric(args, '--height', project.safeFrameRatio === '9:16' ? 1280 : project.safeFrameRatio === '1:1' ? width : 720);
  const { openPrevisBrowser } = await import('../v-camera/previs-browser.js');
  const { page, browser } = await openPrevisBrowser(project, { appUrl: getFlagValue(args, '--app-url') ?? config.appBase, browserPath: getFlagValue(args, '--browser-path'), width, height });
  const abort = () => { void browser.close(); };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    if (action === 'render') {
      if (cameraId || view !== 'camera') throw new Error('scene render follows the scene camera cuts; --camera and --view are capture/sample options');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: { url: string; duration: number; frames: number };
      try {
        result = await Promise.race([
          page.evaluate(async (options) => (window as any).mirVCameraPrevis.render(options), { start, end, fps, format }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Previs export timed out; no output video was written. Increase --timeout for long scenes.')), timeout * 1000); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
      const downloadPromise = page.waitForEvent('download');
      await page.evaluate(({ url, filename }) => { const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); }, { url: result.url, filename: `previs.${format}` });
      const download = await downloadPromise;
      if (await download.failure()) throw new Error(`Video download failed: ${await download.failure()}`);
      await mkdir(dirname(out!), { recursive: true });
      // Read the completed temporary download before writing the requested artifact exclusively.
      const path = await download.path();
      if (!path) throw new Error('Video download has no completed file');
      await outputFile(out!, await readFile(path), overwrite);
      const payload = { ok: true, file: out, format, duration: result.duration, frames: result.frames, width, height, fps };
      asJson ? json(payload) : text(`Rendered ${result.frames} frames: ${out}`);
    } else {
      const results = [];
      for (const [index, time] of times.entries()) {
        if (action === 'sample') {
          results.push(await page.evaluate(async ({ time, cameraId, view }) => (window as any).mirVCameraPrevis.sample(time, { cameraId, view }), { time, cameraId, view }));
        } else {
          const result = await page.evaluate(async ({ time, cameraId, view }) => (window as any).mirVCameraPrevis.capture(time, { cameraId, view }), { time, cameraId, view });
          const prefix = 'data:image/png;base64,';
          if (!result.dataUrl.startsWith(prefix)) throw new Error('Renderer did not return a PNG');
          await outputFile(files[index], Buffer.from(result.dataUrl.slice(prefix.length), 'base64'), overwrite);
          results.push({ file: files[index], sample: result.sample, width: result.width, height: result.height });
        }
      }
      const payload = { ok: true, operation: `scene.${action}`, results };
      asJson ? json(payload) : text(JSON.stringify(payload, null, 2));
    }
  } finally {
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    await browser.close();
  }
}
