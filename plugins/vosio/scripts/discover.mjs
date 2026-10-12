import { createHash } from "node:crypto";
import { pathToFileURL, URL } from "node:url";
import { TextDecoder } from "node:util";
import { resolve } from "node:path";
import process from "node:process";
import console from "node:console";

// Accept one explicit HTTPS installation origin, without credentials or URL normalization.
export function validateWebOrigin(value) {
  if (typeof value !== "string" || /[\s\\?#]/.test(value)) throw new Error("Zadejte HTTPS adresu svého Vosia bez cesty, parametrů a přihlašovacích údajů.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== value) throw new Error("Zadejte kanonickou HTTPS adresu svého Vosia, například https://vosio.example.");
  return url.origin;
}

// Pin discovery to the selected web issuer and the exact remote Vosio resource.
export function readInstallation(webOrigin, metadata) {
  const origin = validateWebOrigin(webOrigin);
  if (!metadata || typeof metadata !== "object" || metadata.issuer !== origin || metadata.authorization_endpoint !== `${origin}/api/mcp/oauth/authorize` || typeof metadata.token_endpoint !== "string") throw new Error("Vosio nevrátilo očekávanou OAuth konfiguraci této instalace.");
  const token = new URL(metadata.token_endpoint);
  if (/[\s\\?#]/.test(metadata.token_endpoint) || token.protocol !== "https:" || token.username || token.password || token.pathname !== "/functions/v1/vosio-mcp/oauth/token" || token.href !== metadata.token_endpoint) throw new Error("Vosio nevrátilo kanonický HTTPS MCP endpoint.");
  const mcpUrl = `${token.origin}/functions/v1/vosio-mcp`;
  if (metadata.registration_endpoint !== `${mcpUrl}/oauth/register` || metadata.revocation_endpoint !== `${mcpUrl}/oauth/revoke` || !Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes("S256")) throw new Error("Tato instalace nepodporuje požadované osobní připojení s automatickou registrací a PKCE.");
  const id = createHash("sha256").update(mcpUrl).digest("hex").slice(0, 16);
  return { serverName: `vosio-${id}`, webOrigin: origin, mcpUrl };
}

// Read bounded public metadata without cookies, tokens, redirects or configuration writes.
export async function discoverInstallation(webOrigin, fetcher = globalThis.fetch) {
  const origin = validateWebOrigin(webOrigin);
  const response = await fetcher(`${origin}/.well-known/oauth-authorization-server`, { redirect: "error", credentials: "omit", signal: globalThis.AbortSignal.timeout(15000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("MCP není na tomto Vosiu dostupné. Správce musí nejprve nasadit a zapnout Vosio MCP.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Vosio nevrátilo OAuth konfiguraci.");
  let bytes = new Uint8Array();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (bytes.length + part.value.length > 16000) throw new Error("OAuth konfigurace překročila povolenou velikost.");
      const joined = new Uint8Array(bytes.length + part.value.length);
      joined.set(bytes); joined.set(part.value, bytes.length); bytes = joined;
    }
  } finally { await reader.cancel(); }
  return readInstallation(origin, JSON.parse(new TextDecoder().decode(bytes)));
}

// Print only public installation addresses; native Codex owns OAuth and credential storage.
async function main() {
  if (process.argv.length !== 3) throw new Error("Použití: node discover.mjs https://vase-vosio.example");
  console.log(JSON.stringify(await discoverInstallation(process.argv[2]), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Připojení se nepodařilo ověřit. Zkontrolujte HTTPS adresu svého Vosia a dostupnost jeho MCP. Žádné připojení nebylo změněno."); process.exitCode = 1; });
}
