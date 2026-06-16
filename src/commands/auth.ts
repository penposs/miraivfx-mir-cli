import { json, text } from "../core/output.js";

export async function handleAuthCommand(subcommand = "", args: string[]): Promise<void> {
  const asJson = args.includes("--json");

  if (subcommand === "status") {
    const payload = {
      authenticated: false,
      reason: "auth_not_implemented",
      next: "Run mir-cli auth login after the browser login flow is implemented.",
    };
    asJson ? json(payload) : text("Not logged in. Browser auth flow is not implemented yet.");
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
