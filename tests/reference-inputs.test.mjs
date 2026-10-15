import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addGenericNode, updateCanvasNode } from "../dist/commands/canvas.js";

const materials = [
  { id: "person", type: "image-item", content: "/uploads/person.png" },
  { id: "scene", type: "image-item", content: "/uploads/scene.png" },
  { id: "sound", type: "audio", content: "/uploads/sound.mp3" },
  { id: "motion", type: "video-item", content: "/uploads/motion.mp4" },
];
function mockApi(model = {}) {
  const state = { id: "canvas", project_id: "project", revision: 4, nodes: [...materials], connections: [], groups: [] };
  const writes = [];
  return { state, writes,
    async getJson(path) {
      if (path.includes("/models")) return { data: [{ id: "seedance2-standard", task: "video", param_schema: { properties: { duration: { enum: [5, 10, 15] } } }, ...model }] };
      return { success: true, data: state };
    },
    async postJson(path, body) {
      writes.push({ path, body });
      for (const op of body.ops) {
        if (op.type === "add_node") state.nodes.push(op.node);
        if (op.type === "connect") state.connections.push(op);
      }
      return { success: true, data: { canvas_id: "canvas", project_id: "project", revision: ++state.revision } };
    },
  };
}
function add(api, args = []) {
  return addGenericNode(api, ["--canvas-id", "canvas", "--type", "seedance2", ...args], "https://miraivfx.art");
}

test("two shots reuse materials and wire ordered inputs in one revision-checked request per shot", async () => {
  const api = mockApi();
  const args = ["--reference-node", "sound,scene", "--reference-node", "person,scene", "--yes"];
  const first = await add(api, args);
  const second = await add(api, args);
  assert.equal(api.writes.length, 2);
  assert.equal(api.state.nodes.filter(n => n.type === "image-item").length, 2);
  for (const [index, result] of [first, second].entries()) {
    const request = api.writes[index];
    assert.equal(request.body.baseRevision, 4 + index);
    assert.equal(request.body.conflictPolicy, "strict");
    assert.deepEqual(request.body.ops.slice(1).map(op => [op.fromNode, op.toNode]), [["sound", result.node_id], ["scene", result.node_id], ["person", result.node_id]]);
    assert.deepEqual(result.references.map(r => r.label), ["@audio1", "@image1", "@image2"]);
    assert.equal(api.state.nodes.find(n => n.id === result.node_id).data.model, "seedance2-standard");
    assert.equal(result.generation_started, false);
  }
});

test("dry run with explicit coordinates still resolves references and does not write", async () => {
  const api = mockApi();
  const result = await add(api, ["--x", "500", "--y", "10", "--reference-node", "person,scene", "--dry-run"]);
  assert.equal(result.ops.length, 3);
  assert.equal(api.writes.length, 0);
});

test("missing, local-only, wrong-type and excessive references fail before mutation", async () => {
  for (const [id, node, message] of [
    ["missing", null, /not found/],
    ["bad", { id: "bad", type: "image-item", content: "C:\\shots\\a.png" }, /upload/],
    ["bad", { id: "bad", type: "text", content: "hello" }, /material node/],
  ]) {
    const api = mockApi();
    if (node) api.state.nodes.push(node);
    await assert.rejects(add(api, ["--reference-node", id, "--yes"]), message);
    assert.equal(api.writes.length, 0);
  }
  const api = mockApi();
  for (let i = 0; i < 10; i++) api.state.nodes.push({ id: `img${i}`, type: "image-item", content: `/uploads/${i}.png` });
  await assert.rejects(add(api, ["--reference-node", Array.from({ length: 10 }, (_, i) => `img${i}`).join(","), "--yes"]), /at most 9/);
  await assert.rejects(add(api, ["--reference-node", "person,sound", "--first-last-frames", "--yes"]), /First\/last-frame/);
  assert.equal(api.writes.length, 0);
});

test("current provider families and catalog media policies are honored", async () => {
  for (const id of ["botcf-video", "bsutopia-wan3"]) {
    await add(mockApi({ id }), ["--model", id, "--reference-node", "person", "--dry-run"]);
  }
  const api = mockApi({ id: "megaby-video-test", ui_hints: { megaby_video: { media_policy: { max_images: 30, max_videos: 0, max_audios: 0 } } } });
  await add(api, ["--model", "megaby-video-test", "--reference-node", "person,scene", "--dry-run"]);
  await assert.rejects(add(api, ["--model", "megaby-video-test", "--reference-node", "person,motion", "--yes"]), /at most 0 video/);
  assert.equal(api.writes.length, 0);
});

test("implicit default model is checked instead of silently accepting invalid duration", async () => {
  const api = mockApi();
  await assert.rejects(add(api, ["--duration", "30", "--yes"]), /Invalid duration/);
  await assert.rejects(add(mockApi({ id: "other" }), ["--yes"]), /not available/);
  assert.equal(api.writes.length, 0);
});

test("stale revisions and cached input overrides cannot create successful-looking workflows", async () => {
  const api = mockApi();
  await assert.rejects(add(api, ["--reference-node", ",", "--yes"]), /at least one/);
  await assert.rejects(add(api, ["--reference-node", "person", "--data-json", '{"assetOrder":[]}', "--yes"]), /omit assetOrder/);
  assert.equal(api.writes.length, 0);
  api.postJson = async (path, body) => {
    api.writes.push({ path, body });
    throw new Error("HTTP 409: revision conflict");
  };
  await assert.rejects(add(api, ["--reference-node", "person", "--yes"]), /revision conflict/);
  assert.equal(api.writes.length, 1);
  assert.equal(api.state.nodes.length, materials.length);
});

test("UTF-8 prompt files preserve multiline literal content on create and update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mir-prompt-"));
  try {
    const path = join(dir, "分镜 01.md");
    const prompt = '@image1 走进教室\r\n镜头推近 "女主"。$() `literal`';
    await writeFile(path, `\uFEFF${prompt}`, "utf8");
    const api = mockApi();
    const result = await add(api, ["--prompt-file", path, "--reference-node", "person", "--yes"]);
    const node = api.state.nodes.find(n => n.id === result.node_id);
    assert.equal(node.content, prompt);
    assert.equal(node.data.prompt, prompt);
    await updateCanvasNode(api, ["--canvas-id", "canvas", "--node-id", result.node_id, "--prompt-file", path, "--yes"], "https://miraivfx.art");
    assert.equal(api.writes[1].body.ops[0].patch.data.prompt, prompt);
    await assert.rejects(add(api, ["--prompt-file", path, "--prompt", "conflict", "--yes"]), /not both/);
    await assert.rejects(add(api, ["--prompt-file", join(dir, "missing"), "--yes"]), /ENOENT/);
    assert.equal(api.writes.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
