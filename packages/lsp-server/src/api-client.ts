/**
 * REST Lens API Client
 *
 * Handles communication with the REST Lens API for spec evaluation.
 * This is a thin wrapper around the shared RestLensClient from @restlens/lib,
 * keeping compatibility with the existing LSP server implementation.
 */

import {
  RestLensClient as BaseRestLensClient,
  RestLensAPIError,
  type ViolationsResponse,
  type SpecificationUploadResponse,
} from "@restlens/lib";

// Re-export types for backwards compatibility
export { RestLensAPIError };

/**
 * Simplified ViolationKey for ignore API requests.
 * The ignore API only needs these fields, not the full ViolationKey with violation_key_type.
 */
export interface ViolationKey {
  path?: string;
  operation_id?: string;
  http_code?: string;
  schema_path?: string;
}

export interface RestLensClientOptions {
  baseUrl: string;
  accessToken: string;
  orgSlug: string;
  projectSlug: string;
  logger?: (msg: string) => void;
}

export class RestLensClient {
  private client: BaseRestLensClient;
  private log: (msg: string) => void;
  private orgSlug: string;
  private projectSlug: string;
  private baseUrl: string;
  private accessToken: string;

  constructor(options: RestLensClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.orgSlug = options.orgSlug;
    this.projectSlug = options.projectSlug;
    this.log = options.logger || console.log;

    this.client = new BaseRestLensClient({
      baseUrl: options.baseUrl,
      accessToken: options.accessToken,
      orgSlug: options.orgSlug,
      projectSlug: options.projectSlug,
      logger: options.logger,
    });

    this.log(`Client initialized: baseUrl=${this.baseUrl}, org=${this.orgSlug || '(empty)'}, project=${this.projectSlug || '(empty)'}`);
  }

  /**
   * Evaluate an OpenAPI specification.
   * Uploads the spec, waits for evaluation, and returns violations.
   */
  async evaluateSpec(spec: object): Promise<ViolationsResponse> {
    return this.client.evaluateSpec(spec, {
      tag: "ide-upload",
      orgSlug: this.orgSlug,
      projectSlug: this.projectSlug,
    });
  }

  /**
   * Add a global ignore (ignores all rules for this violation key).
   */
  async addGlobalIgnore(violationKey: ViolationKey): Promise<{ id: string }> {
    if (!this.orgSlug || !this.projectSlug) {
      throw new RestLensAPIError(400, "Organization and project must be configured", "missing_config");
    }

    const url = `${this.baseUrl}/api/projects/${encodeURIComponent(this.orgSlug)}/${encodeURIComponent(this.projectSlug)}/ignores`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ violationKey }),
    });

    if (!response.ok) {
      throw await RestLensAPIError.fromResponse(response);
    }

    return response.json() as Promise<{ id: string }>;
  }

  /**
   * Add a rule-specific ignore.
   */
  async addRuleIgnore(ruleId: number, violationKey: ViolationKey): Promise<{ id: string }> {
    if (!this.orgSlug || !this.projectSlug) {
      throw new RestLensAPIError(400, "Organization and project must be configured", "missing_config");
    }

    const url = `${this.baseUrl}/api/projects/${encodeURIComponent(this.orgSlug)}/${encodeURIComponent(this.projectSlug)}/rules/${ruleId}/ignores`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ violationKey }),
    });

    if (!response.ok) {
      throw await RestLensAPIError.fromResponse(response);
    }

    return response.json() as Promise<{ id: string }>;
  }
}
