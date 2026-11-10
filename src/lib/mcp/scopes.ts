import { z } from "zod";

export const MCP_SCOPE_READ = "vosio:read";
export const MCP_SCOPE_WRITE = "vosio:write";
export const MCP_SCOPE_CAPTURE = "vosio:capture";
// Every scope the bridge understands (grants, DCR, authorization); discovery advertises only MCP_DISCOVERY_SCOPES below.
export const MCP_SCOPES_SUPPORTED = [MCP_SCOPE_READ, MCP_SCOPE_WRITE, MCP_SCOPE_CAPTURE] as const;
// Scopes advertised in discovery: SDK clients fall back to scopes_supported when no scope is challenged, so capture must stay out of it.
export const MCP_DISCOVERY_SCOPES = [MCP_SCOPE_READ, MCP_SCOPE_WRITE] as const;
export type McpScope = (typeof MCP_SCOPES_SUPPORTED)[number];

// Browser-extension redirect URIs are exactly https://<32 letters a-p>.chromiumapp.org/..., mirroring the SQL check constraints.
const EXTENSION_REDIRECT = /^https:\/\/([a-p]{32})\.chromiumapp\.org\//;
export const mcpScopeEnum = z.enum(MCP_SCOPES_SUPPORTED);

// Derive the 32-letter extension ID from a verified chromiumapp.org redirect URI, or null for any other URI.
export function extensionIdFromRedirect(redirectUri: string | null | undefined) {
  return redirectUri ? EXTENSION_REDIRECT.exec(redirectUri)?.[1] ?? null : null;
}

// True when the set is exactly {capture}; capture can never be combined with read or write.
export function isCaptureScopeSet(scopes: readonly string[]) {
  return scopes.length > 0 && scopes.every((scope) => scope === MCP_SCOPE_CAPTURE);
}

// True for the only durable sets: {read}, {read,write} (write entails read) and {capture}; order and duplicates are ignored.
export function isValidMcpScopeSet(scopes: readonly string[]) {
  const set = new Set(scopes);
  if (!set.size) return false;
  if (set.has(MCP_SCOPE_CAPTURE)) return set.size === 1;
  return set.has(MCP_SCOPE_READ) && [...set].every((scope) => scope === MCP_SCOPE_READ || scope === MCP_SCOPE_WRITE);
}

// Zod schema for a stored scope set (at most two entries) that rejects every set outside the three allowed ones.
export const mcpScopeSetSchema = z.array(mcpScopeEnum).min(1).max(2).refine(isValidMcpScopeSet, "Unsupported scope set.");
