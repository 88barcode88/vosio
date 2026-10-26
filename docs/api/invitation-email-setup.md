# Invitation email setup

Vosio invitations use a direct application link and an email OTP. The link must
preserve `/invitations/accept#token=...&type=invite|email`. Opening it does not
accept the invitation. The recipient verifies the email code and explicitly
accepts; new users also set their initial password.

The versioned sources are `supabase/templates/invite.html` and
`supabase/templates/magic_link.html`. Both use `{{ .RedirectTo }}` and
`{{ .Token }}`, never `{{ .ConfirmationURL }}`. Supabase's default confirmation
callback does not preserve this application token contract. Do not repair this
by accepting an Auth access token as an invitation token.

## Hosted Supabase: installation and upgrade

After applying the required database migrations, run the bundled Auth setup.
SQL migrations and `supabase db push` do not configure hosted Auth templates.
The operator supplies their own `SUPABASE_ACCESS_TOKEN` through the process
environment; it is a Supabase Management API credential, not an application
service-role key. Never commit or pass it in a command argument. A scoped token
needs project metadata read and Auth configuration read/write permissions.

```powershell
# Check only: no writes.
npm.cmd run setup:auth -- --project-ref YOUR_PROJECT_REF --web-origin https://vosio.example

# Apply the bundled templates to this explicitly selected installation.
npm.cmd run setup:auth -- --project-ref YOUR_PROJECT_REF --web-origin https://vosio.example --apply

# Independently verify the saved state; configured must be true, changedFields empty.
npm.cmd run setup:auth -- --project-ref YOUR_PROJECT_REF --web-origin https://vosio.example
```

The command verifies the selected healthy project, uses the chosen canonical
HTTPS origin as Site URL, preserves existing allowed redirects and adds only
the invitation path and its fragment pattern. It patches the two subjects,
two HTML templates and any needed Site URL/redirect changes. It reads back the
saved settings, checks for unrelated Auth changes and reports metadata only.
It is idempotent, follows no HTTP redirects and never retries a write. After an
uncertain transport result, run the read-only check before deciding to retry.

The command does not alter SMTP credentials, public signup, OAuth/MCP clients,
keys, users, grants, database schema or migration history, and sends no email.
Configure your own working SMTP service as part of the installation. Do not
run a broad `supabase config push` against an existing installation merely to
fix these templates; its other settings may differ from local development.

## Local CLI and Docker self-hosting

`supabase/config.toml` references the same HTML files for both template types;
the local CLI loads them with its normal Auth configuration. Its invitation
redirects use the local application origin `http://127.0.0.1:3047`.

For a standalone Supabase Docker deployment, mount/serve the bundled
`supabase/templates/` directory using Supabase's custom-template mechanism and
bind `GOTRUE_MAILER_TEMPLATES_INVITE` / `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK` to
those template URLs. Set the matching subjects with
`GOTRUE_MAILER_SUBJECTS_INVITE` / `GOTRUE_MAILER_SUBJECTS_MAGIC_LINK`, and the
installation's own `GOTRUE_SITE_URL` / `GOTRUE_URI_ALLOW_LIST`. The hosted
Management API command does not configure a standalone Docker Auth service.
No template editing or author deployment identifier is required.

## Verification and existing emails

`tests/unit/invitation-email-setup.test.ts` checks the portable contract, bounded
operator requests, target/origin rejection, preservation of other settings,
postflight and idempotence. The invitation browser fixtures verify that opening
the link removes its fragment, shows email-code onboarding or preview, and
does not accept automatically. These checks do not prove real SMTP delivery.

After changing templates, use Team's existing bounded resend action for an
outstanding invitation. Already delivered emails keep their old content and
link. Test a newly delivered email with the actual recipient; do not publish
its link/code or reuse live identities in automated fixtures. Email scanners
must not consume an invitation simply by visiting the direct application link.

Official references: [email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[local template configuration](https://supabase.com/docs/guides/local-development/customizing-email-templates),
[self-hosted templates](https://supabase.com/docs/guides/self-hosting/custom-email-templates).
