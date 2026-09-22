import { readFile } from "node:fs/promises";
import { assertCurrentNodeType } from "./node-catalog.js";

const TEMPLATE_IDS = ["story-script", "character-three-view", "multi-reference-video", "music-generation"] as const;
const TASKS = new Set(["llm", "image", "video", "audio"]);

export interface WorkflowNode {
  id: string;
  type: string;
  role: "generation" | "reference" | "generated-result";
  purpose: string;
  x?: number;
  y?: number;
  cli_args?: string[];
  example_prompt?: string;
}

export interface WorkflowTemplate {
  schema_version: 1;
  id: string;
  title: string;
  task: string;
  intents: string[];
  source: { repository: string; path: string; sha256: string; adaptation: string };
  guidance: string[];
  nodes: WorkflowNode[];
  connections: { fromNode: string; toNode: string; phase: "setup" | "generated-result" }[];
}

// Resolve relative to the installed package, not the caller's working directory.
// examples/ is already included in package.json's published files.
export async function readWorkflowTemplate(id: string): Promise<WorkflowTemplate> {
  if (!(TEMPLATE_IDS as readonly string[]).includes(id)) {
    throw new Error(`Unknown workflow template: ${id}. Use canvas templates list --json.`);
  }
  const url = new URL(`../../examples/workflows/${id}.json`, import.meta.url);
  const template: WorkflowTemplate = JSON.parse(await readFile(url, "utf8"));
  validateWorkflowTemplate(template);
  if (template.id !== id) throw new Error(`Workflow template ID mismatch: ${id}`);
  return template;
}

export function validateWorkflowTemplate(template: WorkflowTemplate): void {
  const invalid = (reason: string): never => { throw new Error(`Invalid workflow template: ${reason}`); };
  if (template.schema_version !== 1 || !TASKS.has(template.task)) invalid("schema version or task");
  const nodes = new Map<string, WorkflowNode>();
  const generationTypes: Record<string, string> = { llm: "agent", image: "image", video: "seedance2", audio: "suno" };
  for (const node of template.nodes) {
    if (!node.id || nodes.has(node.id)) invalid("duplicate or empty node ID");
    assertCurrentNodeType(node.type);
    if (!["generation", "reference", "generated-result"].includes(node.role)) invalid("node role");
    if (node.role === "generation" && node.type !== generationTypes[template.task]) {
      invalid(`${template.task} generation requires ${generationTypes[template.task]}, not ${node.type}`);
    }
    if (node.role === "reference" && !["image-item", "video-item", "audio", "text", "file"].includes(node.type)) {
      invalid("reference must be a material node");
    }
    if (node.role === "generated-result") {
      if (node.cli_args) invalid("result nodes must not have creation commands");
    } else if (!Array.isArray(node.cli_args) || !node.cli_args.every(arg => typeof arg === "string")
      || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      invalid("setup nodes need CLI arguments and layout coordinates");
    }
    nodes.set(node.id, node);
  }
  if (![...nodes.values()].some(node => node.role === "generation")) invalid("missing generation node");
  const edges = new Set<string>();
  for (const edge of template.connections) {
    const from = nodes.get(edge.fromNode);
    const to = nodes.get(edge.toNode);
    const key = `${edge.fromNode}:${edge.toNode}`;
    if (!from || !to || from === to || edges.has(key)) invalid("dangling, self or duplicate connection");
    if (edge.phase === "setup") {
      if (from!.role === "generated-result" || to!.role !== "generation") invalid("setup connections must feed generation nodes");
    } else if (edge.phase === "generated-result") {
      if (from!.role !== "generation" || to!.role !== "generated-result") invalid("result connection direction");
    } else invalid("connection phase");
    edges.add(key);
  }
}

export async function listWorkflowTemplates(task?: string) {
  if (task !== undefined && !TASKS.has(task)) {
    throw new Error("Invalid --task: use image, video, audio or llm");
  }
  const templates = await Promise.all(TEMPLATE_IDS.map(readWorkflowTemplate));
  return templates.filter(template => !task || template.task === task).map(template => ({
    id: template.id,
    title: template.title,
    task: template.task,
    intents: template.intents,
    file: `examples/workflows/${template.id}.json`,
    show_command: `mir-cli canvas templates show ${template.id} --json`,
    generation_node_types: [...new Set(template.nodes.filter(node => node.role === "generation").map(node => node.type))],
  }));
}

export async function describeWorkflowTemplate(id: string) {
  const template = await readWorkflowTemplate(id);
  const setupNodes = template.nodes.filter(node => node.role !== "generated-result");
  const setupEdges = template.connections.filter(edge => edge.phase === "setup");
  return {
    ...template,
    read_only: true,
    model_discovery: `mir-cli canvas models --task ${template.task} --json`,
    instructions: [
      "This is a reference blueprint, not a canvas import or an executed workflow. No login, network, upload or generation is performed.",
      "Adapt prompts, reference count and parameters to the user's request and current canvas capabilities/model metadata.",
      "Replace {{...}} bindings with user inputs, current model values and actual IDs returned by node creation. Reuse existing reference nodes when available.",
      "setup_plan argv arrays omit write permission flags. Node creation supports --dry-run for preview; append --yes only for authorized writes. Connections require --yes and do not support dry-run.",
      "Never copy source UUIDs, media URLs, task IDs, cached inputs, completed states or generated-result nodes into a new workflow.",
      "After setup, inspect the resulting nodes/connections and open the canvas for manual generation in dependency order.",
    ],
    required_bindings: ["canvas_id", ...new Set(setupNodes.flatMap(node => (node.cli_args ?? []).flatMap(arg =>
      [...arg.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]))))],
    setup_plan: [
      ...setupNodes.map(node => ({
        action: node.role === "reference" ? "reuse_or_create_node" : "create_node",
        bind_node_id_as: node.id,
        argv: ["mir-cli", "canvas", "node", "add", "--canvas-id", "{{canvas_id}}", "--type", node.type,
          "--x", String(node.x), "--y", String(node.y), ...(node.cli_args ?? []), "--json"],
      })),
      ...setupEdges.map(edge => ({
        action: "connect",
        argv: ["mir-cli", "canvas", "node", "connect", "--canvas-id", "{{canvas_id}}",
          "--from-node", `{{node.${edge.fromNode}}}`, "--to-node", `{{node.${edge.toNode}}}`, "--json"],
      })),
    ],
  };
}
