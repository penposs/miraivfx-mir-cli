export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt?: string;
  canvasCount?: number;
}

export interface CanvasSummary {
  id: string;
  projectId: string;
  name: string;
  nodeCount: number;
  revision: number;
  updatedAt?: string;
}

export interface ModelLibrary {
  task: "image" | "video" | "audio" | "text" | "all";
  models: ModelItem[];
}

export interface ModelItem {
  modelId: string;
  displayName: string;
  task: string;
  nodeType: string;
  enabled: boolean;
  parameterSchema: Record<string, unknown>;
}
