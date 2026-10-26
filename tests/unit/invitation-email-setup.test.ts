import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { configureInvitationEmail } from "../../scripts/setup-invitation-email.mjs";

const target = { projectRef: "abcdefghijklmnopqrst", webOrigin: "https://vosio.example", managementToken: "operator-credential" };

// hostedFixture proves the setup's real request boundary while keeping operator credentials and email delivery offline.
function hostedFixture(options: { wrongProject?: boolean; patchStatus?: number; ignorePatch?: boolean; reorderedJson?: boolean; changedOAuth?: boolean } = {}) {
  const original = { site_url: "http://localhost:3000", uri_allow_list: "https://old.example/auth/callback", mailer_templates_invite_content: '<a href="{{ .ConfirmationURL }}">Accept</a>', mailer_templates_magic_link_content: '<a href="{{ .ConfirmationURL }}">Sign in</a>', mailer_subjects_invite: "Default invite", mailer_subjects_magic_link: "Default magic link", smtp_pass: "private-smtp-value", disable_signup: true, oauth_server_enabled: true, oauth_server_allow_dynamic_registration: false, mailer_templates_recovery_content: "Keep recovery", external_oauth_config: { provider: "existing", enabled: true } };
  let current: Record<string, unknown> = { ...original };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/config/auth")) {
      if (init?.method === "PATCH") {
        if (options.patchStatus) return new Response("private-response-body", { status: options.patchStatus });
        if (!options.ignorePatch) current = { ...current, ...JSON.parse(init.body as string) };
        if (options.reorderedJson) current.external_oauth_config = { enabled: true, provider: "existing" };
        if (options.changedOAuth) current.oauth_server_enabled = false;
        return Response.json({});
      }
      return Response.json(current);
    }
    return Response.json({ id: options.wrongProject ? "other-project" : target.projectRef, status: "ACTIVE_HEALTHY" });
  });
  return { original, fetcher, state: () => current };
}

describe("portable invitation email configuration", () => {
  it.each(["invite", "magic_link"])("ships the %s template with the application link and OTP instead of consuming the Auth confirmation link", (kind) => {
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).toContain(`[auth.email.template.${kind}]`);
    expect(config).toContain(`content_path = "./supabase/templates/${kind}.html"`);
    const template = readFileSync(`supabase/templates/${kind}.html`, "utf8");
    expect(template).toContain('href="{{ .RedirectTo }}"');
    expect(template).toContain("{{ .Token }}");
    expect(template).not.toContain(".ConfirmationURL");
    expect(template).not.toMatch(/https?:\/\//);
  });

  it("checks an explicitly selected hosted installation without writes or secret output", async () => {
    const fixture = hostedFixture();
    const report = await configureInvitationEmail(target, fixture.fetcher);
    expect(report.mode).toBe("check");
    expect(report.configured).toBe(false);
    expect(report.changedFields).toHaveLength(6);
    expect(fixture.fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/operator-credential|private-smtp-value|private-response-body/);
  });

  it("applies the same portable templates, preserves other Auth settings and becomes a no-op on rerun", async () => {
    const fixture = hostedFixture();
    const result = await configureInvitationEmail({ ...target, mode: "apply" }, fixture.fetcher);
    expect(result.configured).toBe(true);
    const mutations = fixture.fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH");
    expect(mutations).toHaveLength(1);
    const payload = JSON.parse(mutations[0]![1]!.body as string);
    expect(Object.keys(payload).sort()).toEqual(["mailer_subjects_invite", "mailer_templates_invite_content", "mailer_subjects_magic_link", "mailer_templates_magic_link_content", "site_url", "uri_allow_list"].sort());
    for (const kind of ["invite", "magic_link"]) expect(payload[`mailer_templates_${kind}_content`]).toBe(readFileSync(`supabase/templates/${kind}.html`, "utf8").replaceAll("\r\n", "\n"));
    expect(payload.uri_allow_list.split(",")).toEqual([fixture.original.uri_allow_list, `${target.webOrigin}/invitations/accept`, `${target.webOrigin}/invitations/accept#**`]);
    for (const key of ["smtp_pass", "disable_signup", "oauth_server_enabled", "oauth_server_allow_dynamic_registration", "mailer_templates_recovery_content"] as const) expect(fixture.state()[key]).toBe(fixture.original[key]);
    const again = await configureInvitationEmail({ ...target, mode: "apply" }, fixture.fetcher);
    expect(again.changedFields).toEqual([]);
    expect(fixture.fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
    expect(fixture.fetcher.mock.calls.every(([, options]) => options?.redirect === "error" && options.signal instanceof AbortSignal)).toBe(true);
  });

  it("refuses a mismatched project before loading or changing its Auth settings", async () => {
    const fixture = hostedFixture({ wrongProject: true });
    await expect(configureInvitationEmail({ ...target, mode: "apply" }, fixture.fetcher)).rejects.toThrow(/does not match/);
    expect(fixture.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["http://vosio.example", "https://vosio.example/path", "https://user:password@vosio.example", "https://vosio.example?next=evil"])("refuses an unsafe application origin %s before sending credentials", async (webOrigin) => {
    const fixture = hostedFixture();
    await expect(configureInvitationEmail({ ...target, webOrigin }, fixture.fetcher)).rejects.toThrow();
    expect(fixture.fetcher).not.toHaveBeenCalled();
  });

  it("refuses an unbound project or missing operator credential before network access", async () => {
    const fixture = hostedFixture();
    await expect(configureInvitationEmail({ ...target, projectRef: "../other" }, fixture.fetcher)).rejects.toThrow(/reference/);
    await expect(configureInvitationEmail({ ...target, managementToken: "" }, fixture.fetcher)).rejects.toThrow(/SUPABASE_ACCESS_TOKEN/);
    expect(fixture.fetcher).not.toHaveBeenCalled();
  });

  it("does not retry or expose error bodies after a failed configuration write", async () => {
    const fixture = hostedFixture({ patchStatus: 500 });
    await expect(configureInvitationEmail({ ...target, mode: "apply" }, fixture.fetcher)).rejects.toThrow("Auth setup PATCH returned HTTP 500; no automatic retry.");
    expect(fixture.fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
  });

  it("does not claim success when the target ignores the requested patch", async () => {
    const fixture = hostedFixture({ ignorePatch: true });
    await expect(configureInvitationEmail({ ...target, mode: "apply" }, fixture.fetcher)).rejects.toThrow(/postflight/);
  });

  it("compares unrelated JSON settings semantically rather than by serialization order", async () => {
    const fixture = hostedFixture({ reorderedJson: true });
    await expect(configureInvitationEmail({ ...target, mode: "apply" }, fixture.fetcher)).resolves.toMatchObject({ configured: true });
  });

  it("reports an actual unrelated OAuth change without exposing its value", async () => {
    const fixture = hostedFixture({ changedOAuth: true });
    await expect(configureInvitationEmail({ ...target, mode: "apply" }, fixture.fetcher)).rejects.toThrow("Other Auth settings changed during setup (oauth_server_enabled)");
  });
});
