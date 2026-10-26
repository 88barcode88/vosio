import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import process from "node:process";
import console from "node:console";
import { setupOrigin } from "./setup-vosio-mcp.mjs";

const templates = {
  mailer_subjects_invite: "Pozvánka do Vosio",
  mailer_templates_invite_content: readFileSync(new URL("../supabase/templates/invite.html", import.meta.url), "utf8").replaceAll("\r\n", "\n"),
  mailer_subjects_magic_link: "Ověření pozvánky do Vosio",
  mailer_templates_magic_link_content: readFileSync(new URL("../supabase/templates/magic_link.html", import.meta.url), "utf8").replaceAll("\r\n", "\n")
};

// configureInvitationEmail applies only the versioned invitation contract to one explicitly selected hosted project.
export async function configureInvitationEmail({ projectRef, webOrigin, managementToken, mode = "check" }, fetcher = globalThis.fetch) {
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? "") || !managementToken) throw new Error("A project reference and SUPABASE_ACCESS_TOKEN are required.");
  setupOrigin(webOrigin);
  if (!["check", "apply"].includes(mode)) throw new Error("Select check or apply mode.");
  const base = `https://api.supabase.com/v1/projects/${projectRef}`;

  // request never follows redirects, retries mutations, or exposes Auth configuration/credential response bodies.
  async function request(path, method = "GET", body) {
    let response;
    try {
      response = await fetcher(`${base}${path}`, {
        method, redirect: "error", signal: globalThis.AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${managementToken}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new Error(`Auth setup ${method} transport failed; check the target before retrying.`); }
    if (!response.ok) throw new Error(`Auth setup ${method} returned HTTP ${response.status}; no automatic retry.`);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new Error("Auth setup response unreadable; check the target before retrying."); }
  }

  const project = await request("");
  if (project?.id !== projectRef || project.status !== "ACTIVE_HEALTHY") throw new Error("The selected project is unavailable or does not match its reference.");
  const before = await request("/config/auth");
  if (!before || typeof before.uri_allow_list !== "string") throw new Error("Auth redirect configuration is unavailable.");
  const redirects = new Set(before.uri_allow_list.split(",").map((value) => value.trim()).filter(Boolean));
  redirects.add(`${webOrigin}/invitations/accept`);
  redirects.add(`${webOrigin}/invitations/accept#**`);
  const desired = { ...templates, site_url: webOrigin, uri_allow_list: [...redirects].join(",") };
  const patch = Object.fromEntries(Object.entries(desired).filter(([key, value]) => before[key] !== value));
  const changedFields = Object.keys(patch);
  if (mode === "apply" && changedFields.length) {
    await request("/config/auth", "PATCH", patch);
    const after = await request("/config/auth");
    if (!after || Object.entries(desired).some(([key, value]) => after[key] !== value)) throw new Error("Auth setup postflight did not confirm the requested configuration; inspect the target before retrying.");
    const unrelated = Object.keys(before).filter((key) => !Object.hasOwn(desired, key) && !isDeepStrictEqual(before[key], after[key]));
    if (unrelated.length) throw new Error(`Other Auth settings changed during setup (${unrelated.join(", ")}); inspect the target before continuing.`);
  }
  return { projectRef, webOrigin, mode, changedFields, configured: mode === "apply" || changedFields.length === 0 };
}

// main accepts only nonsecret target flags; credentials stay in the operator process environment.
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: npm run setup:auth -- --project-ref REF --web-origin https://vosio.example [--apply]\nRequires SUPABASE_ACCESS_TOKEN. Default: read-only check. SQL migrations do not configure hosted Auth email templates.");
    return;
  }
  const fields = { "--project-ref": "projectRef", "--web-origin": "webOrigin" };
  const options = { managementToken: process.env.SUPABASE_ACCESS_TOKEN };
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (key === "--apply" && !options.mode) { options.mode = "apply"; continue; }
    if (!fields[key] || !args[i + 1] || Object.hasOwn(options, fields[key])) throw new Error("Unknown, duplicate or missing Auth setup option.");
    options[fields[key]] = args[++i];
  }
  console.log(JSON.stringify(await configureInvitationEmail(options), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Auth email setup failed."); process.exitCode = 1; });
}
