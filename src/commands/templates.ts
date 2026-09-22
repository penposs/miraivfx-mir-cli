import { getFlagValue, hasFlag } from "../core/args.js";
import { json, text } from "../core/output.js";
import { describeWorkflowTemplate, listWorkflowTemplates } from "../canvas/workflow-templates.js";

export async function handleTemplatesCommand(args: string[]): Promise<void> {
  const action = args[0] ?? "list";
  if (action === "list") {
    if (hasFlag(args, "--task") && !getFlagValue(args, "--task")) throw new Error("--task requires image, video, audio or llm");
    const templates = await listWorkflowTemplates(getFlagValue(args, "--task"));
    if (hasFlag(args, "--json")) json({ read_only: true, templates });
    else text(templates.map(item => `${item.id} [${item.task}] ${item.title}\n  ${item.show_command}`).join("\n"));
    return;
  }
  if (action === "show") {
    if (!args[1] || args[1].startsWith("--")) throw new Error("Usage: mir-cli canvas templates show <template-id> --json");
    json(await describeWorkflowTemplate(args[1]));
    return;
  }
  if (["help", "--help", "-h"].includes(action)) {
    text("Usage: mir-cli canvas templates list [--task image|video|audio|llm] [--json]\n       mir-cli canvas templates show <template-id> --json\nOffline reference blueprints: node types, directed connections and construction commands. No canvas writes or generation.");
    return;
  }
  throw new Error(`Unknown templates command: ${action}. Use canvas templates --help.`);
}
