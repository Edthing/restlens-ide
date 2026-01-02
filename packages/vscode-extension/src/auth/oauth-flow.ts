/**
 * OAuth Flow
 *
 * Implements OAuth 2.1 authorization code flow with PKCE for VS Code.
 * Uses a localhost callback server for reliable browser redirects.
 */

import * as vscode from "vscode";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "./pkce";
import { TokenManager } from "./token-manager";
import { startCallbackServer, stopCallbackServer } from "./callback-server";
import { OAUTH_CLIENT_ID, OAUTH_SCOPES } from "@restlens-ide/shared";

interface PendingAuth {
  apiUrl: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
}

export class OAuthFlow {
  private tokenManager: TokenManager;
  private pendingAuth: PendingAuth | null = null;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * Start the OAuth authorization flow.
   */
  async startAuthFlow(apiUrl: string): Promise<void> {
    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Start callback server and get the redirect URI
    const callbackPromise = startCallbackServer(state);

    // Wait a moment for server to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the callback URL from the server
    const { getCallbackUrl } = await import("./callback-server");
    const redirectUri = getCallbackUrl();

    if (!redirectUri) {
      throw new Error("Failed to start callback server");
    }

    // Store pending auth
    this.pendingAuth = {
      apiUrl,
      codeVerifier,
      state,
      redirectUri,
    };

    // Build authorization URL
    const authUrl = new URL(`${apiUrl}/api/oauth/authorize`);
    authUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("scope", OAUTH_SCOPES.join(" "));
    authUrl.searchParams.set("state", state);

    // Open browser
    await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

    // Wait for callback
    try {
      const result = await callbackPromise;

      if (result.error) {
        throw new Error(result.errorDescription || result.error);
      }

      if (result.code) {
        await this.exchangeCodeForTokens(result.code);

        // Trigger extension to update
        const { onAuthComplete } = await import("../extension");
        onAuthComplete();
      }
    } catch (error) {
      stopCallbackServer();
      throw error;
    } finally {
      this.pendingAuth = null;
    }
  }

  /**
   * Exchange authorization code for tokens.
   */
  private async exchangeCodeForTokens(code: string): Promise<void> {
    if (!this.pendingAuth) {
      throw new Error("No pending authentication");
    }

    const { apiUrl, codeVerifier, redirectUri } = this.pendingAuth;

    const response = await fetch(`${apiUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: OAUTH_CLIENT_ID,
        client_name: "REST Lens VS Code Extension",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error_description?: string; error?: string };
      throw new Error(
        errorData.error_description || errorData.error || "Token exchange failed"
      );
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      project_ids?: string[];
    };

    // Store tokens
    await this.tokenManager.storeTokens(
      data.access_token,
      data.refresh_token,
      data.expires_in,
      apiUrl,
      data.project_ids
    );
  }
}
