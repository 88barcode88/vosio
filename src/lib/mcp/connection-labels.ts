import { isCaptureScopeSet, MCP_SCOPE_WRITE } from "./scopes";

// Czech label of a connection's permission type, shared by /mcp/connections and the Settings section.
export function mcpConnectionTypeLabel(scopes: readonly string[]) {
  if (isCaptureScopeSet(scopes)) return "Rozšíření prohlížeče – nahrávání";
  return scopes.includes(MCP_SCOPE_WRITE) ? "Čtení a úpravy" : "Čtení";
}
