import { json, text } from "../core/output.js";
import { loadRuntimeConfig } from "../core/config.js";
import { loginWithPkce } from "../auth/oidc.js";
import { clearSession, isSessionExpired, loadSession, sessionPath } from "../auth/session.js";

export async function handleAuthCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = args.includes("--json");

  if (subcommand === "status") {
    const config = await loadRuntimeConfig();
    const session = await loadSession();
    const expired = isSessionExpired(session);
    const payload = {
      authenticated: Boolean(config.token) && !expired,
      expired,
      api_base: config.apiBase,
      app_base: config.appBase,
      auth_endpoint: config.authEndpoint,
      auth_client_id: maskClientId(config.authClientId),
      session_path: sessionPath(),
      user: session?.userLabel ?? null,
      token_source: process.env.MIRAIVFX_TOKEN ? "env:MIRAIVFX_TOKEN" : session ? "local_session" : null,
      next: config.token
        ? null
        : "Run mir-cli auth login.",
    };
    asJson
      ? json(payload)
      : text(payload.authenticated ? "Logged in with local credentials." : "Not logged in.");
    return;
  }

  if (subcommand === "login") {
    const config = await loadRuntimeConfig();
    const printUrl = args.includes("--print-url") || args.includes("--no-open");
    let authorizationUrl = "";
    if (printUrl) {
      const payload = await buildLoginPreview(config);
      asJson ? json(payload) : text(payload.authorization_url);
      return;
    }
    const session = await loginWithPkce({
      issuer: config.authEndpoint,
      clientId: config.authClientId,
      redirectUri: config.authRedirectUri,
      onAuthorizationUrl: (url) => {
        authorizationUrl = url;
      },
    });
    const payload = {
      ok: true,
      user: session.userLabel ?? null,
      expires_at: session.expiresAt ?? null,
      session_path: sessionPath(),
      authorization_url_opened: Boolean(authorizationUrl),
      security: "Session saved locally. Tokens are not printed.",
    };
    asJson ? json(payload) : text(`Logged in${session.userLabel ? ` as ${session.userLabel}` : ""}.`);
    return;
  }

  if (subcommand === "logout") {
    await clearSession();
    const payload = { ok: true, session_path: sessionPath() };
    asJson ? json(payload) : text("Logged out.");
    return;
  }

  text("Usage: mir-cli auth <status|login|logout>");
}

async function buildLoginPreview(config: {
  authEndpoint: string;
  authClientId: string;
  authRedirectUri: string;
}): Promise<{ authorization_url: string; redirect_uri: string; note: string }> {
  const discoveryUrl = `${config.authEndpoint.replace(/\/+$/, "")}/oidc/.well-known/openid-configuration`;
  const discoveryResponse = await fetch(discoveryUrl);
  if (!discoveryResponse.ok) {
    throw new Error(`Failed to load OIDC discovery: HTTP ${discoveryResponse.status}`);
  }
  const discovery = (await discoveryResponse.json()) as { authorization_endpoint: string };
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", config.authClientId);
  url.searchParams.set("redirect_uri", config.authRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile offline_access");
  url.searchParams.set("state", "<generated>");
  url.searchParams.set("code_challenge", "<generated>");
  url.searchParams.set("code_challenge_method", "S256");
  return {
    authorization_url: url.toString(),
    redirect_uri: config.authRedirectUri,
    note: "Preview only. Real login generates state and PKCE verifier and starts a local callback server.",
  };
}

function maskClientId(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
