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
      throw new Error(`Request failed: HTTP ${response.status}`);
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
      throw new Error(`Request failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private headers(): Record<string, string> {
    return this.options.token
      ? { Authorization: `Bearer ${this.options.token}` }
      : {};
  }
}
