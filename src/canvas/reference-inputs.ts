export const DEFAULT_VIDEO_MODEL = "seedance2-standard";

export function isDiscountVideoModel(id: string): boolean {
  return ["seedance2-", "botcf-", "bsutopia-"].some(prefix => id.startsWith(prefix));
}

type MediaKind = "image" | "video" | "audio";
export interface ReferenceInput { node_id: string; kind: MediaKind; label: string }

// Match the unified web node: connection order within each media kind determines numbering.
export function resolveReferenceInputs(nodes: unknown[], ids: string[]): ReferenceInput[] {
  const counts = { image: 0, video: 0, audio: 0 };
  return ids.map(id => {
    const node = nodes.find(value => value && typeof value === "object" && (value as any).id === id) as any;
    if (!node) throw new Error(`Reference node not found: ${id}`);
    const kinds: Record<string, MediaKind> = { "image-item": "image", "video-item": "video", audio: "audio" };
    const kind = kinds[node.type];
    if (!kind) throw new Error(`Reference ${id} must be an image-item, video-item or audio material node`);
    const url = String(node.data?.originalUrl || node.content || "").trim();
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) {
      throw new Error(`Reference ${id} has no uploaded media URL; upload the local file first`);
    }
    counts[kind] += 1;
    return { node_id: id, kind, label: `@${kind}${counts[kind]}` };
  });
}

export function validateVideoReferences(refs: ReferenceInput[], data: Record<string, unknown>, model: Record<string, any>): void {
  const id = String(model.model_id);
  const discount = isDiscountVideoModel(id);
  const hints = model.ui_hints ?? {};
  const policy = hints.megaby_video?.media_policy || hints.video_media_policy
    || model.parameter_schema?.x_megaby_video?.media_policy || {};
  // These are the current web adapters' fallbacks; explicit catalog policies take priority.
  const fallback = discount ? [9, 1, 3] : id === "megaby-video-2-5" ? [30, 10, 10] : [9, 3, 3];
  const counts = { image: 0, video: 0, audio: 0 };
  for (const ref of refs) counts[ref.kind] += 1;
  for (const [index, kind] of (["image", "video", "audio"] as const).entries()) {
    const raw = policy[`max_${kind === "audio" ? "audios" : `${kind}s`}`];
    const limit = raw !== undefined && Number.isInteger(Number(raw)) && Number(raw) >= 0 ? Number(raw) : fallback[index];
    if (counts[kind] > limit) throw new Error(`Model ${id} allows at most ${limit} ${kind} references; received ${counts[kind]}`);
  }
  const minImages = Number(hints.video_media_policy?.min_images ?? 0);
  if (counts.image < minImages) throw new Error(`Model ${id} requires at least ${minImages} image references`);
  if (data.use_first_last_frames === true && !(counts.image >= 1 && counts.image <= 2 && !counts.video && !counts.audio)) {
    throw new Error("First/last-frame mode requires 1–2 images and no video or audio references");
  }
}
