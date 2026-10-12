import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { parseCookieHeader, serializeCookieHeader, type CookieOptions } from "@supabase/ssr";
import type { McpConfig } from "./config.server";

export const MCP_NONCE_COOKIE = "__Host-vosio-mcp-nonce";
export const MCP_PENDING_COOKIE = "__Host-vosio-mcp-pending";
type Context = { config: McpConfig; cookies: Map<string, string>; setCookies: string[] };
export const requestContext = new AsyncLocalStorage<Context>();

// Forward only this project's Supabase auth cookies and the two MCP binding cookies.
export function filterMcpCookies(header: string, publicSupabaseUrl: string) {
  const base = `sb-${new URL(publicSupabaseUrl).hostname.split(".")[0]}-auth-token`;
  return parseCookieHeader(header).filter(({ name, value }) => value !== undefined && (name === MCP_NONCE_COOKIE || name === MCP_PENDING_COOKIE || name === base || name === `${base}-code-verifier` || name.startsWith(`${base}.`) && /^\d+$/.test(name.slice(base.length + 1))));
}

// Expose a request-scoped cookie jar to the existing Supabase SSR identity flow.
export async function getRequestCookies() {
  const context = requestContext.getStore();
  if (!context) throw new Error("MCP request unavailable.");
  return { get: (name: string) => context.cookies.has(name) ? { value: context.cookies.get(name)! } : undefined,
    getAll: () => [...context.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: CookieOptions) => { context.cookies.set(name, value); context.setCookies.push(serializeCookieHeader(name, value, options)); } };
}

// Keep refreshed auth cookies isolated across concurrent requests.
export async function runMcpRequest(request: Request, config: McpConfig, run: () => Promise<Response>) {
  const context: Context = { config, cookies: new Map(filterMcpCookies(request.headers.get("cookie") ?? "", config.publicSupabaseUrl).map(({ name, value }) => [name, value!])), setCookies: [] };
  return requestContext.run(context, async () => {
    const response = await run();
    for (const cookie of context.setCookies) response.headers.append("Set-Cookie", cookie);
    return response;
  });
}

// Create mutable standard redirects for URLs validated by OAuth custody.
export function redirectResponse(url: string | URL, status = 303) { return new Response(null, { status, headers: { Location: String(url) } }); }

// Bind browser OAuth without folding multiple Set-Cookie fields.
export function setBindingCookie(response: Response, name: string, value: string, maxAge: number) {
  response.headers.append("Set-Cookie", serializeCookieHeader(name, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge }));
}
