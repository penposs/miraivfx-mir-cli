export interface CreateCanvasInput {
  projectId: string;
  name: string;
}

export interface InspectCanvasInput {
  canvasId: string;
  mode: "summary" | "full";
}
