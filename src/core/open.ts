import { spawn } from "node:child_process";

export async function openUrl(url: string): Promise<void> {
  const platform = process.platform;
  const command =
    platform === "win32"
      ? "cmd"
      : platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

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
