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

  // Check for OpenAPI 3.x identifier (more strict check)
  // Look for openapi: "3.x.x" or "openapi": "3.x.x"
  const oasYamlPattern = /^openapi:\s*["']?3\./m;
  const oasJsonPattern = /"openapi"\s*:\s*"3\./;

  return oasYamlPattern.test(text) || oasJsonPattern.test(text);
}

/**
 * Parse an OpenAPI specification from text.
 * Returns null if parsing fails or if it's not a valid OpenAPI spec.
 */
export function parseOpenAPISpec(content: string): object | null {
  try {
    let parsed: unknown;
    // Try JSON first
    if (content.trim().startsWith("{")) {
      parsed = JSON.parse(content);
    } else {
      // Then YAML
      parsed = parseYaml(content);
    }

    // Validate it's an object with openapi or swagger field
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      ("openapi" in parsed || "swagger" in parsed)
    ) {
      return parsed as object;
    }

    return null;
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

    // Create a diagnostic for each violation message
    for (const v of value) {
      // Skip info severity if not included
      if (!includeInfo && v.severity === "info") {
        continue;
      }

      // Find the range for this specific violation (message helps locate schema properties)
      const range = findViolationRange(key, content, yamlDoc, v.message);

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
  _yamlDoc: YamlDocument | null,
  message?: string
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
        return findPathRange(key.path, content, lines, message) || defaultRange;

      case "schema_path":
        return findSchemaRange(key.schema_path, content, lines, message) || defaultRange;

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
 * Only searches within the "paths:" section to avoid matching schema refs.
 */
function findPathRange(
  path: string | undefined,
  content: string,
  lines: string[],
  message?: string
): Range | null {
  // Find the paths section boundaries
  const pathsMatch = content.match(/^paths:\s*$/m);
  const jsonPathsMatch = content.match(/"paths"\s*:\s*\{/);

  if (!pathsMatch && !jsonPathsMatch) return null;

  const pathsIndex = pathsMatch ? content.indexOf(pathsMatch[0]) : content.indexOf('"paths"');
  if (pathsIndex === -1) return null;

  // Find the end of paths section (next top-level key like "components:" or end of file)
  const afterPaths = content.slice(pathsIndex);
  const nextSectionMatch = afterPaths.match(/\n[a-zA-Z][a-zA-Z0-9]*:/);
  const pathsEndIndex = nextSectionMatch
    ? pathsIndex + (nextSectionMatch.index || afterPaths.length)
    : content.length;

  // Only search within the paths section
  const pathsSection = content.slice(pathsIndex, pathsEndIndex);
  const pathsSectionStart = pathsIndex;

  // If we have a path, search for it
  if (path) {
    // Search for path key with proper indentation
    const patterns = [
      `\n  ${path}:`,      // YAML with 2-space indent
      `\n    ${path}:`,    // YAML with 4-space indent
      `"${path}":`,        // JSON style
      `'${path}':`,        // Single-quoted
    ];

    for (const pattern of patterns) {
      const relativeIndex = pathsSection.indexOf(pattern);
      if (relativeIndex !== -1) {
        const absoluteIndex = pathsSectionStart + relativeIndex;
        // Adjust for leading newline in pattern
        const adjustedIndex = pattern.startsWith("\n") ? absoluteIndex + 1 : absoluteIndex;
        const patternLength = pattern.startsWith("\n") ? pattern.length - 1 : pattern.length;
        return indexToRange(adjustedIndex, patternLength, content, lines);
      }
    }

    // If full path not found, try to find a path that contains underscores (for underscore violations)
    if (message?.toLowerCase().includes("underscore")) {
      // Find any path with underscores in the paths section
      const underscorePathMatch = pathsSection.match(/\n\s+(\/[^:\s]*_[^:\s]*):/);
      if (underscorePathMatch) {
        const relativeIndex = pathsSection.indexOf(underscorePathMatch[0]);
        const absoluteIndex = pathsSectionStart + relativeIndex + 1; // +1 for newline
        return indexToRange(absoluteIndex, underscorePathMatch[1].length + 1, content, lines);
      }
    }

    // Try to find the path that contains any segment
    const segments = path.split("/").filter(Boolean);
    for (const segment of segments) {
      // Skip path parameters like {petId}
      if (segment.startsWith("{")) continue;

      // Look for paths containing this segment (must be within paths section)
      const segmentPatterns = [
        new RegExp(`\\n\\s+"?/${segment}[/":]`, "g"),  // JSON or YAML path containing segment
        new RegExp(`\\n\\s+/${segment}[/":]`, "g"),     // YAML path containing segment
      ];

      for (const pattern of segmentPatterns) {
        const match = pattern.exec(pathsSection);
        if (match) {
          const absoluteIndex = pathsSectionStart + match.index + 1; // +1 for newline
          return indexToRange(absoluteIndex, match[0].length - 1, content, lines);
        }
      }
    }
  }

  // Fallback: if message mentions underscore, find any path with underscores
  if (message?.toLowerCase().includes("underscore")) {
    const underscorePathMatch = pathsSection.match(/\n\s+(\/[^:\s]*_[^:\s]*):/);
    if (underscorePathMatch) {
      const relativeIndex = pathsSection.indexOf(underscorePathMatch[0]);
      const absoluteIndex = pathsSectionStart + relativeIndex + 1;
      return indexToRange(absoluteIndex, underscorePathMatch[1].length + 1, content, lines);
    }
  }

  return null;
}

/**
 * Find range for a schema definition or property.
 * Handles paths like:
 * - #/components/schemas/Pet
 * - Pet (schema name)
 * Also extracts property names from violation messages.
 */
function findSchemaRange(
  schemaPath: string | undefined,
  content: string,
  lines: string[],
  message?: string
): Range | null {
  if (!schemaPath) return null;

  // Extract property name from message if present
  // Messages like: "Schema property 'petStatus' contains..."
  const propertyMatch = message?.match(/Schema property '([^']+)'/);
  const propertyName = propertyMatch?.[1];

  // Get the schema name (last part of path, or the path itself)
  const parts = schemaPath.replace(/^#\//, "").split("/");
  const schemaName = parts[parts.length - 1] || schemaPath;

  // Find the schema first
  const schemaPatterns = [
    `${schemaName}:`,
    `"${schemaName}":`,
  ];

  let schemaStart = -1;
  for (const pattern of schemaPatterns) {
    schemaStart = content.indexOf(pattern);
    if (schemaStart !== -1) break;
  }

  // If we have a property name and found the schema, search within the schema
  if (propertyName && schemaStart !== -1) {
    // Find the next schema (to limit search scope)
    const afterSchema = content.slice(schemaStart);
    const nextSchemaMatch = afterSchema.match(/\n  [A-Z][a-zA-Z0-9]*:/);
    const schemaEnd = nextSchemaMatch
      ? schemaStart + (nextSchemaMatch.index || afterSchema.length)
      : content.length;

    const schemaSection = content.slice(schemaStart, schemaEnd);

    // Now find the property within this schema
    const propPatterns = [
      `${propertyName}:`,
      `"${propertyName}":`,
    ];

    for (const pattern of propPatterns) {
      const propIndex = schemaSection.indexOf(pattern);
      if (propIndex !== -1) {
        return indexToRange(schemaStart + propIndex, pattern.length, content, lines);
      }
    }
  }

  // Fall back to schema name
  if (schemaStart !== -1) {
    const pattern = schemaPatterns.find(p => content.indexOf(p) === schemaStart)!;
    return indexToRange(schemaStart, pattern.length, content, lines);
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
