/**
 * Token Manager
 *
 * Manages OAuth tokens in VS Code SecretStorage.
 */

import * as vscode from "vscode";

const KEYS = {
  accessToken: "restlens.accessToken",
  refreshToken: "restlens.refreshToken",
  tokenExpiry: "restlens.tokenExpiry",
  projectIds: "restlens.projectIds",
  apiUrl: "restlens.apiUrl",
};

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  projectIds?: string[];
  apiUrl: string;
}

export class TokenManager {
  private secrets: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  /**
   * Store OAuth tokens.
   */
  async storeTokens(
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    apiUrl: string,
    projectIds?: string[]
  ): Promise<void> {
    const expiresAt = Date.now() + expiresIn * 1000;

    await Promise.all([
      this.secrets.store(KEYS.accessToken, accessToken),
      this.secrets.store(KEYS.refreshToken, refreshToken),
      this.secrets.store(KEYS.tokenExpiry, String(expiresAt)),
      this.secrets.store(KEYS.apiUrl, apiUrl),
      projectIds
        ? this.secrets.store(KEYS.projectIds, JSON.stringify(projectIds))
        : Promise.resolve(),
    ]);
  }

  /**
   * Get valid access token, refreshing if needed.
   */
  async getAccessToken(): Promise<string | null> {
    const accessToken = await this.secrets.get(KEYS.accessToken);
    if (!accessToken) return null;

    const expiryStr = await this.secrets.get(KEYS.tokenExpiry);
    const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;

    // If token expires in less than 1 minute, refresh it
    if (Date.now() > expiry - 60000) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        const newToken = await this.secrets.get(KEYS.accessToken);
        return newToken ?? null;
      }
      return null;
    }

    return accessToken;
  }

  /**
   * Refresh the access token using the refresh token.
   */
  async refreshToken(): Promise<boolean> {
    const refreshToken = await this.secrets.get(KEYS.refreshToken);
    const apiUrl = await this.secrets.get(KEYS.apiUrl);

    if (!refreshToken || !apiUrl) {
      return false;
    }

    try {
      const response = await fetch(`${apiUrl}/api/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: "vscode_restlens",
          client_name: "REST Lens VS Code Extension",
        }),
      });

      if (!response.ok) {
        console.error("Token refresh failed:", response.status);
        await this.clearTokens();
        return false;
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        project_ids?: string[];
      };

      await this.storeTokens(
        data.access_token,
        data.refresh_token,
        data.expires_in,
        apiUrl,
        data.project_ids
      );

      return true;
    } catch (error) {
      console.error("Token refresh error:", error);
      return false;
    }
  }

  /**
   * Check if we have a valid token.
   */
  async hasValidToken(): Promise<boolean> {
    const token = await this.getAccessToken();
    return token !== null;
  }

  /**
   * Get stored project IDs.
   */
  async getProjectIds(): Promise<string[] | null> {
    const projectIdsStr = await this.secrets.get(KEYS.projectIds);
    if (!projectIdsStr) return null;

    try {
      return JSON.parse(projectIdsStr);
    } catch {
      return null;
    }
  }

  /**
   * Get stored API URL.
   */
  async getApiUrl(): Promise<string | null> {
    const url = await this.secrets.get(KEYS.apiUrl);
    return url ?? null;
  }

  /**
   * Clear all stored tokens.
   */
  async clearTokens(): Promise<void> {
    await Promise.all([
      this.secrets.delete(KEYS.accessToken),
      this.secrets.delete(KEYS.refreshToken),
      this.secrets.delete(KEYS.tokenExpiry),
      this.secrets.delete(KEYS.projectIds),
      this.secrets.delete(KEYS.apiUrl),
    ]);
  }
}
