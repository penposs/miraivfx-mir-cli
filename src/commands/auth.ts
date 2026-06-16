import { json, text } from "../core/output.js";
import { loadRuntimeConfig } from "../core/config.js";

export async function handleAuthCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = args.includes("--json");

  if (subcommand === "status") {
    const config = await loadRuntimeConfig();
    const payload = {
      authenticated: Boolean(config.token),
      api_base: config.apiBase,
      app_base: config.appBase,
      token_source: config.token ? "local" : null,
      next: config.token
        ? null
        : "Run mir-cli auth login after the browser OAuth flow is implemented, or configure a local token outside agent chat.",
    };
    asJson
      ? json(payload)
      : text(payload.authenticated ? "Logged in with local credentials." : "Not logged in.");
    return;
  }

  if (subcommand === "login") {
    const payload = {
      ok: false,
      reason: "auth_login_not_implemented",
      security: "Login must use browser OAuth/PKCE. Do not paste tokens into agent chats.",
    };
    asJson ? json(payload) : text("Browser login flow is planned but not implemented yet.");
    return;
  }

  if (subcommand === "logout") {
    const payload = { ok: true, note: "No stored session exists in the scaffold." };
    asJson ? json(payload) : text("No stored session exists in the scaffold.");
    return;
  }

  text("Usage: mir-cli auth <status|login|logout>");
}
