/**
 * REST Lens IDE - Shared Types
 *
 * Re-exports from @restlens/lib for backwards compatibility.
 */

// Re-export all types from the shared library
export * from "@restlens/lib";

// Export IDE-specific config values that aren't in lib
export { OAUTH_CLIENT_ID } from "./config.js";
