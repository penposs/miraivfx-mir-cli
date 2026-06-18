import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { openUrl } from "../core/open.js";
import { AuthSession, decodeJwtSubject, saveSession } from "./session.js";

export interface OidcLoginOptions {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  prompt?: string;
  openBrowser?: boolean;
  browser?: string;
  browserCommand?: string;
  onAuthorizationUrl?: (url: string) => void;
}

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export async function loginWithPkce(options: OidcLoginOptions): Promise<AuthSession> {
  const discovery = await fetchDiscovery(options.issuer);
  const redirect = new URL(options.redirectUri);
  const port = Number(redirect.port || (redirect.protocol === "https:" ? 443 : 80));
  if (!["127.0.0.1", "localhost"].includes(redirect.hostname)) {
    throw new Error("MIRAIVFX_AUTH_REDIRECT_URI must use localhost or 127.0.0.1");
  }

  const state = randomUrlSafe();
  const codeVerifier = randomUrlSafe(64);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const scopes = options.scopes ?? ["openid", "email", "profile", "offline_access"];

  const callbackPromise = waitForCallback(port, redirect.pathname, state);
  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set("client_id", options.clientId);
  authUrl.searchParams.set("redirect_uri", options.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (options.prompt) {
    authUrl.searchParams.set("prompt", options.prompt);
  }

  options.onAuthorizationUrl?.(authUrl.toString());
  if (options.openBrowser !== false) {
    await openUrl(authUrl.toString(), {
      browser: options.browser,
      browserCommand: options.browserCommand,
    });
  }
  const code = await callbackPromise;
  const token = await exchangeCode(discovery.token_endpoint, {
    clientId: options.clientId,
    redirectUri: options.redirectUri,
    code,
    codeVerifier,
  });

  const accessToken = token.access_token || token.id_token;
  if (!accessToken) {
    throw new Error("Authorization succeeded but token response did not include access_token or id_token");
  }
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : undefined;
  const session: AuthSession = {
    accessToken,
    ...(token.id_token ? { idToken: token.id_token } : {}),
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    tokenType: token.token_type,
    userLabel: decodeJwtSubject(token.id_token) || decodeJwtSubject(accessToken),
  };
  await saveSession(session);
  return session;
}

async function fetchDiscovery(issuer: string): Promise<OidcDiscovery> {
  const base = issuer.replace(/\/+$/, "");
  const urls = [
    `${base}/.well-known/openid-configuration`,
    `${base}/oidc/.well-known/openid-configuration`,
  ];
  let response: Response | undefined;
  for (const url of urls) {
    response = await fetch(url);
    if (response.ok) break;
  }
  if (!response?.ok) {
    throw new Error(`Failed to load OIDC discovery: HTTP ${response?.status ?? "unknown"}`);
  }
  const discovery = (await response.json()) as Partial<OidcDiscovery>;
  if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
    throw new Error("OIDC discovery missing authorization_endpoint or token_endpoint");
  }
  return discovery as OidcDiscovery;
}

async function exchangeCode(
  tokenEndpoint: string,
  input: { clientId: string; redirectUri: string; code: string; codeVerifier: string },
): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", input.clientId);
  body.set("redirect_uri", input.redirectUri);
  body.set("code", input.code);
  body.set("code_verifier", input.codeVerifier);

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || token.error) {
    throw new Error(token.error_description || token.error || `Token exchange failed: HTTP ${response.status}`);
  }
  return token;
}

function waitForCallback(port: number, path: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for browser login callback"));
    }, 180_000);

    const server = http.createServer((request, response) => {
      try {
        const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== path) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        const error = url.searchParams.get("error");
        const state = url.searchParams.get("state");
        if (state !== expectedState) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Invalid OAuth state for this login attempt. Waiting for the current login callback.");
          return;
        }
        if (error) {
          throw new Error(url.searchParams.get("error_description") || error);
        }
        const code = url.searchParams.get("code");
        if (!code) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Missing authorization code. Waiting for the current login callback.");
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<h1>Miraivfx CLI login complete</h1><p>You can close this tab.</p>");
        clearTimeout(timeout);
        server.close();
        resolve(code);
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : String(error));
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });

    server.listen(port, "127.0.0.1", () => undefined);
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function randomUrlSafe(size = 32): string {
  return randomBytes(size).toString("base64url");
}
