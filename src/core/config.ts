import { loadSession } from "../auth/session.js";

export interface RuntimeConfig {
  apiBase: string;
  appBase: string;
  authEndpoint: string;
  authClientId: string;
  authRedirectUri: string;
  token?: string;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const apiBase = normalizeBaseUrl(
    process.env.MIRAIVFX_API_BASE || "https://api.miraivfx.art/api",
  );
  const appBase = normalizeBaseUrl(
    process.env.MIRAIVFX_APP_BASE || "https://miraivfx.art",
  );
  const authEndpoint = normalizeBaseUrl(
    process.env.MIRAIVFX_LOGTO_ENDPOINT || process.env.MIRAIVFX_AUTH_ENDPOINT || "https://auth.miraivfx.art",
  );
  const authClientId =
    process.env.MIRAIVFX_LOGTO_APP_ID || process.env.MIRAIVFX_AUTH_CLIENT_ID || "kdj75szqjfbqcn6pzbtzu";
  const authRedirectUri =
    process.env.MIRAIVFX_AUTH_REDIRECT_URI || "http://127.0.0.1:39173/callback";
  const session = await loadSession();
  const token = process.env.MIRAIVFX_TOKEN || session?.idToken || session?.accessToken;

  return {
    apiBase,
    appBase,
    authEndpoint,
    authClientId,
    authRedirectUri,
    ...(token ? { token } : {}),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
