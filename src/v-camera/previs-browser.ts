import { chromium, type Browser } from 'playwright-core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { VCameraProject } from './project.js';

export type PrevisBrowserOptions = { appUrl: string; browserPath?: string; width: number; height: number };

function executablePath(explicit?: string) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Browser executable not found: ${explicit}`);
    return explicit;
  }
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((value): value is string => Boolean(value));
  const candidates = [
    ...roots.flatMap((root) => [join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')]),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  const result = candidates.find(existsSync);
  if (!result) throw new Error('No Chromium browser found. Supply --browser-path. No browser is downloaded automatically.');
  return result;
}

export async function openPrevisBrowser(project: VCameraProject, options: PrevisBrowserOptions) {
  const url = new URL('/v-camera/previs?automation=1', options.appUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('--app-url must be an HTTP(S) app origin without credentials');
  for (const value of [options.width, options.height]) {
    if (!Number.isInteger(value) || value < 64 || value > 3840 || value % 2 !== 0) throw new Error('Width and height must be even integers between 64 and 3840');
  }
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath: executablePath(options.browserPath), headless: true });
    // Fresh isolated context. Never reuse the user's browser profile or send API credentials to this page.
    const page = await browser.newPage({ viewport: { width: options.width, height: options.height }, deviceScaleFactor: 1, acceptDownloads: true });
    page.setDefaultTimeout(65000);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => (window as any).mirVCameraPrevis?.version === 1, undefined, { timeout: 60000 });
    } catch {
      throw new Error(`Previs bridge unavailable at ${url.origin}. Run the updated frontend and pass --app-url; a published older frontend cannot render this scene.`);
    }
    await page.evaluate(async (scene) => (window as any).mirVCameraPrevis.load(scene), project);
    return { browser, page, url: url.href };
  } catch (error) {
    await browser?.close();
    throw error;
  }
}
