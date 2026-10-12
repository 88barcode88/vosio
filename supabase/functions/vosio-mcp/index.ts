import { handleMcpEdge } from "./generated/lib/mcp/edge-handler.server.ts";

// Run only the explicitly deployed MCP Function; gateway auth is replaced by bridge authorization.
Deno.serve(handleMcpEdge);
