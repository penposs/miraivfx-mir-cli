import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkflowTemplate, listWorkflowTemplates, describeWorkflowTemplate, validateWorkflowTemplate } from "../dist/canvas/workflow-templates.js";
import { addGenericNode } from "../dist/commands/canvas.js";
import { nodeCatalog, currentCanvasCapabilities } from "../dist/canvas/node-catalog.js";

const expected = {
  "story-script": { task: "llm", types: ["agent", "agent", "text", "text"], setup: [["outline-agent", "episode-agent"]] },
  "character-three-view": { task: "image", types: ["image", "image-item"], setup: [] },
  "multi-reference-video": { task: "video", types: ["image-item", "image-item", "image-item", "image-item", "image-item", "seedance2", "video-item"], setup: Array.from({ length: 5 }, (_, i) => [`reference-${i + 1}`, "video-generator"]) },
  "music-generation": { task: "audio", types: ["suno", "audio", "audio"], setup: [] },
};

test("four built-in modules route each task to the right generation blueprint", async () => {
  const list = await listWorkflowTemplates();
  assert.deepEqual(list.map(item => item.id), Object.keys(expected));
  for (const [id, fixture] of Object.entries(expected)) {
    assert.deepEqual((await listWorkflowTemplates(fixture.task)).map(item => item.id), [id]);
    const template = await readWorkflowTemplate(id);
    assert.deepEqual(template.nodes.map(node => node.type), fixture.types);
    assert.deepEqual(template.connections.filter(edge => edge.phase === "setup").map(edge => [edge.fromNode, edge.toNode]), fixture.setup);
    assert.match(template.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(template.source.path, `frontend/public/canvas-templates/${id}.json`);
  }
  await assert.rejects(listWorkflowTemplates("unknown"), /Invalid --task/);
});

test("construction excludes every runtime result and binds real IDs for directed input edges", async () => {
  for (const id of Object.keys(expected)) {
    const template = await describeWorkflowTemplate(id);
    const resultIds = template.nodes.filter(node => node.role === "generated-result").map(node => node.id);
    const creates = template.setup_plan.filter(step => step.action !== "connect");
    const connects = template.setup_plan.filter(step => step.action === "connect");
    assert.equal(template.read_only, true);
    assert.equal(creates.length, template.nodes.length - resultIds.length);
    assert.equal(connects.length, expected[id].setup.length);
    for (const step of template.setup_plan) {
      assert.equal(step.argv.includes("--yes"), false);
      assert.equal(step.argv.includes("--status"), false);
      for (const resultId of resultIds) {
        assert.notEqual(step.bind_node_id_as, resultId);
        assert.equal(step.argv.includes(`{{node.${resultId}}}`), false);
      }
    }
    assert.deepEqual(connects.map(step => [step.argv[step.argv.indexOf("--from-node") + 1], step.argv[step.argv.indexOf("--to-node") + 1]]), expected[id].setup.map(([from, to]) => [`{{node.${from}}}`, `{{node.${to}}}`]));
    const serialized = JSON.stringify(template.nodes);
    assert.doesNotMatch(serialized, /cdn\.miraivfx|https?:|history_id|taskId|receivedMedia|receivedImages|assetOrder|"status"|"output"/);
  }
});

test("every blueprint's creation recipe works through the real CLI node builder without writes", async () => {
  const values = {
    image_model: "test-image", llm_model: "test-llm", video_model: "seedance2-test",
    image_prompt: "A character sheet", video_prompt: "Animate the references", story_brief: "A short story", episode_request: "Write episode 1",
    song_title: "A song", music_style: "Ambient", lyrics: "[Verse]\nTest lyrics",
    video_ratio: "16:9", video_resolution: "720p", video_duration: "10",
    ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`reference_${i + 1}_url`, `https://cdn.miraivfx.art/test/reference-${i + 1}.png`])),
  };
  const calls = [];
  const api = {
    async getJson(path) {
      calls.push(path);
      const task = new URL(`https://example.invalid${path}`).searchParams.get("task");
      assert.ok(["llm", "image", "video"].includes(task));
      const id = { image: values.image_model, llm: values.llm_model, video: values.video_model }[task];
      return { data: [{ id, model_type: task, is_active: true }] };
    },
    async postJson() { assert.fail("A recipe dry-run must not write or generate"); },
  };
  for (const id of Object.keys(expected)) {
    const template = await describeWorkflowTemplate(id);
    const nodes = [];
    for (const step of template.setup_plan.filter(step => step.action !== "connect")) {
      const args = step.argv.slice(4).map(arg => arg.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
        if (key === "canvas_id") return "test-canvas";
        assert.ok(Object.hasOwn(values, key), `Unbound placeholder ${key}`);
        return values[key];
      }));
      const result = await addGenericNode(api, [...args, "--dry-run"], "https://miraivfx.art");
      assert.equal(result.dry_run, true);
      assert.equal(result.ops.length, 1);
      const node = result.ops[0].node;
      nodes.push(node);
      assert.equal(node.type, template.nodes.find(item => item.id === step.bind_node_id_as).type);
      if (step.action === "create_node") assert.notEqual(node.status, "completed");
      else assert.match(node.content, /^https:\/\/cdn\.miraivfx\.art\/test\//);
    }
    const generator = nodes.find(node => ["image", "agent", "suno", "seedance2"].includes(node.type));
    if (id === "character-three-view") assert.equal(generator.data.prompt, values.image_prompt);
    if (id === "story-script") assert.equal(generator.data.llmModel, values.llm_model);
    if (id === "multi-reference-video") {
      assert.equal(generator.data.duration, 10);
      assert.equal(generator.data.size, "16:9");
      assert.equal(Object.hasOwn(generator.data, "model"), false);
    }
    if (id === "music-generation") {
      assert.equal(generator.data.sunoLyrics, values.lyrics);
      assert.equal(generator.data.sunoTitle, values.song_title);
      assert.equal(generator.data.sunoMode, "custom");
    }
  }
  assert.equal(calls.some(path => path.endsWith("task=video")), false);
});

test("template guards catch wrong generators, reversed input edges and fake output setup", async () => {
  const template = await readWorkflowTemplate("multi-reference-video");
  for (const wrongType of ["seedance", "video-item", "image-item", "video"]) {
    const bad = structuredClone(template);
    bad.nodes.find(node => node.role === "generation").type = wrongType;
    assert.throws(() => validateWorkflowTemplate(bad), /requires seedance2|Retired node type/);
  }
  const reversed = structuredClone(template);
  [reversed.connections[0].fromNode, reversed.connections[0].toNode] = [reversed.connections[0].toNode, reversed.connections[0].fromNode];
  assert.throws(() => validateWorkflowTemplate(reversed), /feed generation/);
  const resultSetup = structuredClone(template);
  resultSetup.connections.at(-1).phase = "setup";
  assert.throws(() => validateWorkflowTemplate(resultSetup), /feed generation/);
  const dangling = structuredClone(template);
  dangling.connections[0].fromNode = "missing";
  assert.throws(() => validateWorkflowTemplate(dangling), /dangling/);
  const fakeResult = structuredClone(template);
  fakeResult.nodes.at(-1).cli_args = ["--status", "completed"];
  assert.throws(() => validateWorkflowTemplate(fakeResult), /result nodes/);
});

test("CLI discovers bundled files from an unrelated cwd without login or a reachable server", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "mir-templates-test-"));
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = args => execFileSync(process.execPath, [cli, "canvas", "templates", ...args], {
    cwd, encoding: "utf8", timeout: 10000,
    env: { ...process.env, MIRAIVFX_API_BASE: "http://127.0.0.1:1", MIRAIVFX_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    assert.equal(JSON.parse(run(["list", "--json"])).templates.length, 4);
    for (const id of Object.keys(expected)) assert.equal(JSON.parse(run(["show", id, "--json"])).id, id);
    assert.equal(JSON.parse(run(["list", "--task", "video", "--json"])).templates[0].id, "multi-reference-video");
    for (const args of [["show"], ["show", "../../package"], ["apply"], ["list", "--task"], ["list", "--task", "bad"]]) {
      assert.throws(() => run(args), error => error.status === 1);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("node discovery and live capability intersection both point agents to workflow blueprints", () => {
  assert.equal(nodeCatalog().workflow_templates.list_command, "mir-cli canvas templates list --json");
  assert.deepEqual(currentCanvasCapabilities({ safe_canvas_node_types: ["image"] }).workflow_templates, nodeCatalog().workflow_templates);
});
