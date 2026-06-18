import { spawn } from "node:child_process";

export interface OpenUrlOptions {
  browser?: string;
  browserCommand?: string;
}

export async function openUrl(url: string, options: OpenUrlOptions = {}): Promise<void> {
  if (options.browserCommand) {
    await spawnShellDetached(buildBrowserCommand(options.browserCommand, url));
    return;
  }

  const platform = process.platform;
  const browser = normalizeBrowserName(options.browser);
  const { command, args } = browser
    ? getBrowserCommand(platform, browser, url)
    : getDefaultOpenCommand(platform, url);

  await spawnDetached(command, args);
}

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function spawnShellDetached(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      detached: true,
      shell: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function buildBrowserCommand(command: string, url: string): string {
  return command.includes("{url}") ? command.replaceAll("{url}", shellQuote(url)) : `${command} ${shellQuote(url)}`;
}

function shellQuote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function getDefaultOpenCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "win32") {
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

function getBrowserCommand(
  platform: NodeJS.Platform,
  browser: string,
  url: string,
): { command: string; args: string[] } {
  if (platform === "darwin") {
    const appName = browserAppNames[browser] ?? browser;
    return { command: "open", args: ["-a", appName, url] };
  }

  const executable = browserExecutables[browser] ?? browser;
  if (platform === "win32") {
    return { command: "cmd.exe", args: ["/c", "start", "", executable, url] };
  }

  return { command: executable, args: [url] };
}

function normalizeBrowserName(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "default") return undefined;
  return normalized;
}

const browserExecutables: Record<string, string> = {
  edge: "msedge",
  msedge: "msedge",
  chrome: "chrome",
  googlechrome: "chrome",
  "google-chrome": "google-chrome",
  chromium: "chromium",
  firefox: "firefox",
};

const browserAppNames: Record<string, string> = {
  edge: "Microsoft Edge",
  msedge: "Microsoft Edge",
  chrome: "Google Chrome",
  googlechrome: "Google Chrome",
  "google-chrome": "Google Chrome",
  chromium: "Chromium",
  firefox: "Firefox",
  safari: "Safari",
};
