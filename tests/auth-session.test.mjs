import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { link, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadSession, saveSession, sessionPath } from "../dist/auth/session.js";

const execFileAsync = promisify(execFile);

async function isolated(run) {
  const prefix = join(tmpdir(), "mir-cli-session-test-");
  const directory = await mkdtemp(prefix);
  const previous = process.env.MIRAIVFX_CONFIG_DIR;
  const token = process.env.MIRAIVFX_TOKEN;
  process.env.MIRAIVFX_CONFIG_DIR = directory;
  delete process.env.MIRAIVFX_TOKEN;
  try { await run(directory); } finally {
    if (previous === undefined) delete process.env.MIRAIVFX_CONFIG_DIR;
    else process.env.MIRAIVFX_CONFIG_DIR = previous;
    if (token === undefined) delete process.env.MIRAIVFX_TOKEN;
    else process.env.MIRAIVFX_TOKEN = token;
    assert.ok(resolve(directory).startsWith(resolve(prefix)));
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertRestricted(path, directory = false) {
  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, directory ? 0o700 : 0o600);
    return;
  }
  const { stdout } = await execFileAsync(
    join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", `
$a = if ($env:MIRAIVFX_TEST_ACL_DIRECTORY -eq '1') {
  [System.IO.Directory]::GetAccessControl($env:MIRAIVFX_TEST_ACL_PATH)
} else {
  [System.IO.File]::GetAccessControl($env:MIRAIVFX_TEST_ACL_PATH)
}
$allowed = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
$rules = $a.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
@{ protected=$a.AreAccessRulesProtected; unexpected=@($rules | Where-Object { $_.IdentityReference.Value -notin $allowed }).Count } | ConvertTo-Json -Compress
`],
    { windowsHide: true, env: { ...process.env, MIRAIVFX_TEST_ACL_PATH: path, MIRAIVFX_TEST_ACL_DIRECTORY: directory ? "1" : "0" } },
  );
  const acl = JSON.parse(stdout.trim());
  assert.equal(acl.protected, true);
  assert.equal(acl.unexpected, 0);
}

test("session writes remain complete and restrict credentials to the current account", async () => {
  await isolated(async (directory) => {
    await saveSession({ accessToken: "synthetic-first", refreshToken: "synthetic-refresh" });
    await saveSession({ accessToken: "synthetic-second", idToken: "synthetic-id" });
    assert.equal((await loadSession()).accessToken, "synthetic-second");
    assert.deepEqual(await readdir(directory), ["session.json"]);
    await assertRestricted(sessionPath());
    await assertRestricted(directory, true);
  });
});

test("loading legacy credentials repairs permissions without changing their contents", async () => {
  await isolated(async (directory) => {
    const data = JSON.stringify({ accessToken: "synthetic-legacy" });
    await writeFile(sessionPath(), data, { mode: 0o644 });
    assert.equal((await loadSession()).accessToken, "synthetic-legacy");
    assert.equal(await readFile(sessionPath(), "utf8"), data);
    await assertRestricted(sessionPath());
    await assertRestricted(directory, true);
  });
});

test("linked credential files are rejected without overwriting the linked data", async () => {
  await isolated(async (directory) => {
    const other = join(directory, "other.json");
    await writeFile(other, "unchanged");
    await link(other, sessionPath());
    await assert.rejects(loadSession, /without links/);
    await assert.rejects(() => saveSession({ accessToken: "synthetic" }), /without links/);
    assert.equal(await readFile(other, "utf8"), "unchanged");
  });
});

test("a shared configuration directory is rejected before storing credentials", async () => {
  await isolated(async (directory) => {
    await writeFile(join(directory, "user-document.txt"), "preserve this");
    await assert.rejects(() => saveSession({ accessToken: "synthetic" }), /dedicated CLI credential directory/);
    assert.deepEqual(await readdir(directory), ["user-document.txt"]);
    assert.equal(await readFile(join(directory, "user-document.txt"), "utf8"), "preserve this");
  });
});
