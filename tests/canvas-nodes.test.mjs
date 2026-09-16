import test from "node:test";
import assert from "node:assert/strict";
import { addGenericNode, updateCanvasNode, cloneCanvasNode, handleCanvasCommand } from "../dist/commands/canvas.js";
import { nodeCatalog, currentCanvasCapabilities, RETIRED_NODE_TYPES } from "../dist/canvas/node-catalog.js";

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

test("unified video keeps model-specific defaults with the web catalog", async () => {
  const node = await create("seedance2", ["--size", "1:1", "--seconds", "10"]);
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

test("Seedance prompt assistant uses the current title and LLM fields", async () => {
  const node = await create("seedance", ["--system-prompt", "Plan shots"]);
  assert.equal(node.data.systemInstruction, "Plan shots");
  assert.equal(node.title, "Seedance 提示词助手");
  assert.equal((await create("agent")).title, "提示词agent");
});

test("retired types cannot be created, updated or cloned, even with backend support", async () => {
  for (const type of Object.keys(RETIRED_NODE_TYPES)) {
    const api = mockApi([{ id: "old", type, data: {} }]);
    await assert.rejects(create(type, [], api), /Retired node type/);
    await assert.rejects(updateCanvasNode(api, ["--canvas-id", "canvas-1", "--node-id", "old", "--prompt", "change", "--yes"], "https://miraivfx.art"), /Retired node type/);
    await assert.rejects(cloneCanvasNode(api, ["--canvas-id", "canvas-1", "--node-id", "old", "--yes"], "https://miraivfx.art"), /Retired node type/);
    assert.equal(api.calls.some(call => typeof call === "object"), false);
  }
  for (const action of ["add-seedance-rh", "add-vibex", "add-runninghub", "add-megaby-video", "add-blocking-3d", "add-video", "add-llm"]) {
    await assert.rejects(handleCanvasCommand("node", [action]), /Retired node type/);
  }
});

test("current capabilities hide historical backend entries and retain tools", async () => {
  const catalog = nodeCatalog();
  const historical = [...catalog.safe_canvas_node_types, ...Object.keys(RETIRED_NODE_TYPES)];
  const capabilities = currentCanvasCapabilities({ safe_canvas_node_types: historical, sidebar_node_types: historical, virtual_shoot: { version: 1 } });
  assert.deepEqual(capabilities.safe_canvas_node_types, catalog.safe_canvas_node_types);
  assert.deepEqual(capabilities.server_safe_canvas_node_types, historical);
  assert.deepEqual(capabilities.virtual_shoot, { version: 1 });
  for (const type of ["agent", "suno", "seedance", "seedance2", "panorama-gen", "depth-map"]) {
    assert.ok(capabilities.sidebar_node_types.includes(type));
    const node = await create(type);
    assert.equal(node.type, type);
    assert.equal(node.status, "idle");
  }
  assert.ok(catalog.safe_canvas_node_types.includes("relay"));
  assert.ok(catalog.safe_canvas_node_types.includes("frame-extractor"));
  assert.deepEqual(currentCanvasCapabilities({ safe_canvas_node_types: ["text"] }).sidebar_node_types, ["text"]);
  assert.deepEqual(currentCanvasCapabilities({}).safe_canvas_node_types, []);
});

test("Suno supports current versions and preserves untouched settings on update", async () => {
  for (const [version, expected] of [["V4.5+", "chirp-bluejay"], ["V5", "chirp-crow"], ["V5.5", "chirp-fenix"]]) {
    assert.equal((await create("suno", ["--version", version])).data.sunoVersion, expected);
  }
  const api = mockApi([{ id: "song", type: "suno", data: { sunoVersion: "chirp-crow", sunoInstrumental: true, sunoMode: "custom" } }]);
  await updateCanvasNode(api, ["--canvas-id", "canvas-1", "--node-id", "song", "--style", "Jazz", "--yes"], "https://miraivfx.art");
  const patch = api.calls.find(call => typeof call === "object").body.ops[0].patch.data;
  assert.equal(patch.sunoTags, "Jazz");
  assert.equal(patch.sunoVersion, undefined);
  assert.equal(patch.sunoInstrumental, undefined);
  assert.equal(patch.sunoModel, undefined);
  assert.equal((await create("suno", ["--no-instrumental"])).data.sunoInstrumental, false);
  await assert.rejects(create("suno", ["--version", "old"]), /Invalid Suno version/);
  await assert.rejects(create("suno", ["--mode", "invalid"]), /Invalid Suno mode/);
});

test("depth defaults match the sidebar and JSON cannot bypass option validation", async () => {
  const node = await create("depth-map", ["--depth-style", "inferno"]);
  assert.deepEqual(node.data.depthSettings, { model: "small", fps: 30, maxSide: 512, startSeconds: 0, durationSeconds: 30, style: "inferno", invert: false, temporal: 0.35 });
  await assert.rejects(create("depth-map", ["--data-json", '{"depthSettings":{"fps":60}}']), /Invalid/);
  await assert.rejects(create("depth-map", ["--data-json", '{"depthSettings":{"durationSeconds":31}}']), /Invalid/);
  await assert.rejects(create("panorama-gen", ["--quality", "8k"]), /Invalid panorama/);
  const panorama = await create("panorama-gen", ["--quality", "4k", "--no-pre-llm", "--pre-llm-model", "planner"]);
  assert.equal(panorama.data.panoramaQuality, "4k");
  assert.equal(panorama.data.preLlmEnabled, false);
  assert.equal(panorama.data.preLlmModel, "planner");
});

test("unified video follows model families and public schema through flags and JSON", async () => {
  const api = mockApi();
  api.getJson = async () => ({ data: { models: [
    { id: "runninghub-h3-video", task: "video", param_schema: { properties: { duration: { minimum: 5, maximum: 15 }, ratio: { enum: ["16:9", "9:16"] } } } },
    { id: "sora", task: "video" },
    { id: "megaby-video-standard", task: "video" },
    { id: "custom-video", task: "video", ui_hints: { megaby_video: true } },
  ] } });
  const args = ["--x", "0", "--y", "0"];
  const node = await create("seedance2", [...args, "--model", "runninghub-h3-video", "--ratio", "9:16", "--duration", "10"], api);
  assert.equal(node.data.duration, 10);
  await create("seedance2", [...args, "--model", "custom-video"], api);
  await create("seedance2", [...args, "--model", "megaby-video-standard"], api);
  await assert.rejects(create("seedance2", [...args, "--model", "sora"], api), /not supported/);
  await assert.rejects(create("seedance2", [...args, "--model", "runninghub-h3-video", "--duration", "30"], api), /parameter range/);
  await assert.rejects(create("seedance2", [...args, "--model", "runninghub-h3-video", "--ratio", "1:1"], api), /Invalid size/);
  await assert.rejects(create("seedance2", [...args, "--data-json", '{"model":"megaby-video-standard","generate_audio":true}'], api), /not supported/);
  await assert.rejects(create("seedance2", [...args, "--api-key", "legacy"], api), /Legacy video option/);
  assert.equal(api.calls.some(call => typeof call === "object"), false);
});
