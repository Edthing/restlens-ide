/**
 * Configuration Types
 *
 * Types for .restlens.json workspace configuration.
 */

export interface RestLensConfig {
  /** Organization slug */
  organization?: string;

  /** Project slug */
  project?: string;

  /** REST Lens API URL (default: https://restlens.com) */
  apiUrl?: string;

  /** Evaluate on file save (default: true) */
  evaluateOnSave?: boolean;

  /** Evaluate on file change with debounce (default: false) */
  evaluateOnType?: boolean;

  /** Debounce delay in milliseconds (default: 1000) */
  debounceMs?: number;

  /** Include info-level violations (default: false) */
  includeInfoSeverity?: boolean;
}

export const DEFAULT_CONFIG: Required<RestLensConfig> = {
  organization: "",
  project: "",
  apiUrl: "https://restlens.com",
  evaluateOnSave: true,
  evaluateOnType: false,
  debounceMs: 1000,
  includeInfoSeverity: false,
};

export const DEFAULT_API_URL = "https://restlens.com";
export const STAGING_API_URL = "https://staging.restlens.com";

/** OAuth client ID for VS Code extension */
export const OAUTH_CLIENT_ID = "vscode_restlens";

/** OAuth scopes - IDE needs project read and spec upload access */
export const OAUTH_SCOPES = ["projects:read", "specs:write", "evaluations:read"];
