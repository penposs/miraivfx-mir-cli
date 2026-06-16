export interface CreateProjectInput {
  name: string;
  requestId?: string;
}

export interface CreateProjectResult {
  projectId: string;
  defaultCanvasId?: string;
}
