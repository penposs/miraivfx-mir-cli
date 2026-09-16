// Reviewed against the web Sidebar, context menu, tool actions and NodeType.
// Backend safe_canvas_node_types also includes historical serialization types.
export const NODE_TITLES: Record<string, string> = {
  text: "文本便签", "image-item": "参考图", "video-item": "视频素材",
  image: "AI 生图", seedance2: "特惠视频生成 seedance minimax",
  agent: "提示词agent", seedance: "Seedance 提示词助手", suno: "Suno 音乐",
  "panorama-gen": "全景图生成", "depth-map": "深度视频",
  "pro-camera": "专业相机", "v-camera": "虚拟实拍",
  audio: "音频素材", file: "文件素材", relay: "集线器",
  "drawing-board": "画板", "frame-extractor": "抽帧", upscale: "超分",
  resize: "调整尺寸", "smart-split": "智能切分", "panorama-split": "全景预览",
};

export const CANVAS_NODE_TYPES = new Set(Object.keys(NODE_TITLES));
export const SIDEBAR_NODE_TYPES = [
  "image", "image-item", "seedance2", "pro-camera", "v-camera", "text",
  "agent", "suno", "seedance", "panorama-gen", "depth-map",
];

// Migration guidance only: these types cannot be created, updated or cloned.
export const RETIRED_NODE_TYPES: Record<string, string> = {
  video: "seedance2", "megaby-video": "seedance2", llm: "agent",
  "seedance-volc": "seedance2", "seedance2-rh-standard": "seedance2",
  "vibex-webapp": "seedance2", runninghub: "seedance2",
  "seedance2-runninghub": "seedance2", "sora2-runninghub": "seedance2",
  "rh-config": "seedance2", "rh-param": "seedance2", "rh-main": "seedance2",
  "blocking-3d": "v-camera",
};

export const NODE_ACTION_ALIASES: Record<string, string> = {
  "add-text": "text", "add-audio": "audio", "add-video-reference": "video-item",
  "add-audio-reference": "audio", "add-file": "file", "add-agent": "agent",
  "add-suno": "suno", "add-seedance": "seedance", "add-seedance2": "seedance2",
  "add-depth-map": "depth-map", "add-pro-camera": "pro-camera",
  "add-panorama-gen": "panorama-gen", "add-v-camera": "v-camera",
  "add-drawing-board": "drawing-board", "add-frame-extractor": "frame-extractor",
  "add-upscale": "upscale", "add-resize": "resize", "add-smart-split": "smart-split",
  "add-panorama-split": "panorama-split", "add-relay": "relay",
};

const RETIRED_ALIASES: Record<string, string> = {
  "add-seedance-rh": "seedance2-rh-standard", "add-vibex": "vibex-webapp",
};

export function assertCurrentNodeType(type: string): void {
  if (Object.hasOwn(RETIRED_NODE_TYPES, type)) {
    throw new Error(`Retired node type: ${type}. Use --type ${RETIRED_NODE_TYPES[type]} and its current parameters; legacy parameters are not migrated automatically.`);
  }
  if (!CANVAS_NODE_TYPES.has(type)) throw new Error(`Unsupported node type: ${type}`);
}

export function assertCurrentNodeAction(action: string): void {
  const type = RETIRED_ALIASES[action] ?? (action.startsWith("add-") ? action.slice(4) : "");
  if (Object.hasOwn(RETIRED_NODE_TYPES, type)) assertCurrentNodeType(type);
}

export function nodeCatalog() {
  return {
    node_types: [...CANVAS_NODE_TYPES].map(type => ({ type, label: NODE_TITLES[type] })),
    safe_canvas_node_types: [...CANVAS_NODE_TYPES],
    sidebar_node_types: SIDEBAR_NODE_TYPES,
    aliases: NODE_ACTION_ALIASES,
    retired_node_types: RETIRED_NODE_TYPES,
  };
}

export function currentCanvasCapabilities(server: Record<string, unknown>) {
  const serverTypes = Array.isArray(server.safe_canvas_node_types)
    ? server.safe_canvas_node_types as string[] : [];
  const available = [...CANVAS_NODE_TYPES].filter(type => serverTypes.includes(type));
  return {
    ...server,
    server_safe_canvas_node_types: serverTypes,
    safe_canvas_node_types: available,
    sidebar_node_types: SIDEBAR_NODE_TYPES.filter(type => available.includes(type)),
    cli_node_types: nodeCatalog().node_types.filter(node => available.includes(node.type)),
    retired_node_types: RETIRED_NODE_TYPES,
  };
}
