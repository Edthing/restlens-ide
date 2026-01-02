/**
 * Diagnostics Converter
 *
 * Converts REST Lens violations to LSP diagnostics.
 */

import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parse as parseYaml, Document as YamlDocument, isMap, isSeq, isPair, Pair, Scalar, YAMLMap } from "yaml";
import type { ViolationKV, ViolationKeyType, Severity } from "@restlens-ide/shared";

// =============================================================================
// OpenAPI Detection
// =============================================================================

/**
 * Check if a document appears to be an OpenAPI specification.
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

  // Check for OpenAPI identifier
  return text.includes("openapi:") || text.includes('"openapi"');
}

/**
 * Parse an OpenAPI specification from text.
 */
export function parseOpenAPISpec(content: string): object | null {
  try {
    // Try JSON first
    if (content.trim().startsWith("{")) {
      return JSON.parse(content);
    }
    // Then YAML
    return parseYaml(content) as object;
  } catch {
    return null;
  }
}

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

  // Parse YAML for position finding
  let yamlDoc: YamlDocument | null = null;
  try {
    yamlDoc = new YamlDocument(parseYaml(content, { keepSourceTokens: true }));
  } catch {
    // If parsing fails, we'll use line 0 for all diagnostics
  }

  for (const violation of violations) {
    const { key, value } = violation;

    // Find the range for this violation
    const range = findViolationRange(key, content, yamlDoc);

    // Create a diagnostic for each violation message
    for (const v of value) {
      // Skip info severity if not included
      if (!includeInfo && v.severity === "info") {
        continue;
      }

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

/**
 * Find the source range for a violation key.
 */
function findViolationRange(
  key: ViolationKV["key"],
  content: string,
  _yamlDoc: YamlDocument | null
): Range {
  const lines = content.split("\n");

  // Default range (first line)
  const defaultRange: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: lines[0]?.length || 0 },
  };

  try {
    switch (key.violation_key_type) {
      case "operation_id":
        return findOperationIdRange(key.operation_id, key.path, content, lines) || defaultRange;

      case "path":
        return findPathRange(key.path, content, lines) || defaultRange;

      case "schema_path":
        return findSchemaRange(key.schema_path, content, lines) || defaultRange;

      case "http_code":
        return findHttpCodeRange(key.http_code, key.path, key.operation_id, content, lines) || defaultRange;

      case "tag":
        return findTagRange(key.tag, content, lines) || defaultRange;

      case "info":
        return findInfoRange(content, lines) || defaultRange;

      case "system":
        // System-level violations go at the top of the file
        return defaultRange;

      default:
        return defaultRange;
    }
  } catch {
    return defaultRange;
  }
}

/**
 * Find range for an operation (by operation_id or path+method).
 */
function findOperationIdRange(
  operationId: string | undefined,
  path: string | undefined,
  content: string,
  lines: string[]
): Range | null {
  if (operationId) {
    // Search for operationId in content
    const patterns = [
      `operationId: ${operationId}`,
      `operationId: "${operationId}"`,
      `operationId: '${operationId}'`,
      `"operationId": "${operationId}"`,
    ];

    for (const pattern of patterns) {
      const index = content.indexOf(pattern);
      if (index !== -1) {
        return indexToRange(index, pattern.length, content, lines);
      }
    }
  }

  // Fall back to path
  if (path) {
    return findPathRange(path, content, lines);
  }

  return null;
}

/**
 * Find range for a path definition.
 */
function findPathRange(
  path: string | undefined,
  content: string,
  lines: string[]
): Range | null {
  if (!path) return null;

  // First, try to find the exact path under the "paths:" section
  const pathsIndex = content.indexOf("paths:");
  const searchStart = pathsIndex !== -1 ? pathsIndex : 0;
  const searchContent = content.slice(searchStart);

  // Search for path key with proper indentation (2 spaces for YAML)
  const patterns = [
    `\n  ${path}:`,      // YAML with 2-space indent
    `\n    ${path}:`,    // YAML with 4-space indent
    `${path}:`,          // Start of line or inline
    `"${path}":`,        // JSON style
    `'${path}':`,        // Single-quoted
  ];

  for (const pattern of patterns) {
    const relativeIndex = searchContent.indexOf(pattern);
    if (relativeIndex !== -1) {
      const absoluteIndex = searchStart + relativeIndex;
      // Adjust for leading newline in pattern
      const adjustedIndex = pattern.startsWith("\n") ? absoluteIndex + 1 : absoluteIndex;
      const patternLength = pattern.startsWith("\n") ? pattern.length - 1 : pattern.length;
      return indexToRange(adjustedIndex, patternLength, content, lines);
    }
  }

  // If full path not found, try to find the problematic segment
  // This handles cases like "/pets/{petId}" where we want to find "/pets"
  const segments = path.split("/").filter(Boolean);
  for (const segment of segments) {
    // Skip path parameters like {petId}
    if (segment.startsWith("{")) continue;

    const segmentPatterns = [
      `/${segment}`,
      `/${segment}/`,
      `/${segment}:`,
    ];

    for (const pattern of segmentPatterns) {
      const index = content.indexOf(pattern);
      if (index !== -1) {
        return indexToRange(index, pattern.length, content, lines);
      }
    }
  }

  return null;
}

/**
 * Find range for a schema definition.
 */
function findSchemaRange(
  schemaPath: string | undefined,
  content: string,
  lines: string[]
): Range | null {
  if (!schemaPath) return null;

  // Schema path format: #/components/schemas/SchemaName or just SchemaName
  const schemaName = schemaPath.split("/").pop() || schemaPath;

  const patterns = [
    `${schemaName}:`,
    `"${schemaName}":`,
  ];

  for (const pattern of patterns) {
    const index = content.indexOf(pattern);
    if (index !== -1) {
      return indexToRange(index, pattern.length, content, lines);
    }
  }

  return null;
}

/**
 * Find range for an HTTP status code.
 */
function findHttpCodeRange(
  httpCode: string | undefined,
  path: string | undefined,
  operationId: string | undefined,
  content: string,
  lines: string[]
): Range | null {
  if (!httpCode) return null;

  // Search for status code
  const patterns = [
    `${httpCode}:`,
    `"${httpCode}":`,
    `'${httpCode}':`,
  ];

  for (const pattern of patterns) {
    const index = content.indexOf(pattern);
    if (index !== -1) {
      return indexToRange(index, pattern.length, content, lines);
    }
  }

  // Fall back to operation or path
  return findOperationIdRange(operationId, path, content, lines);
}

/**
 * Find range for a tag definition.
 */
function findTagRange(
  tag: string | undefined,
  content: string,
  lines: string[]
): Range | null {
  if (!tag) return null;

  const patterns = [
    `- ${tag}`,
    `- "${tag}"`,
    `name: ${tag}`,
    `name: "${tag}"`,
  ];

  for (const pattern of patterns) {
    const index = content.indexOf(pattern);
    if (index !== -1) {
      return indexToRange(index, pattern.length, content, lines);
    }
  }

  return null;
}

/**
 * Find range for the info section.
 */
function findInfoRange(content: string, lines: string[]): Range | null {
  const index = content.indexOf("info:");
  if (index !== -1) {
    return indexToRange(index, 5, content, lines);
  }
  return null;
}

/**
 * Convert a character index to a Range.
 */
function indexToRange(
  index: number,
  length: number,
  content: string,
  lines: string[]
): Range {
  let line = 0;
  let character = 0;
  let currentIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + 1; // +1 for newline
    if (currentIndex + lineLength > index) {
      line = i;
      character = index - currentIndex;
      break;
    }
    currentIndex += lineLength;
  }

  return {
    start: { line, character },
    end: { line, character: character + length },
  };
}
