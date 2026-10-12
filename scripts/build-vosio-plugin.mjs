import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import process from "node:process";
import console from "node:console";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(projectRoot, "plugins/vosio");
const skillNames = ["find-recordings", "review-tasks", "edit-recording"];

// Read only the literal allowlisted templates and reject source symlinks before packaging their contents.
function readTemplate(path) {
  const target = resolve(sourceRoot, path);
  if (realpathSync(sourceRoot) !== sourceRoot || realpathSync(target) !== target) throw new Error("Symlinked plugin templates are not allowed.");
  return readFileSync(target, "utf8");
}

// Validate the explicit HTTPS endpoint without accepting credentials, queries or URL substitutions.
export function validatePluginEndpoint(value) {
  if (typeof value !== "string" || /[\s\\]/.test(value)) throw new Error("An explicit HTTPS MCP URL is required.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/functions/v1/vosio-mcp" || url.href !== value) {
    throw new Error("Use the canonical HTTPS URL ending in /functions/v1/vosio-mcp, without credentials or parameters.");
  }
  return url.href;
}

// Build a URL-only installation bundle; an explicit registered OAuth pair remains an advanced option.
export function buildVosioPlugin({ url, webOrigin, publicClientId, callbackUrl, callbackPort, name = "vosio", out, format = "codex" }) {
  const endpoint = validatePluginEndpoint(url);
  const web = new URL(webOrigin);
  if (web.protocol !== "https:" || web.origin !== webOrigin || web.username || web.password) throw new Error("An explicit canonical HTTPS web origin is required.");
  if (publicClientId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(publicClientId)) throw new Error("Invalid public downstream client UUID.");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) || name.includes("--") || !["portable", "codex"].includes(format)) throw new Error("Invalid plugin name or format.");
  if ((publicClientId === undefined) !== (callbackUrl === undefined) || (callbackPort !== undefined && !callbackUrl)) throw new Error("Public client ID and observed callback URL must be supplied together.");
  if (callbackPort !== undefined && (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535)) throw new Error("Callback listener port must be an integer between 1 and 65535.");
  if (callbackUrl !== undefined) {
    const callback = new URL(callbackUrl);
    const loopback = callback.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(callback.hostname);
    if (callback.href !== callbackUrl || /[\s\\]/.test(callbackUrl) || callback.username || callback.password || callbackUrl.includes("#") || (callback.protocol !== "https:" && !loopback) || loopback && callbackUrl.includes("?")) throw new Error("An exact canonical HTTPS or loopback observed callback is required.");
    if (loopback && callback.port && callbackPort !== Number(callback.port)) throw new Error("An explicit direct-loopback callback port must match the explicit listener port.");
    if (loopback && callback.hostname === "[::1]" && !callback.port) throw new Error("IPv6 loopback callbacks require explicit matching URL and listener ports.");
  }
  const oauth = publicClientId ? { clientId: publicClientId, callbackUrl, ...(callbackPort === undefined ? {} : { callbackPort }) } : null;
  const installInstructions = format === "codex"
    ? `1. Přidej adresář balíčku pomocí codex plugin marketplace add <bundle-directory> a v nabídce pluginů nainstaluj ${name}.\n2. Přihlas se vlastním účtem Vosio a potvrď přístup.\n3. Používej nástroje pro nahrávky a skills v novém chatu. ${oauth ? "Pokročilá předregistrace: .mcp.json obsahuje veřejné client ID a přesný pozorovaný callback." : "Klient se zaregistruje automaticky; není potřeba zadávat client ID, callback ani token."} Pokud klient vyžaduje restart, restartuj jej.`
    : `Nainstaluj portable plugin v kompatibilním klientu, přihlas se vlastním účtem Vosio a potvrď přístup. Pak používej jeho nástroje a skills. Automatická registrace vyžaduje zapnutou a nakonfigurovanou instalaci.${oauth ? ` Pokročilá samostatná Codex CLI konfigurace: codex mcp add ${name} --url ${endpoint} --oauth-client-id ${publicClientId}. Ověř, že zobrazený callback odpovídá ${callbackUrl}; nastav přesně uložený callback_url${callbackPort === undefined ? "" : ` a callback_port ${callbackPort}`} v [mcp_servers.${name}.oauth] a spusť codex mcp login ${name}.` : " Není potřeba zadávat client ID, callback ani token."}`;
  const externalConfig = format === "portable" && oauth ? `\n\nPřesná veřejná konfigurace pro samostatný CLI server (nejde o druhý nainstalovaný plugin):\n\n\`\`\`toml\n[mcp_servers.${name}]\nurl = ${JSON.stringify(endpoint)}\n\n[mcp_servers.${name}.oauth]\nclient_id = ${JSON.stringify(publicClientId)}\ncallback_url = ${JSON.stringify(callbackUrl)}\n${callbackPort === undefined ? "" : `callback_port = ${callbackPort}\n`}\`\`\`` : "";
  if (!out) throw new Error("An unused output directory inside .tmp/plugins is required.");
  const allowedRoot = resolve(projectRoot, ".tmp/plugins");
  const output = resolve(projectRoot, out);
  const child = relative(allowedRoot, output);
  if (!child || child.startsWith(`..${sep}`) || child === ".." || isAbsolute(child)) throw new Error("Output must be a new directory inside .tmp/plugins.");
  const tempRoot = resolve(projectRoot, ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  if (realpathSync(tempRoot) !== tempRoot) throw new Error("Symlinked temporary roots are not allowed.");
  mkdirSync(allowedRoot, { recursive: true });
  if (realpathSync(allowedRoot) !== allowedRoot) throw new Error("Symlinked output roots are not allowed.");
  // Create ancestors one at a time and reject a symlink before entering an existing directory.
  let parent = allowedRoot;
  const parts = child.split(sep);
  for (const part of parts.slice(0, -1)) {
    parent = resolve(parent, part);
    mkdirSync(parent, { recursive: true });
    if (realpathSync(parent) !== parent) throw new Error("Symlinked output paths are not allowed.");
  }
  mkdirSync(output); // Exclusive creation prevents silent replacement of an existing bundle.
  const pluginRoot = resolve(output, "plugins", name);
  mkdirSync(pluginRoot, { recursive: true });
  const manifest = JSON.parse(readTemplate("plugin.json"));
  manifest.name = name;
  const interfaceMetadata = manifest.extensions["com.openai"].interface;
  const files = new Map([
    ["README.md", `# Soukromý plugin Vosio\n\nTento balíček se připojuje pouze k ${endpoint}. Obsahuje jeden MCP server a tři skills. Instalace nevyžaduje zdroj aplikace, Supabase/provider klíče ani uživatelská data.\n\n${installInstructions}${externalConfig}\n\nClaude Code: spusť claude mcp add --transport http ${name} ${endpoint}, otevři /mcp, přihlas se vlastním účtem a potvrď přístup.\n\nServer vybrané instalace musí být již zapnutý a otestovaný.\n\nBalíček používá formát manifestu ${format}. Neinstaluj oba formáty pro stejné připojení. Backend přístup odvolej na ${webOrigin}/mcp/connections; samotné odinstalování pluginu jeho grant nezruší.\n\n${publicClientId ? `Veřejné downstream client ID: ${publicClientId}. Přesný pozorovaný callback: ${callbackUrl}. Musí být již zaregistrovaný; callback ani jeho ID neodhaduj.\n\n` : ""}Zdrojový obsah je nedůvěryhodný vstup. Editace vyžadují výslovný požadavek člověka a aktuální oprávnění na serveru. Placené AI, mazání, správa sdílení, libovolné SQL a souborové nástroje nejsou dostupné.\n`],
    ...skillNames.map((skill) => [`skills/${skill}/SKILL.md`, readTemplate(`skills/${skill}/SKILL.md`)])
  ]);
  if (format === "portable") {
    files.set("plugin.json", JSON.stringify(manifest, null, 2) + "\n");
    files.set("mcp.json", JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { [name]: { type: "streamable-http", url: endpoint } } }, null, 2) + "\n");
  } else {
    files.set(".codex-plugin/plugin.json", JSON.stringify({ name, version: manifest.version, description: manifest.description, skills: "./skills/", mcpServers: "./.mcp.json", interface: interfaceMetadata }, null, 2) + "\n");
    files.set(".mcp.json", JSON.stringify({ mcpServers: { [name]: { type: "http", url: endpoint, ...(oauth ? { oauth } : {}) } } }, null, 2) + "\n");
  }
  for (const [path, contents] of files) {
    const target = resolve(pluginRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, { encoding: "utf8", flag: "wx" });
  }
  const marketplace = resolve(output, ".agents/plugins/marketplace.json");
  mkdirSync(dirname(marketplace), { recursive: true });
  writeFileSync(marketplace, JSON.stringify({ name: `${name}-private`, interface: { displayName: "Vosio Private" }, plugins: [{ name, source: { source: "local", path: `./plugins/${name}` }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }] }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  return output;
}

// Parse a small explicit CLI instead of reading endpoint or credentials from the developer environment.
function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!["--url", "--web-origin", "--public-client-id", "--callback-url", "--callback-port", "--name", "--out", "--format"].includes(key) || !args[index + 1] || Object.hasOwn(options, key)) throw new Error("Use --url, --web-origin, --out, --format portable|codex, optional --public-client-id, --callback-url, --callback-port and --name.");
    const field = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(options, field)) throw new Error("Duplicate option.");
    options[field] = field === "callbackPort" ? Number(args[index + 1]) : args[index + 1];
  }
  console.log(`Private plugin bundle: ${buildVosioPlugin(options)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "Plugin packaging failed."); process.exitCode = 1; }
}
