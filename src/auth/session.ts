export interface AuthSession {
  accessToken: string;
  expiresAt?: string;
  userLabel?: string;
}

export async function loadSession(): Promise<AuthSession | null> {
  // TODO: Replace with OS keychain or encrypted local store.
  return null;
}
