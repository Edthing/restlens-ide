/**
 * REST Lens Language Server
 *
 * LSP server that validates OpenAPI specifications against REST Lens rules.
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  Diagnostic,
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Command,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { RestLensClient, ViolationKey } from "./api-client";
import { violationsToDiagnostics, isOpenAPIDocument, parseOpenAPISpec } from "./diagnostics";
import { DiagnosticsCache } from "./cache";
import type { RestLensConfig, ViolationKV } from "@restlens-ide/shared";

// Store violation data for code actions
interface ViolationData {
  ruleId: number;
  ruleSlug: string;
  violationKey: ViolationKey;
  message: string;
}

// Map from diagnostic key (uri + range + message) to violation data
const violationDataMap = new Map<string, ViolationData>();

function getDiagnosticKey(uri: string, diagnostic: Diagnostic): string {
  return `${uri}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.message}`;
}

function storeViolationData(uri: string, violations: ViolationKV[], diagnostics: Diagnostic[]): void {
  // Clear old data for this URI
  for (const key of violationDataMap.keys()) {
    if (key.startsWith(uri)) {
      violationDataMap.delete(key);
    }
  }

  // Map diagnostics to their violation data
  // Diagnostics are created in the same order as violations
  let diagIndex = 0;
  for (const vkv of violations) {
    const violationKey: ViolationKey = {
      path: vkv.key.path,
      operation_id: vkv.key.operation_id,
      http_code: vkv.key.http_code,
      schema_path: vkv.key.schema_path,
    };

    for (const v of vkv.value) {
      if (diagIndex >= diagnostics.length) break;

      const diagnostic = diagnostics[diagIndex];
      // Skip if this diagnostic doesn't match (might be filtered due to severity)
      if (diagnostic.message !== v.message) continue;

      const key = getDiagnosticKey(uri, diagnostic);
      violationDataMap.set(key, {
        ruleId: v.rule_id || 0,
        ruleSlug: v.rule_slug || `rule-${v.rule_id}`,
        violationKey,
        message: v.message,
      });

      diagIndex++;
    }
  }
}

// =============================================================================
// Server State
// =============================================================================

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const cache = new DiagnosticsCache();

let apiClient: RestLensClient | null = null;
let config: RestLensConfig = {};
let accessToken: string | null = null;

// Debounce timers per document
const debounceTimers = new Map<string, NodeJS.Timeout>();

// =============================================================================
// Initialization
// =============================================================================

connection.onInitialize((params: InitializeParams): InitializeResult => {
  // Get configuration from initialization options
  const initOptions = params.initializationOptions || {};
  config = initOptions.config || {};
  accessToken = initOptions.accessToken || null;

  // Can't use connection.console here - not ready yet
  console.error(`[INIT] Config received: ${JSON.stringify(config)}`);
  console.error(`[INIT] Has token: ${!!accessToken}`);

  if (accessToken && config.apiUrl) {
    apiClient = new RestLensClient({
      baseUrl: config.apiUrl,
      accessToken,
      orgSlug: config.organization || "",
      projectSlug: config.project || "",
      logger: () => {},  // Silent by default
    });
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // We use push diagnostics (sendDiagnostics), not pull
      // Hover for rule documentation (future)
      hoverProvider: true,
      // Code actions for quick fixes (ignore rule/location)
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
      // Execute command for applying ignores
      executeCommandProvider: {
        commands: ["restlens.ignoreRule", "restlens.ignoreGlobal"],
      },
    },
  };
});

connection.onInitialized(() => {
  connection.console.log("REST Lens Language Server initialized");
});

// =============================================================================
// Configuration Updates
// =============================================================================

connection.onNotification("restlens/updateConfig", (params: {
  config: RestLensConfig;
  accessToken: string | null;
}) => {
  config = params.config;
  accessToken = params.accessToken;

  if (accessToken && config.apiUrl) {
    apiClient = new RestLensClient({
      baseUrl: config.apiUrl,
      accessToken,
      orgSlug: config.organization || "",
      projectSlug: config.project || "",
      logger: () => {},  // Silent by default
    });
    connection.console.log("REST Lens client configured");
  } else {
    apiClient = null;
    connection.console.log("REST Lens client cleared (no token)");
  }

  // Clear cache and re-validate all documents
  cache.clear();
  documents.all().forEach((doc) => validateDocument(doc));
});

// =============================================================================
// Document Validation
// =============================================================================

async function validateDocument(document: TextDocument): Promise<void> {
  const uri = document.uri;

  // Only validate OpenAPI documents
  if (!isOpenAPIDocument(document)) {
    connection.sendDiagnostics({ uri, diagnostics: [] });
    return;
  }

  // Check if we have a client configured
  if (!apiClient) {
    connection.sendDiagnostics({
      uri,
      diagnostics: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: DiagnosticSeverity.Information,
        message: "Sign in to REST Lens to see API design violations",
        source: "REST Lens",
      }],
    });
    return;
  }

  // Check if org/project is configured
  if (!config.organization || !config.project) {
    connection.sendDiagnostics({
      uri,
      diagnostics: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: DiagnosticSeverity.Information,
        message: "Run 'REST Lens: Select Project' to enable evaluation",
        source: "REST Lens",
      }],
    });
    return;
  }

  // Check cache first
  const content = document.getText();
  const cached = cache.get(content);
  if (cached) {
    connection.sendDiagnostics({ uri, diagnostics: cached });
    return;
  }

  try {
    // Parse the spec
    const spec = parseOpenAPISpec(content);
    if (!spec) {
      // Not a valid OpenAPI spec - silently clear diagnostics
      connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    // Notify extension that evaluation started (keep existing diagnostics visible)
    connection.sendNotification("restlens/evaluationStarted", { uri });

    // Upload and evaluate
    const result = await apiClient.evaluateSpec(spec);

    // Calculate max severity from violations
    const violationsList = result.violations || [];
    let hasError = false;
    let hasWarning = false;
    let hasInfo = false;
    for (const vkv of violationsList) {
      for (const v of (vkv.value || [])) {
        const sev = (v as { severity?: string }).severity;
        if (sev === "error") hasError = true;
        else if (sev === "warning") hasWarning = true;
        else if (sev === "info") hasInfo = true;
      }
      if (hasError) break;
    }
    const maxSeverity = hasError ? "error" : hasWarning ? "warning" : hasInfo ? "info" : null;

    // Notify extension that evaluation completed
    connection.sendNotification("restlens/evaluationComplete", {
      uri,
      violationCount: violationsList.length,
      maxSeverity,
    });

    // Convert violations to diagnostics
    const diagnostics = violationsToDiagnostics(
      result.violations || [],
      document,
      config.includeInfoSeverity ?? false
    );

    // Store violation data for code actions
    storeViolationData(uri, violationsList, diagnostics);

    // Cache and send
    cache.set(content, diagnostics);
    connection.sendDiagnostics({ uri, diagnostics });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    connection.console.error(`Validation error: ${message}`);

    // Show error as diagnostic
    connection.sendDiagnostics({
      uri,
      diagnostics: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: DiagnosticSeverity.Warning,
        message: `REST Lens: ${message}`,
        source: "REST Lens",
      }],
    });
  }
}

function scheduleValidation(document: TextDocument): void {
  const uri = document.uri;
  const debounceMs = config.debounceMs ?? 1000;

  // Clear existing timer
  const existingTimer = debounceTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new validation
  const timer = setTimeout(() => {
    debounceTimers.delete(uri);
    validateDocument(document);
  }, debounceMs);

  debounceTimers.set(uri, timer);
}

// =============================================================================
// Document Events
// =============================================================================

documents.onDidOpen((event) => {
  console.error(`[OPEN] Document opened: ${event.document.uri}`);
  validateDocument(event.document);
});

documents.onDidChangeContent((event) => {
  if (config.evaluateOnType) {
    scheduleValidation(event.document);
  }
});

documents.onDidSave((event) => {
  if (config.evaluateOnSave !== false) {
    validateDocument(event.document);
  }
});

documents.onDidClose((event) => {
  // Clear debounce timer
  const timer = debounceTimers.get(event.document.uri);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(event.document.uri);
  }
  // Clear diagnostics
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// =============================================================================
// Hover Provider (Future: Rule Documentation)
// =============================================================================

connection.onHover((params) => {
  // TODO: Show rule documentation when hovering over violations
  return null;
});

// Handle diagnostic pull requests (we use push diagnostics, so return empty)
connection.onRequest("textDocument/diagnostic", (params) => {
  connection.console.log(`Pull diagnostic request for: ${params?.textDocument?.uri}`);
  return { kind: "full", items: [] };
});

// =============================================================================
// Code Actions (Quick Fixes)
// =============================================================================

connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  const actions: CodeAction[] = [];
  const uri = params.textDocument.uri;

  // Only provide actions for REST Lens diagnostics
  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source !== "REST Lens") continue;

    const key = getDiagnosticKey(uri, diagnostic);
    const violationData = violationDataMap.get(key);

    if (!violationData) continue;

    // Action 1: Ignore this rule for this location
    actions.push({
      title: `Ignore "${violationData.ruleSlug}" for this location`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      command: {
        title: "Ignore Rule",
        command: "restlens.ignoreRule",
        arguments: [violationData.ruleId, violationData.violationKey, uri],
      },
    });

    // Action 2: Ignore all rules for this location
    actions.push({
      title: `Ignore all rules for this location`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      command: {
        title: "Ignore All",
        command: "restlens.ignoreGlobal",
        arguments: [violationData.violationKey, uri],
      },
    });
  }

  return actions;
});

// =============================================================================
// Execute Commands (Apply Ignores)
// =============================================================================

connection.onExecuteCommand(async (params) => {
  if (!apiClient) {
    connection.window.showErrorMessage("REST Lens: Not authenticated");
    return;
  }

  try {
    if (params.command === "restlens.ignoreRule") {
      const [ruleId, violationKey, uri] = params.arguments as [number, ViolationKey, string];
      await apiClient.addRuleIgnore(ruleId, violationKey);
      connection.window.showInformationMessage(`REST Lens: Rule ignored for this location`);
      // Re-validate to update diagnostics
      const document = documents.get(uri);
      if (document) {
        cache.clear(); // Clear cache to force re-fetch
        validateDocument(document);
      }
    } else if (params.command === "restlens.ignoreGlobal") {
      const [violationKey, uri] = params.arguments as [ViolationKey, string];
      await apiClient.addGlobalIgnore(violationKey);
      connection.window.showInformationMessage(`REST Lens: All rules ignored for this location`);
      // Re-validate to update diagnostics
      const document = documents.get(uri);
      if (document) {
        cache.clear(); // Clear cache to force re-fetch
        validateDocument(document);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    connection.window.showErrorMessage(`REST Lens: ${message}`);
  }
});

// =============================================================================
// Start Server
// =============================================================================

documents.listen(connection);
connection.listen();
