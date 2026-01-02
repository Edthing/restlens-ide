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
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { RestLensClient } from "./api-client";
import { violationsToDiagnostics, isOpenAPIDocument, parseOpenAPISpec } from "./diagnostics";
import { DiagnosticsCache } from "./cache";
import type { RestLensConfig } from "@restlens-ide/shared";

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
      connection.sendDiagnostics({
        uri,
        diagnostics: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: DiagnosticSeverity.Error,
          message: "Invalid OpenAPI specification format",
          source: "REST Lens",
        }],
      });
      return;
    }

    // Show "evaluating" state while waiting
    connection.sendDiagnostics({
      uri,
      diagnostics: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: DiagnosticSeverity.Information,
        message: "Evaluating specification...",
        source: "REST Lens",
      }],
    });

    // Notify extension that evaluation started
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
// Start Server
// =============================================================================

documents.listen(connection);
connection.listen();
