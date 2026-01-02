/**
 * REST Lens API Client
 *
 * Handles communication with the REST Lens API for spec evaluation.
 */

import {
  ViolationsResponse,
  SpecificationUploadResponse,
  RestLensAPIError,
} from "@restlens-ide/shared";

export interface RestLensClientOptions {
  baseUrl: string;
  accessToken: string;
  orgSlug: string;
  projectSlug: string;
  logger?: (msg: string) => void;
}

export class RestLensClient {
  private baseUrl: string;
  private accessToken: string;
  private orgSlug: string;
  private projectSlug: string;
  private log: (msg: string) => void;

  constructor(options: RestLensClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.orgSlug = options.orgSlug;
    this.projectSlug = options.projectSlug;
    this.log = options.logger || console.log;

    this.log(`Client initialized: baseUrl=${this.baseUrl}, org=${this.orgSlug || '(empty)'}, project=${this.projectSlug || '(empty)'}`);
  }

  /**
   * Evaluate an OpenAPI specification.
   * Uploads the spec, waits for evaluation, and returns violations.
   */
  async evaluateSpec(spec: object): Promise<ViolationsResponse> {
    // Upload the spec
    const uploadResult = await this.uploadSpec(spec);
    const specId = uploadResult.specification.id;

    // Poll for results
    return this.pollForResults(specId);
  }

  /**
   * Upload an OpenAPI specification.
   */
  private async uploadSpec(spec: object): Promise<SpecificationUploadResponse> {
    if (!this.orgSlug || !this.projectSlug) {
      throw new RestLensAPIError(400, "Organization and project must be configured in .restlens.json", "missing_config");
    }

    const url = `${this.baseUrl}/api/projects/${encodeURIComponent(this.orgSlug)}/${encodeURIComponent(this.projectSlug)}/specifications`;

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ spec, tag: "ide-upload" }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return response.json() as Promise<SpecificationUploadResponse>;
  }

  /**
   * Poll for evaluation results.
   */
  private async pollForResults(
    specId: string,
    maxAttempts = 30,
    intervalMs = 2000
  ): Promise<ViolationsResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.getViolations(specId);

      // Check status
      const status = result.evaluation?.status;
      if (status === "ready" || status === "partial" || status === "stale") {
        return result;
      }

      if (status === "error") {
        throw new RestLensAPIError(
          500,
          result.evaluation?.message || "Evaluation failed",
          result.evaluation?.category
        );
      }

      // Wait before next poll
      if (attempt < maxAttempts - 1) {
        await this.sleep(intervalMs);
      }
    }

    throw new RestLensAPIError(408, "Evaluation timeout");
  }

  /**
   * Get violations for a specification.
   */
  private async getViolations(specId: string): Promise<ViolationsResponse> {
    const url = `${this.baseUrl}/api/projects/${encodeURIComponent(this.orgSlug)}/${encodeURIComponent(this.projectSlug)}/specifications?specId=${specId}`;

    const response = await this.fetchWithRetry(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return response.json() as Promise<ViolationsResponse>;
  }

  /**
   * Fetch with retry logic for transient errors.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3
  ): Promise<Response> {
    let lastError: Error | null = null;

    this.log(`Fetching: ${url}`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(30000),
        });

        this.log(`Response: ${response.status} ${response.statusText}`);

        // Don't retry client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return response;
        }

        if (response.ok) {
          return response;
        }

        // Retry server errors (5xx)
        if (attempt < maxRetries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(`Fetch error (attempt ${attempt + 1}): ${lastError.message}`);
        if (attempt < maxRetries - 1) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError || new Error("Request failed");
  }

  /**
   * Handle error responses from the API.
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let message = "API request failed";
    let code: string | undefined;

    try {
      const body = await response.json() as { error?: string; code?: string };
      this.log(`Error response body: ${JSON.stringify(body)}`);
      message = body.error || message;
      code = body.code;
    } catch (e) {
      this.log(`Could not parse error response: ${e}`);
    }

    this.log(`API error: ${response.status} - ${message} (code: ${code || 'none'})`);

    switch (response.status) {
      case 401:
        throw new RestLensAPIError(401, "Invalid or expired token. Please sign in again.", code);
      case 402:
        throw new RestLensAPIError(402, message || "Insufficient credits", "billing_error");
      case 403:
        throw new RestLensAPIError(403, "Not authorized to access this project", code);
      case 404:
        throw new RestLensAPIError(404, "Project not found", code);
      case 413:
        throw new RestLensAPIError(413, "Specification too large (max 10MB)", code);
      case 429:
        throw new RestLensAPIError(429, "Rate limit exceeded. Please wait before retrying.", code);
      default:
        throw new RestLensAPIError(response.status, message, code);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Add a global ignore (ignores all rules for this violation key).
   */
  async addGlobalIgnore(violationKey: ViolationKey): Promise<{ id: string }> {
    if (!this.orgSlug || !this.projectSlug) {
      throw new RestLensAPIError(400, "Organization and project must be configured", "missing_config");
    }

    const url = `${this.baseUrl}/api/projects/${encodeURIComponent(this.orgSlug)}/${encodeURIComponent(this.projectSlug)}/ignores`;

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ violationKey }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
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

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ violationKey }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return response.json() as Promise<{ id: string }>;
  }
}

export interface ViolationKey {
  path?: string;
  operation_id?: string;
  http_code?: string;
  schema_path?: string;
}
