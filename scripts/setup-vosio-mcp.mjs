import { randomBytes, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync, realpathSync, existsSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";
import process from "node:process";
import console from "node:console";

const secretNames = ["MCP_TOKEN_ENCRYPTION_KEY", "MCP_SUPABASE_CLIENT_SECRET"];

// Verify an independently inspected self-hosted secret binding against exact identity and operator-supplied values.
function verifiedSelfHostedBinding(options, identity, upstreamClientId) {
  const binding = options.selfHosted?.secretBinding;
  if (!binding || binding.verified !== true || typeof binding.verificationId !== "string" || !binding.verificationId.trim() || binding.webOrigin !== identity.webOrigin || binding.publicSupabaseUrl !== identity.publicSupabaseUrl || binding.upstreamClientId !== upstreamClientId) return false;
  const key = options.secrets?.MCP_TOKEN_ENCRYPTION_KEY;
  if (typeof key !== "string" || Buffer.from(key, "base64").length !== 32 || Buffer.from(key, "base64").toString("base64") !== key) return false;
  return secretNames.every((name) => typeof options.secrets?.[name] === "string" && options.secrets[name].length > 0 && /^[0-9a-f]{64}$/.test(binding.secretDigests?.[name] ?? "") && createHash("sha256").update(options.secrets[name], "utf8").digest("hex") === binding.secretDigests[name]);
}

// Resolve only the hosted default privileged key, or the unique legacy service-role key; never guess another key.
export async function hostedServiceKey(projectRef, managementToken, fetcher = globalThis.fetch) {
  if (!/^[a-z]{20}$/.test(projectRef ?? "") || !managementToken) throw new Error("Hosted setup requires a project reference and operator Management API credential.");
  let response;
  try { response = await fetcher(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, { redirect: "error", signal: globalThis.AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${managementToken}` } }); } catch { throw new Error("Hosted service-key lookup failed."); }
  if (!response.ok) throw new Error("Hosted service-key lookup denied.");
  let keys;
  try { keys = await response.json(); } catch { throw new Error("Hosted service-key response unreadable."); }
  if (!Array.isArray(keys)) throw new Error("Hosted service-key response invalid.");
  const secrets = keys.filter((key) => key.type === "secret");
  const selected = secrets.length ? secrets.filter((key) => key.name === "default") : keys.filter((key) => key.name === "service_role" && (!key.type || key.type === "legacy"));
  if (selected.length !== 1 || typeof selected[0].api_key !== "string" || !selected[0].api_key) throw new Error("Hosted default service key is missing or ambiguous.");
  return selected[0].api_key;
}

// Accept canonical origins only; endpoint paths and caller-controlled credentials are never targets.
export function setupOrigin(value, internal = false) {
  if (typeof value !== "string" || /[\s\\]/.test(value)) throw new Error("A canonical URL origin is required.");
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || (url.protocol !== "https:" && !(internal && url.protocol === "http:"))) throw new Error("A canonical HTTPS origin is required (explicit internal HTTP service URL allowed).");
  return url.origin;
}

// Make bounded API calls without retries, redirects, or leaking response bodies containing credentials.
export function createSetupClient({ projectRef, publicSupabaseUrl, serviceUrl = publicSupabaseUrl, serviceKey, managementToken, selfHosted }, fetcher = globalThis.fetch) {
  setupOrigin(publicSupabaseUrl); setupOrigin(serviceUrl, Boolean(selfHosted));
  if (!selfHosted && serviceUrl !== publicSupabaseUrl) throw new Error("Hosted service URL must equal its verified public Supabase URL.");
  if (!serviceKey) throw new Error("Operator service access is required.");
  if (managementToken && !/^[a-z0-9]{20}$/.test(projectRef ?? "")) throw new Error("A hosted project reference is required.");
  const management = `https://api.supabase.com/v1/projects/${projectRef}`;
  // Discard remote errors instead of reporting OAuth secrets or management credentials.
  async function request(url, method = "GET", payload, managementAccess = false) {
    let response;
    try {
      response = await fetcher(url, { method, redirect: "error", signal: globalThis.AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${managementAccess ? managementToken : serviceKey}`, ...(managementAccess ? {} : { apikey: serviceKey }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    } catch { throw new Error(`Setup ${method} transport failed; mutation outcome may be unknown. Inspect receipt before any retry.`); }
    if (!response.ok) throw new Error(`Setup ${method} returned HTTP ${response.status}; no automatic retry.`);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new Error("Setup response unreadable; mutation outcome may be unknown."); }
  }
  return {
    installation: (action, payload = {}) => request(`${serviceUrl}/rest/v1/rpc/mcp_installation_v1`, "POST", { p_action: action, p_payload: payload }),
    register: (payload) => request(`${serviceUrl}/rest/v1/rpc/mcp_oauth_custody_v1`, "POST", { p_action: "register", p_payload: payload }),
    downstreamClient: (id) => request(`${serviceUrl}/rest/v1/rpc/mcp_oauth_custody_v1`, "POST", { p_action: "client", p_payload: { clientId: id } }),
    getClient: (id) => request(`${serviceUrl}/auth/v1/admin/oauth/clients/${encodeURIComponent(id)}`),
    createClient: (payload) => request(`${serviceUrl}/auth/v1/admin/oauth/clients`, "POST", payload),
    // Self-hosted Auth and sessions/gateway compatibility must be operator-attested, not guessed from a version string.
    preflight: async () => {
      if (selfHosted) {
        await request(`${serviceUrl}/auth/v1/health`);
        if (selfHosted.siteUrl !== undefined) setupOrigin(selfHosted.siteUrl);
        return selfHosted;
      }
      if (!managementToken) throw new Error("Hosted read-only preflight requires operator Management API access.");
      const [auth, secrets] = await Promise.all([request(`${management}/config/auth`, "GET", undefined, true), request(`${management}/secrets`, "GET", undefined, true)]);
      return { siteUrl: auth.site_url, oauthEnabled: auth.oauth_server_enabled, authorizationPath: auth.oauth_server_authorization_path, dcrEnabled: auth.oauth_server_allow_dynamic_registration, secretNames: secrets.map((entry) => entry.name), compatible: true };
    },
    putSecrets: (values) => {
      if (selfHosted) throw new Error("Self-hosted secrets must be installed and verified by the runtime operator before setup.");
      return request(`${management}/secrets`, "POST", secretNames.map((name) => ({ name, value: values[name] })), true);
    }
  };
}

// Persist no secrets; journal a pending mutation before the request so interrupted runs cannot repeat it silently.
export function receiptStore(path) {
  const target = resolve(path);
  if (realpathSync(dirname(target)) !== dirname(target)) throw new Error("Receipt parent must not be symlinked.");
  if (existsSync(target) && realpathSync(target) !== target) throw new Error("Receipt must not be symlinked.");
  let lock;
  return {
    acquire: () => { try { lock = openSync(`${target}.lock`, "wx", 0o600); } catch { throw new Error("Receipt is locked by another or interrupted setup. Operator reconciliation required."); } },
    release: () => { if (lock !== undefined) { closeSync(lock); lock = undefined; unlinkSync(`${target}.lock`); } },
    load: () => existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : null,
    save: (receipt) => writeFileSync(target, JSON.stringify(receipt, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: existsSync(target) ? "w" : "wx" })
  };
}

// Prepare disabled installations; activation is a separate command with fresh compatibility and identity checks.
export async function setupVosioMcp(options, client, journal) {
  if ((options.mode ?? "dry-run") !== "dry-run") journal?.acquire?.();
  try { return await runSetup(options, client, journal); } finally { journal?.release?.(); }
}

// Run the setup flow under the private receipt lock held by the public entry point.
async function runSetup(options, client, journal) {
  const mode = options.mode ?? "dry-run";
  if (!["dry-run", "apply", "enable", "disable"].includes(mode)) throw new Error("Invalid setup mode.");
  const webOrigin = setupOrigin(options.webOrigin);
  const publicSupabaseUrl = setupOrigin(options.publicSupabaseUrl);
  if (options.projectRef && publicSupabaseUrl !== `https://${options.projectRef}.supabase.co` && !options.selfHosted) throw new Error("Hosted project reference and public URL differ; custom domains require separate operator verification.");
  const identity = { webOrigin, publicSupabaseUrl };
  const savedReceipt = journal?.load();
  const receipt = savedReceipt ?? { version: 1, ...identity, upstreamClientId: options.upstreamClientId ?? null, pending: null, completed: [] };
  if (receipt.version !== 1 || receipt.webOrigin !== webOrigin || receipt.publicSupabaseUrl !== publicSupabaseUrl || !Array.isArray(receipt.completed)) throw new Error("Receipt belongs to another installation or has an unsupported format.");
  if (receipt.pending) throw new Error(`Uncertain ${receipt.pending} outcome: operator must reconcile exact receipt and remote state before continuing.`);
  const [preflight, current] = await Promise.all([mode === "disable" ? Promise.resolve({ secretNames: [] }) : client.preflight(), client.installation("read")]);
  if (mode !== "disable" && (preflight.siteUrl !== webOrigin || preflight.oauthEnabled !== true || preflight.authorizationPath !== "/mcp/upstream-consent" || preflight.dcrEnabled !== false || preflight.compatible !== true || !Array.isArray(preflight.secretNames))) throw new Error("OAuth target or runtime compatibility is unverified. Setup does not change Auth settings.");
  if (mode !== "disable" && preflight.secretNames.some((name) => name.startsWith("MCP_") && !secretNames.includes(name))) throw new Error("Unexpected MCP secrets require operator review.");
  if (current && (current.webOrigin !== webOrigin || current.publicSupabaseUrl !== publicSupabaseUrl || typeof current.enabled !== "boolean")) throw new Error("Existing installation identity differs.");
  const upstreamClientId = current?.upstreamClientId ?? receipt.upstreamClientId ?? options.upstreamClientId;
  if (options.upstreamClientId && upstreamClientId !== options.upstreamClientId) throw new Error("Upstream client differs from the exact installation receipt.");
  if (receipt.upstreamClientId && upstreamClientId !== receipt.upstreamClientId) throw new Error("Receipt upstream client differs from installation.");
  const callback = `${webOrigin}/api/mcp/oauth/callback`;
  if (upstreamClientId && mode !== "disable") {
    const upstream = await client.getClient(upstreamClientId);
    if (upstream.client_id !== upstreamClientId || upstream.client_type !== "confidential" || upstream.token_endpoint_auth_method !== "client_secret_basic" || !Array.isArray(upstream.redirect_uris) || upstream.redirect_uris.length !== 1 || upstream.redirect_uris[0] !== callback || !upstream.grant_types?.includes("authorization_code") || !upstream.grant_types?.includes("refresh_token")) throw new Error("Upstream client is not the exact compatible installation client.");
  } else if (!upstreamClientId && mode !== "disable" && preflight.secretNames.some((name) => secretNames.includes(name))) throw new Error("Unclaimed existing secrets require an exact upstream client receipt.");
  const downstream = options.downstream;
  if (downstream) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(downstream.clientId) || downstream.clientId === upstreamClientId || typeof downstream.name !== "string" || !downstream.name.trim() || downstream.name.length > 100 || !Array.isArray(downstream.redirects) || downstream.redirects.length < 1 || downstream.redirects.length > 10 || new Set(downstream.redirects).size !== downstream.redirects.length) throw new Error("Explicit downstream client UUID, name and observed redirects are required.");
    for (const value of downstream.redirects) {
      const redirect = new URL(value);
      const loopback = redirect.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(redirect.hostname);
      if (redirect.href !== value || redirect.username || redirect.password || value.includes("#") || /[\s\\]/.test(value) || (redirect.protocol !== "https:" && !loopback) || loopback && value.includes("?")) throw new Error("Only canonical HTTPS or exact loopback observed callbacks are allowed.");
    }
  }
  // Compare the exact custody registration before any writes; a matching client is reusable, a conflict is immutable.
  const matchesDownstream = (value) => value?.id === downstream.clientId && value.name === downstream.name && Array.isArray(value.redirects) && value.redirects.length === downstream.redirects.length && value.redirects.every((redirect, index) => redirect === downstream.redirects[index]);
  const registered = downstream ? await client.downstreamClient(downstream.clientId) : null;
  if (registered && !matchesDownstream(registered)) throw new Error("Existing downstream registration conflicts with requested exact name or redirects.");
  const report = { mode, ...identity, resourceUrl: `${publicSupabaseUrl}/functions/v1/vosio-mcp`, upstreamClientId: upstreamClientId ?? null, enabled: current?.enabled ?? false, secretsPresent: secretNames.every((name) => preflight.secretNames?.includes(name)), downstreamClientId: downstream?.clientId ?? null };
  if (mode === "dry-run") return report;
  if (!journal) throw new Error("Apply/activation requires a durable private receipt.");
  if (mode === "apply" && report.secretsPresent && !current && !(savedReceipt?.upstreamClientId === upstreamClientId && savedReceipt.completed?.includes("put-secrets")) && !verifiedSelfHostedBinding(options, identity, upstreamClientId)) throw new Error("Existing secrets have no proven installation attribution. Reconcile exact prior receipt or independently verified self-hosted binding and secret digests before reuse.");
  // Every mutation gets an explicit nonsecret uncertainty fence, and no mutation is automatically repeated.
  async function mutate(action, operation, verify) {
    receipt.pending = action; journal.save(receipt);
    let result;
    try { result = await operation(); if (verify) await verify(result); } catch { throw new Error(`Uncertain ${action} outcome. Reconcile receipt and remote state; no retry, rotation or duplicate create is permitted.`); }
    receipt.pending = null; receipt.completed.push(action); journal.save(receipt); return result;
  }
  if (mode === "enable" || mode === "disable") {
    if (!current || !upstreamClientId || (mode === "enable" && !report.secretsPresent)) throw new Error("A configured installation with both verified secrets is required for activation.");
    const enabled = mode === "enable";
    if (current.enabled !== enabled) await mutate(mode, () => client.installation("enable", { enabled }), async () => {
      const readback = await client.installation("read");
      if (readback?.enabled !== enabled || readback?.upstreamClientId !== upstreamClientId || readback?.webOrigin !== webOrigin || readback?.publicSupabaseUrl !== publicSupabaseUrl) throw new Error("Activation read-back differs.");
    });
    return { ...report, enabled };
  }
  if (current?.enabled) throw new Error("Disable an existing installation before apply; setup cannot alter an active service.");
  let id = upstreamClientId;
  let clientSecret = options.secrets?.MCP_SUPABASE_CLIENT_SECRET;
  if (!id) {
    if (options.selfHosted) throw new Error("Self-hosted setup requires an operator-created confidential client and installed secrets.");
    // Keep create pending until its one-time secret is installed. Losing it never authorizes another create.
    receipt.pending = "create-client"; journal.save(receipt);
    let created;
    try { created = await client.createClient({ client_name: "Vosio MCP bridge", client_uri: webOrigin, client_type: "confidential", token_endpoint_auth_method: "client_secret_basic", redirect_uris: [callback], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }); } catch { throw new Error("Uncertain create-client outcome; recover exact client ID manually, never recreate or rotate."); }
    if (!created?.client_id || !created.client_secret) throw new Error("Uncertain create-client response; preserve receipt and recover exact client manually.");
    id = created.client_id; clientSecret = created.client_secret;
    receipt.upstreamClientId = id; journal.save(receipt);
  }
  if (!report.secretsPresent) {
    if (options.selfHosted) throw new Error("Self-hosted runtime secrets have not been verified installed.");
    if (preflight.secretNames.some((name) => secretNames.includes(name))) throw new Error("Partial secrets require operator reconciliation; setup never replaces an existing key.");
    if (!clientSecret) throw new Error("Existing client secret must be supplied securely; setup never reads or rotates it.");
    const encryptionKey = options.secrets?.MCP_TOKEN_ENCRYPTION_KEY ?? randomBytes(32).toString("base64");
    if (Buffer.from(encryptionKey, "base64").length !== 32 || Buffer.from(encryptionKey, "base64").toString("base64") !== encryptionKey) throw new Error("Custody key must be canonical base64 for exactly 32 bytes.");
    receipt.upstreamClientId = id;
    await mutate("put-secrets", () => client.putSecrets({ MCP_TOKEN_ENCRYPTION_KEY: encryptionKey, MCP_SUPABASE_CLIENT_SECRET: clientSecret }), async () => {
      const verified = await client.preflight();
      if (!secretNames.every((name) => verified.secretNames.includes(name))) throw new Error("Secrets upload read-back missing.");
    });
  }
  receipt.upstreamClientId = id; journal.save(receipt);
  if (!current) await mutate("configure", () => client.installation("configure", { ...identity, upstreamClientId: id, enabled: false }), async () => {
    const configured = await client.installation("read");
    if (!configured || configured.enabled !== false || configured.webOrigin !== webOrigin || configured.publicSupabaseUrl !== publicSupabaseUrl || configured.upstreamClientId !== id) throw new Error("Configuration read-back differs.");
  });
  if (downstream && !registered) await mutate("register-downstream", () => client.register(downstream), async (result) => {
    if (result?.ok !== true || !matchesDownstream(await client.downstreamClient(downstream.clientId))) throw new Error("Downstream registration not confirmed.");
  });
  return { ...report, upstreamClientId: id, secretsPresent: true, enabled: false };
}

// CLI reads credentials only from process environment; normal output contains selected nonsecret metadata only.
async function main() {
  const args = process.argv.slice(2); const options = {};
  const fields = { "--project-ref": "projectRef", "--web-origin": "webOrigin", "--supabase-url": "publicSupabaseUrl", "--service-url": "serviceUrl", "--upstream-client-id": "upstreamClientId", "--receipt": "receipt", "--downstream": "downstream", "--self-hosted-preflight": "selfHosted" };
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (["--apply", "--enable", "--disable"].includes(key)) { if (options.mode) throw new Error("Select one explicit mutation mode."); options.mode = key.slice(2); continue; }
    if (!fields[key] || !args[i + 1] || Object.hasOwn(options, fields[key])) throw new Error("Unknown, duplicate or missing setup option.");
    options[fields[key]] = args[++i];
  }
  if (options.downstream) options.downstream = JSON.parse(readFileSync(options.downstream, "utf8"));
  if (options.selfHosted) options.selfHosted = JSON.parse(readFileSync(options.selfHosted, "utf8"));
  options.secrets = Object.fromEntries(secretNames.map((name) => [name, process.env[name]]));
  const managementToken = process.env.SUPABASE_ACCESS_TOKEN;
  const serviceKey = options.selfHosted ? process.env.SUPABASE_SERVICE_ROLE_KEY : await hostedServiceKey(options.projectRef, managementToken);
  const client = createSetupClient({ ...options, serviceKey, managementToken });
  const journal = options.receipt ? receiptStore(options.receipt) : undefined;
  console.log(JSON.stringify(await setupVosioMcp(options, client, journal), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "MCP setup failed."); process.exitCode = 1; });
}
