/**
 * Diagnostics Converter
 *
 * Converts REST Lens violations to LSP diagnostics.
 */

import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  findViolationLine,
  isOpenAPIContent,
  parseOpenAPISpec,
  type ViolationKV,
  type Severity,
} from "@restlens/lib";

// =============================================================================
// OpenAPI Detection
// =============================================================================

/**
 * Check if a document appears to be an OpenAPI specification.
 * Returns true only for valid OpenAPI 3.x documents.
 */
export function isOpenAPIDocument(document: TextDocument): boolean {
  const text = document.getText();
  const languageId = document.languageId;

  // Must be YAML or JSON
  if (languageId !== "yaml" && languageId !== "json" && languageId !== "jsonc") {
    // Also check file extension via URI
    const uri = document.uri.toLowerCase();
    if (!uri.endsWith(".yaml") && !uri.endsWith(".yml") && !uri.endsWith(".json")) {
      return false;
    }
  }

  return isOpenAPIContent(text);
}

// Re-export parseOpenAPISpec from lib
export { parseOpenAPISpec };

// =============================================================================
// Violation to Diagnostic Conversion
// =============================================================================

/**
 * Convert REST Lens violations to LSP diagnostics.
 */
export function violationsToDiagnostics(
  violations: ViolationKV[],
  document: TextDocument,
  includeInfo: boolean
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const content = document.getText();

  for (const violation of violations) {
    const { key, value } = violation;

    // Create a diagnostic for each violation message
    for (const v of value) {
      // Skip info severity if not included
      if (!includeInfo && v.severity === "info") {
        continue;
      }

      // Use the shared line finder
      const pos = findViolationLine(key, content, v.message);

      // Convert to LSP Range (0-indexed lines)
      const range: Range = {
        start: { line: pos.line - 1, character: pos.column },
        end: { line: pos.line - 1, character: pos.endColumn },
      };

      diagnostics.push({
        range,
        severity: mapSeverity(v.severity),
        message: v.message,
        source: "REST Lens",
        code: v.rule_slug || v.rule_id,
      });
    }
  }

  return diagnostics;
}

/**
 * Map REST Lens severity to LSP DiagnosticSeverity.
 */
function mapSeverity(severity?: Severity): DiagnosticSeverity {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    default:
      return DiagnosticSeverity.Warning;
  }
}
