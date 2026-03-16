export class FeatmapClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const baseUrl = process.env.FEATMAP_BASE_URL;
    const apiKey = process.env.FEATMAP_API_KEY;

    if (!baseUrl) throw new Error("FEATMAP_BASE_URL environment variable is required");
    if (!apiKey) throw new Error("FEATMAP_API_KEY environment variable is required");

    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1/claude${path}`, {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Featmap API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  listProjects() {
    return this.request("GET", "/projects");
  }

  getFeatures(projectId: string) {
    return this.request("GET", `/projects/${projectId}/features`);
  }

  updateStatus(featureId: string, status: "OPEN" | "IN_PROGRESS" | "CLOSED") {
    return this.request("POST", `/features/${featureId}/status`, { status });
  }

  updateAnnotations(featureId: string, annotations: string) {
    return this.request("POST", `/features/${featureId}/annotations`, { annotations });
  }

  createFeature(projectId: string, payload: { subWorkflowId: string; milestoneId: string; title: string }) {
    return this.request("POST", `/projects/${projectId}/features`, payload);
  }

  updateDescription(featureId: string, description: string) {
    return this.request("PUT", `/features/${featureId}/description`, { description });
  }

  moveFeature(featureId: string, payload: { toMilestoneId: string; toSubWorkflowId: string; index?: number }) {
    return this.request("POST", `/features/${featureId}/move`, { index: 0, ...payload });
  }

  addComment(featureId: string, post: string) {
    return this.request("POST", `/features/${featureId}/comments`, { post });
  }
}
