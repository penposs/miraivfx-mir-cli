import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { assertPrivateFileTarget, privateDirectory, privatePermissions } from "./private-file.js";

export interface AuthSession {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  userLabel?: string;
  tokenType?: string;
}

export async function loadSession(): Promise<AuthSession | null> {
  if (process.env.MIRAIVFX_TOKEN) {
    return {
      accessToken: process.env.MIRAIVFX_TOKEN,
      userLabel: "env:MIRAIVFX_TOKEN",
    };
  }
  try {
    const target = sessionPath();
    await lstat(target);
    await assertPrivateFileTarget(target);
    await privateDirectory(dirname(target));
    await privatePermissions(target);
    const raw = await readFile(target, "utf8");
    const session = JSON.parse(raw) as AuthSession;
    if (!session.accessToken && !session.idToken) return null;
    return session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function saveSession(session: AuthSession): Promise<void> {
  const target = sessionPath();
  await assertPrivateFileTarget(target);
  await privateDirectory(dirname(target));
  const temporary = join(dirname(target), `.session-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    // Permissions are in place before a single credential byte is written.
    await privatePermissions(temporary);
    await handle.writeFile(`${JSON.stringify(session, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, target);
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}

export async function clearSession(): Promise<void> {
  await rm(sessionPath(), { force: true });
}

export function sessionPath(): string {
  const base = process.env.MIRAIVFX_CONFIG_DIR || join(homedir(), ".miraivfx", "mir-cli");
  return join(base, "session.json");
}

export function isSessionExpired(session: AuthSession | null): boolean {
  if (!session?.expiresAt) return false;
  return Date.parse(session.expiresAt) <= Date.now() + 30_000;
}

export function decodeJwtSubject(token?: string): string | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      email?: string;
      name?: string;
      sub?: string;
    };
    return payload.email || payload.name || payload.sub;
  } catch {
    return undefined;
  }
}
