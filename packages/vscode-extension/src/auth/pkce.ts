/**
 * PKCE (Proof Key for Code Exchange) Helpers
 *
 * Implements PKCE for OAuth 2.1 authorization flow.
 */

import * as crypto from "crypto";

/**
 * Generate a cryptographically random code verifier.
 * Must be between 43 and 128 characters (RFC 7636).
 */
export function generateCodeVerifier(): string {
  const buffer = crypto.randomBytes(32);
  return buffer.toString("base64url");
}

/**
 * Generate code challenge from verifier using S256 method.
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return hash.toString("base64url");
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}
