import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function privatePermissions(path: string, directory = false): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  // Set the complete DACL, not a best-effort chmod or an additive grant.
  // No path or credential is interpolated into PowerShell source.
  const script = `
$ErrorActionPreference = 'Stop'
$target = $env:MIRAIVFX_PRIVATE_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$inherit = if ($env:MIRAIVFX_PRIVATE_DIRECTORY -eq '1') { 'OICI' } else { '' }
$acl = if ($env:MIRAIVFX_PRIVATE_DIRECTORY -eq '1') {
  [System.IO.Directory]::GetAccessControl($target)
} else {
  [System.IO.File]::GetAccessControl($target)
}
$sddl = 'D:P(A;' + $inherit + ';FA;;;SY)(A;' + $inherit + ';FA;;;BA)(A;' + $inherit + ';FA;;;' + $sid + ')'
$acl.SetSecurityDescriptorSddlForm($sddl, [System.Security.AccessControl.AccessControlSections]::Access)
if ($env:MIRAIVFX_PRIVATE_DIRECTORY -eq '1') {
  [System.IO.Directory]::SetAccessControl($target, $acl)
} else {
  [System.IO.File]::SetAccessControl($target, $acl)
}
`;
  try {
    await execFileAsync(
      join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: 15_000,
        env: { ...process.env, MIRAIVFX_PRIVATE_PATH: path, MIRAIVFX_PRIVATE_DIRECTORY: directory ? "1" : "0" },
      },
    );
  } catch {
    throw new Error("Cannot secure CLI credential permissions. Use a private directory owned by your Windows account.");
  }
}

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("CLI credential directory must be a regular private directory.");
  }
  const entries = await readdir(path);
  if (entries.some((name) => name !== "session.json" && !/^\.session-[0-9a-f-]+\.tmp$/.test(name))) {
    throw new Error("MIRAIVFX_CONFIG_DIR must be a dedicated CLI credential directory; it contains unrelated files.");
  }
  await privatePermissions(path, true);
}

export async function assertPrivateFileTarget(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error("CLI credential file must be a regular file without links.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
