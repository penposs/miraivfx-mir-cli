export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw await requestError(response);
    }
    return (await response.json()) as T;
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await requestError(response);
    }
    return (await response.json()) as T;
  }

  async putJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await requestError(response);
    }
    return (await response.json()) as T;
  }

  async postForm<T>(path: string, form: FormData): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    if (!response.ok) {
      throw await requestError(response);
    }
    return (await response.json()) as T;
  }

  async getBinary(path: string): Promise<{ data: Uint8Array; headers: Headers }> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw await requestError(response);
    }
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      headers: response.headers,
    };
  }

  private headers(): Record<string, string> {
    return this.options.token
      ? { Authorization: `Bearer ${this.options.token}` }
      : {};
  }
}

async function requestError(response: Response): Promise<Error> {
  let detail = "";
  try {
    const payload = await response.json() as Record<string, unknown>;
    const rawDetail = payload.detail ?? payload.error;
    if (typeof rawDetail === "string") detail = rawDetail;
    else if (rawDetail && typeof rawDetail === "object") {
      const object = rawDetail as Record<string, unknown>;
      detail = String(object.message ?? object.code ?? JSON.stringify(object));
    }
  } catch {
    detail = "";
  }
  return new Error(`Request failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
}
