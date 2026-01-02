/**
 * REST Lens VS Code Extension
 *
 * Main extension entry point.
 */

import * as vscode from "vscode";
import * as path from "path";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import { TokenManager } from "./auth/token-manager";
import { OAuthFlow } from "./auth/oauth-flow";
import { StatusBar } from "./ui/status-bar";
import type { RestLensConfig } from "@restlens-ide/shared";

let client: LanguageClient | null = null;
let tokenManager: TokenManager;
let oauthFlow: OAuthFlow;
let statusBar: StatusBar;

export async function activate(context: vscode.ExtensionContext) {
  console.log("REST Lens extension activating...");

  // Initialize components
  tokenManager = new TokenManager(context);
  oauthFlow = new OAuthFlow(tokenManager);
  statusBar = new StatusBar();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("restlens.signIn", () => signIn()),
    vscode.commands.registerCommand("restlens.signOut", () => signOut()),
    vscode.commands.registerCommand("restlens.selectProject", () => selectProject()),
    vscode.commands.registerCommand("restlens.evaluate", () => evaluate()),
    vscode.commands.registerCommand("restlens.clearCache", () => clearCache())
  );

  // Start language server
  await startLanguageServer(context);

  // Update status bar based on auth state
  await updateStatusBar();

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("restlens")) {
        updateServerConfig();
      }
    })
  );

  console.log("REST Lens extension activated");
}

export function deactivate(): Thenable<void> | undefined {
  if (client) {
    return client.stop();
  }
  return undefined;
}

// =============================================================================
// Language Server
// =============================================================================

async function startLanguageServer(context: vscode.ExtensionContext) {
  const serverModule = context.asAbsolutePath(
    path.join("dist", "server", "server.js")
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "yaml" },
      { scheme: "file", language: "json" },
      { scheme: "file", pattern: "**/*.yaml" },
      { scheme: "file", pattern: "**/*.yml" },
      { scheme: "file", pattern: "**/*.json" },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/.restlens.json"),
    },
    initializationOptions: await getInitializationOptions(),
    // Disable pull diagnostics - we use push diagnostics
    middleware: {
      provideDiagnostics: () => undefined,
    },
  };

  client = new LanguageClient(
    "restlens",
    "REST Lens",
    serverOptions,
    clientOptions
  );

  await client.start();

  // Listen for evaluation status notifications
  client.onNotification("restlens/evaluationStarted", () => {
    statusBar.setEvaluating();
  });

  client.onNotification("restlens/evaluationComplete", (params: { violationCount: number; maxSeverity?: "error" | "warning" | "info" | null }) => {
    statusBar.setViolationCount(params.violationCount, params.maxSeverity ?? null);
  });
}

async function getInitializationOptions() {
  const config = await getConfigAsync();
  const accessToken = await tokenManager.getAccessToken();

  console.log("[REST Lens] Init options:", { config, hasToken: !!accessToken });

  return {
    config,
    accessToken,
  };
}

async function updateServerConfig() {
  if (!client) return;

  const config = await getConfigAsync();
  const accessToken = await tokenManager.getAccessToken();

  console.log("[REST Lens] Updating server config:", { config, hasToken: !!accessToken });

  client.sendNotification("restlens/updateConfig", {
    config,
    accessToken,
  });
}

async function getConfigAsync(): Promise<RestLensConfig> {
  const vsConfig = vscode.workspace.getConfiguration("restlens");

  // Get API URL from token manager (stored with auth)
  const storedApiUrl = await tokenManager.getApiUrl();

  // Organization and project come from VS Code workspace settings
  return {
    organization: vsConfig.get("organization") || "",
    project: vsConfig.get("project") || "",
    apiUrl: storedApiUrl || vsConfig.get("apiUrl") || "https://restlens.com",
    evaluateOnSave: vsConfig.get("evaluateOnSave") ?? true,
    evaluateOnType: vsConfig.get("evaluateOnType") ?? false,
    debounceMs: vsConfig.get("debounceMs") ?? 1000,
    includeInfoSeverity: vsConfig.get("includeInfoSeverity") ?? false,
  };
}

// =============================================================================
// Commands
// =============================================================================

async function signIn() {
  try {
    statusBar.setAuthenticating();

    // Get API URL from config (async to read .restlens.json)
    const config = await getConfigAsync();
    const apiUrl = await vscode.window.showInputBox({
      prompt: "REST Lens API URL",
      value: config.apiUrl || "https://restlens.com",
      validateInput: (value) => {
        try {
          new URL(value);
          return null;
        } catch {
          return "Invalid URL";
        }
      },
    });

    if (!apiUrl) {
      statusBar.setNotAuthenticated();
      return;
    }

    // Start OAuth flow
    await oauthFlow.startAuthFlow(apiUrl);

    // Flow continues in handleCallback via URI handler
    vscode.window.showInformationMessage(
      "Opening browser for REST Lens authentication..."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Sign in failed: ${message}`);
    statusBar.setNotAuthenticated();
  }
}

async function signOut() {
  try {
    await tokenManager.clearTokens();
    await updateServerConfig();
    await updateStatusBar();
    vscode.window.showInformationMessage("Signed out of REST Lens");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    vscode.window.showErrorMessage(`Sign out failed: ${message}`);
  }
}

interface ProjectInfo {
  id: string;
  name: string;
  organizationSlug: string;
}

async function fetchProjects(apiUrl: string, accessToken: string): Promise<ProjectInfo[]> {
  try {
    const response = await fetch(`${apiUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch projects: ${response.status}`);
      return [];
    }

    const data = await response.json() as { projects: ProjectInfo[] };
    return data.projects || [];
  } catch (error) {
    console.error("Error fetching projects:", error);
    return [];
  }
}

async function selectProject() {
  const accessToken = await tokenManager.getAccessToken();
  const apiUrl = await tokenManager.getApiUrl();

  if (!accessToken || !apiUrl) {
    vscode.window.showWarningMessage("Please sign in first.");
    return;
  }

  const projects = await fetchProjects(apiUrl, accessToken);

  if (projects.length === 0) {
    vscode.window.showWarningMessage(
      "No projects available. Please sign in again and select projects during authorization."
    );
    return;
  }

  const items = projects.map((p) => ({
    label: p.name,
    description: p.organizationSlug,
    project: p,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a project",
  });

  if (selected) {
    // Write to VS Code workspace settings (.vscode/settings.json)
    await writeProjectConfig(selected.project.organizationSlug, selected.project.name);
    vscode.window.showInformationMessage(`Selected project: ${selected.project.organizationSlug}/${selected.project.name}`);

    // Refresh config
    await updateServerConfig();
  }
}

async function writeProjectConfig(orgSlug: string, projectName: string) {
  // Write to VS Code workspace settings
  const config = vscode.workspace.getConfiguration("restlens");
  await config.update("organization", orgSlug, vscode.ConfigurationTarget.Workspace);
  await config.update("project", projectName, vscode.ConfigurationTarget.Workspace);
}

async function evaluate() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  // Save the document to trigger evaluation
  await editor.document.save();
  vscode.window.showInformationMessage("Evaluation triggered");
}

async function clearCache() {
  if (client) {
    // Notify server to clear cache
    client.sendNotification("restlens/updateConfig", {
      config: await getConfigAsync(),
      accessToken: await tokenManager.getAccessToken(),
    });
    vscode.window.showInformationMessage("Cache cleared");
  }
}

async function updateStatusBar() {
  const hasToken = await tokenManager.hasValidToken();

  if (hasToken) {
    statusBar.setAuthenticated();
  } else {
    statusBar.setNotAuthenticated();
  }
}

// Export for OAuth callback
export async function onAuthComplete() {
  const apiUrl = await tokenManager.getApiUrl();
  const token = await tokenManager.getAccessToken();

  vscode.window.showInformationMessage(`Signed in to: ${apiUrl}`);

  await updateServerConfig();
  await updateStatusBar();

  // Automatically trigger project selection
  await selectProject();
}
