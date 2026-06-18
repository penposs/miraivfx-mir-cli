import { json, text } from "../core/output.js";
import { loadRuntimeConfig } from "../core/config.js";
import { loginWithPkce } from "../auth/oidc.js";
import { clearSession, isSessionExpired, loadSession, sessionPath } from "../auth/session.js";
import { getFlagValue } from "../core/args.js";

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
      auth_client_configured: Boolean(config.authClientId),
      session_path: sessionPath(),
      user: session?.userLabel ?? null,
      token_source: process.env.MIRAIVFX_TOKEN ? "env:MIRAIVFX_TOKEN" : session ? "local_session" : null,
      next: config.token
        ? null
        : config.authClientId
          ? "Run mir-cli auth login."
          : "Set MIRAIVFX_LOGTO_APP_ID to the dedicated MIR CLI Logto app id, then run mir-cli auth login.",
    };
    asJson
      ? json(payload)
      : text(payload.authenticated ? "Logged in with local credentials." : "Not logged in.");
    return;
  }

  if (subcommand === "login" || subcommand === "switch") {
    const config = await loadRuntimeConfig();
    requireAuthClientId(config.authClientId);
    const forceLogin = subcommand === "switch" || args.includes("--force") || args.includes("--switch-account");
    const prompt = getFlagValue(args, "--prompt") ?? (forceLogin ? "login" : undefined);
    if (forceLogin && process.env.MIRAIVFX_TOKEN) {
      throw new Error("MIRAIVFX_TOKEN is set and overrides local sessions. Unset it before switching accounts.");
    }
    if (forceLogin) {
      await clearSession();
    }
    const printUrl = args.includes("--print-url");
    const noOpen = args.includes("--no-open");
    const browser = getFlagValue(args, "--browser") ?? process.env.MIRAIVFX_AUTH_BROWSER;
    const browserCommand = getFlagValue(args, "--browser-command") ?? process.env.MIRAIVFX_AUTH_BROWSER_COMMAND;
    let authorizationUrl = "";
    if (printUrl) {
      const payload = await buildLoginPreview(config, prompt);
      asJson ? json(payload) : text(payload.authorization_url);
      return;
    }
    const session = await loginWithPkce({
      issuer: config.authEndpoint,
      clientId: config.authClientId,
      redirectUri: config.authRedirectUri,
      prompt,
      openBrowser: !noOpen,
      browser,
      browserCommand,
      onAuthorizationUrl: (url) => {
        authorizationUrl = url;
        if (noOpen) {
          const payload = {
            authorization_url: url,
            redirect_uri: config.authRedirectUri,
            action: "Open this URL in a separate browser, incognito window, or browser profile to keep CLI login isolated from your website session.",
          };
          asJson ? console.error(JSON.stringify(payload, null, 2)) : text(`Open this URL to sign in:\n${url}`);
        }
      },
    });
    const payload = {
      ok: true,
      user: session.userLabel ?? null,
      expires_at: session.expiresAt ?? null,
      session_path: sessionPath(),
      authorization_url_opened: !noOpen && Boolean(authorizationUrl),
      authorization_url_generated: Boolean(authorizationUrl),
      browser: noOpen ? null : browser ?? "default",
      isolated_login_hint: noOpen
        ? "Login URL was not opened automatically."
        : "Use --no-open or --browser <name> to keep CLI login separate from your everyday website browser.",
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

  text("Usage: mir-cli auth <status|login|switch|logout>");
}

async function buildLoginPreview(
  config: {
    authEndpoint: string;
    authClientId: string;
    authRedirectUri: string;
  },
  prompt?: string,
): Promise<{ authorization_url: string; redirect_uri: string; prompt: string | null; note: string }> {
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
  if (prompt) {
    url.searchParams.set("prompt", prompt);
  }
  return {
    authorization_url: url.toString(),
    redirect_uri: config.authRedirectUri,
    prompt: prompt ?? null,
    note: "Preview only. Real login generates state and PKCE verifier and starts a local callback server.",
  };
}

function maskClientId(value: string): string | null {
  if (!value) return null;
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function requireAuthClientId(value: string): void {
  if (!value) {
    throw new Error(
      "Missing Logto CLI app id. Create a dedicated MIR CLI Logto application and set MIRAIVFX_LOGTO_APP_ID.",
    );
  }
}
