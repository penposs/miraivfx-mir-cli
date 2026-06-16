export interface AuthSession {
  accessToken: string;
  expiresAt?: string;
  userLabel?: string;
}

export async function loadSession(): Promise<AuthSession | null> {
  // TODO: Replace with OS keychain or encrypted local store.
  // During API integration, MIRAIVFX_TOKEN is the only supported local source.
  // Agents must not ask users to paste this token into chat.
  if (process.env.MIRAIVFX_TOKEN) {
    return {
      accessToken: process.env.MIRAIVFX_TOKEN,
      userLabel: "env:MIRAIVFX_TOKEN",
    };
  }
  return null;
}
