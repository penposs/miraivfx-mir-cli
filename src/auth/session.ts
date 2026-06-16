import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

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
    const raw = await readFile(sessionPath(), "utf8");
    const session = JSON.parse(raw) as AuthSession;
    if (!session.accessToken && !session.idToken) return null;
    return session;
  } catch {
    return null;
  }
}

export async function saveSession(session: AuthSession): Promise<void> {
  const target = sessionPath();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  try {
    await chmod(target, 0o600);
  } catch {
    // Best effort on Windows.
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
