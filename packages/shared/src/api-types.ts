/**
 * REST Lens API Types
 *
 * Types matching the REST Lens API responses and SEORA evaluation results.
 */

// =============================================================================
// Violation Types (matching SEORA)
// =============================================================================

export enum ViolationKeyType {
  OPERATION_ID = "operation_id",
  PATH = "path",
  SCHEMA_PATH = "schema_path",
  HTTP_CODE = "http_code",
  TAG = "tag",
  INFO = "info",
  SYSTEM = "system",
}

export interface ViolationKey {
  violation_key_type: ViolationKeyType;
  operation_id?: string;
  path?: string;
  schema_path?: string;
  http_code?: string;
  tag?: string;
}

export type Severity = "info" | "warning" | "error";

export interface Violation {
  rule_id: number;
  message: string;
  severity?: Severity;
  rule_slug?: string;
}

export interface ViolationKV {
  key: ViolationKey;
  value: Violation[];
}

// =============================================================================
// Rule Types
// =============================================================================

export interface RuleMetadata {
  rule_id: number;
  name: string;
  description: string;
  hidden: boolean;
}

export interface RulesConfig {
  config: Record<number, Record<string, string>>;
  enabled: Record<number, boolean>;
  ignore: Record<number, ViolationKey[]>;
  ignore_all: ViolationKey[];
}

// =============================================================================
// Path Tree Types (from SEORA parser)
// =============================================================================

export enum HTTPMethod {
  GET = "get",
  POST = "post",
  PUT = "put",
  PATCH = "patch",
  DELETE = "delete",
  OPTIONS = "options",
  HEAD = "head",
}

export interface PathNode {
  key: string;
  children: Record<string, PathNode>;
  methods: Record<HTTPMethod, unknown>;
}

// =============================================================================
// API Response Types
// =============================================================================

export type EvaluationStatus = "ready" | "evaluating" | "error" | "partial" | "stale";

export interface SpecificationUploadResponse {
  specification: {
    id: string;
    projectId: string;
    tag?: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface ViolationsResponse {
  evaluation: {
    status: EvaluationStatus;
    specId: string;
    message?: string;
    category?: string;
    staleRulesCount?: number;
  };
  violations?: ViolationKV[];
  tree?: PathNode;
  ruleIdToSlug?: Record<number, string>;
  billingWarning?: string;
}

export interface SpecificationsListResponse {
  specifications: Array<{
    id: string;
    tag?: string;
    createdAt: string;
  }>;
  evaluation?: {
    status: EvaluationStatus;
    specId: string;
    message?: string;
  };
  violations?: ViolationKV[];
  tree?: PathNode;
}

// =============================================================================
// OAuth Types
// =============================================================================

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
  project_ids?: string[];
}

export interface OAuthErrorResponse {
  error: string;
  error_description?: string;
}

// =============================================================================
// Error Types
// =============================================================================

export interface APIError {
  error: string;
  code?: string;
}

export class RestLensAPIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "RestLensAPIError";
  }
}
