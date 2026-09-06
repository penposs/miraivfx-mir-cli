import test from "node:test";
import assert from "node:assert/strict";
import { addGenericNode, updateCanvasNode } from "../dist/commands/canvas.js";

function mockApi(nodes = []) {
  const calls = [];
  return {
    calls,
    async getJson(path) {
      calls.push(path);
      if (path.includes("/models")) return { data: [{ id: "seedance2-5-standard", model_type: "video", is_active: true }] };
      return { success: true, data: { id: "canvas-1", project_id: "project-1", revision: 7, nodes, connections: [], groups: [] } };
    },
    async postJson(path, body) {
      calls.push({ path, body });
      return { success: true, data: { canvas_id: "canvas-1", project_id: "project-1", revision: 8 } };
    },
  };
}

async function create(type, args = [], api = mockApi()) {
  const result = await addGenericNode(api, ["--canvas-id", "canvas-1", "--type", type, "--dry-run", ...args], "https://miraivfx.art");
  return result.ops[0].node;
}

test("unified video maps current web fields and validates model availability", async () => {
  const api = mockApi();
  const node = await create("seedance2", ["--model", "seedance2-5-standard", "--ratio", "9:16", "--duration", "30", "--resolution", "1080p", "--first-last-frames", "--no-audio", "--return-last-frame"], api);
  assert.equal(node.width, 420);
  assert.equal(node.data.model, "seedance2-5-standard");
  assert.equal(node.data.size, "9:16");
  assert.equal(node.data.duration, 30);
  assert.equal(node.data.generate_audio, false);
  assert.equal(node.data.use_first_last_frames, true);
  assert.equal(node.data.return_last_frame, true);
  assert.ok(api.calls.includes("/canvas/models?task=video"));
  assert.equal(api.calls.some(call => typeof call === "object"), false);
  await assert.rejects(create("seedance2", ["--model", "missing"], api), /not available/);
});

test("Megaby keeps model-specific defaults with the web catalog", async () => {
  const node = await create("megaby-video", ["--size", "1:1", "--seconds", "10"]);
  assert.equal(node.data.size, "1:1");
  assert.equal(node.data.duration, 10);
  assert.equal(node.data.generate_audio, undefined);
  assert.equal(node.data.model, undefined);
});

test("depth settings use nested web fields and reject unsupported options", async () => {
  const node = await create("depth-map", ["--depth-model", "base", "--depth-fps", "source", "--depth-max-side", "2048", "--depth-start", "2.5", "--depth-duration", "12", "--depth-style", "inferno", "--depth-invert", "--depth-temporal", "0.5"]);
  assert.equal(node.height, 520);
  assert.deepEqual(node.data.depthSettings, { model: "base", fps: "source", maxSide: 2048, startSeconds: 2.5, durationSeconds: 12, style: "inferno", invert: true, temporal: 0.5 });
  for (const args of [["--depth-fps", "60"], ["--depth-duration", "31"], ["--depth-temporal", "NaN"]]) {
    await assert.rejects(create("depth-map", args), /Invalid/);
  }
  await assert.rejects(create("seedance2", ["--duration", "-1"]), /positive integer/);
});

test("updating one depth field preserves existing nested settings", async () => {
  const api = mockApi([{ id: "depth-1", type: "depth-map", data: { depthSettings: { model: "base", fps: 24, invert: true } } }]);
  await updateCanvasNode(api, ["--canvas-id", "canvas-1", "--node-id", "depth-1", "--depth-style", "viridis", "--no-depth-invert", "--yes"], "https://miraivfx.art");
  const request = api.calls.find(call => typeof call === "object");
  assert.deepEqual(request.body.ops[0].patch.data.depthSettings, { model: "base", fps: 24, invert: false, style: "viridis" });
});

test("pre-LLM and agent template fields map without dropping supplied data", async () => {
  const node = await create("image", ["--no-pre-llm", "--pre-llm-model", "llm-1", "--pre-llm-template-id", "template-1", "--data-json", '{"preLlmEnabled":true,"custom":42}']);
  assert.equal(node.data.preLlmEnabled, false);
  assert.equal(node.data.preLlmModel, "llm-1");
  assert.equal(node.data.preLlmTemplateId, "template-1");
  assert.equal(node.data.custom, 42);
  const agent = await create("agent", ["--system-template-id", "template-2", "--system-template-content", "Write a shot list"]);
  assert.equal(agent.data.agentSystemTemplateId, "template-2");
  assert.equal(agent.data.agentSystemTemplateContent, "Write a shot list");
});

test("legacy seedance remains the LLM node; legacy RH keeps its field format", async () => {
  const node = await create("seedance", ["--system-prompt", "Plan shots"]);
  assert.equal(node.data.systemInstruction, "Plan shots");
  const rh = await create("seedance2-rh-standard", ["--ratio", "9:16", "--duration", "10", "--no-audio"]);
  assert.equal(rh.data.ratio, "9:16");
  assert.equal(rh.data.duration, "10");
  assert.equal(rh.data.generateAudio, false);
});
