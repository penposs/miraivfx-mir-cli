import { json, text } from "../core/output.js";
import { loadRuntimeConfig } from "../core/config.js";
import { openUrl } from "../core/open.js";

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
    const config = await loadRuntimeConfig();
    const loginUrl = `${config.appBase}/login`;
    await openUrl(loginUrl);
    const payload = {
      ok: true,
      opened: loginUrl,
      next: "After browser OAuth/PKCE is implemented, this command will capture the authorization callback locally.",
      security: "Do not paste passwords or tokens into agent chats.",
    };
    asJson ? json(payload) : text(`Opened ${loginUrl}`);
    return;
  }

  if (subcommand === "logout") {
    const payload = { ok: true, note: "No stored session exists in the scaffold." };
    asJson ? json(payload) : text("No stored session exists in the scaffold.");
    return;
  }

  text("Usage: mir-cli auth <status|login|logout>");
}
