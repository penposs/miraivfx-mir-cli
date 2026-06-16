#!/usr/bin/env node
import { handleAuthCommand } from "./commands/auth.js";
import { handleCanvasCommand } from "./commands/canvas.js";
import { handleProjectCommand } from "./commands/project.js";
import { printHelp } from "./commands/help.js";
import { fail } from "./core/output.js";

async function main(argv: string[]): Promise<void> {
  const [command, subcommand, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "auth") {
    await handleAuthCommand(subcommand, rest);
    return;
  }

  if (command === "project") {
    await handleProjectCommand(subcommand, rest);
    return;
  }

  if (command === "canvas") {
    await handleCanvasCommand(subcommand, rest);
    return;
  }

  fail(`Unknown command: ${command}`, 2);
}

main(process.argv.slice(2)).catch((error) => {
  fail(error instanceof Error ? error.message : String(error), 1);
});
