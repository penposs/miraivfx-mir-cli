import { loadSession } from "../auth/session.js";

export interface RuntimeConfig {
  apiBase: string;
  appBase: string;
  token?: string;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const apiBase = normalizeBaseUrl(
    process.env.MIRAIVFX_API_BASE || "https://miraivfx.com/api",
  );
  const appBase = normalizeBaseUrl(
    process.env.MIRAIVFX_APP_BASE || apiBase.replace(/\/api\/?$/, ""),
  );
  const session = await loadSession();
  const token = process.env.MIRAIVFX_TOKEN || session?.accessToken;

  return {
    apiBase,
    appBase,
    ...(token ? { token } : {}),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
