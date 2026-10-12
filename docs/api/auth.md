# Auth

## Current Model

Vosio uses Supabase Auth with email/password login for internal users.

The application does not expose public registration. Existing accounts can be
created manually in the Supabase dashboard. The source-only recording invitation
flow also allows an authorized project founder or standalone recording owner to
invite a new account through server-side `inviteUserByEmail`. The login form still
calls `signInWithPassword` only for existing users. An authenticated user can change
their password from Settings.

Invitation onboarding is not live-verified or rollout-ready: it requires the
reviewed sharing migration, configured Auth email templates and isolated Auth/email
evidence described in [recording-invitations.md](recording-invitations.md). No live
signup setting or email template was changed by this source implementation.

## Runtime Flow

```text
Visitor opens protected route
-> Next.js proxy refreshes Supabase cookies
-> unauthenticated visitor is redirected to /login
-> user signs in with email/password
-> Supabase stores cookie-backed session
-> user lands on the Vosio workspace
```

Password changes use a separate Settings form. The server action resolves the current user and email from the request-scoped session, validates the submitted passwords, reauthenticates with `signInWithPassword`, and only then calls `updateUser` with the new password on the same Supabase client. Password fields are cleared after every settled attempt and submitted values are never returned in action state.

Settings redirects to login only when the session is missing. An authenticated account without a usable email gets a stable fail-closed Settings error with no password form, avoiding a redirect loop through the login page. Development Settings fixtures render the account form disabled and without an action.

## Invitation OTP and password setup

New accounts receive a server-issued Supabase invite; existing-account delivery uses
an isolated stateless `signInWithOtp` client with `shouldCreateUser:false`. The public
acceptance shell receives the application token in an email URL fragment, removes it
from the address bar and keeps it only in memory. Email templates must include
`{{ .Token }}` and a link to `{{ .RedirectTo }}`; the default `ConfirmationURL` flow
is not this application's OTP contract. No browser/public `signUp` path is introduced.

`verifyInvitationIdentityAction` accepts only `invite` or `email` OTP types. It first
verifies the fresh email OTP, resolves the current verified Auth identity and asks
the narrow invitation preview RPC to validate that identity as the recipient.
Only then may it call `updateUser` to set the submitted matching password. Password
setup is required for a new invite and optional after existing-account OTP, allowing
recovery if a prior invitation's password setup failed. Submitted passwords, OTPs and
application tokens are never returned in action state or logged.

This invitation setup proves identity with a fresh OTP; it does not use or weaken
the Settings change flow. Settings still requires and reauthenticates the current
password. Neither OTP verification, password setup, callback exchange nor page GET
grants project/recording access: the recipient must explicitly POST accept, which
performs current authority, scope, email and token checks atomically in the DB.

Auth callbacks accept code exchange or supported `invite/email/magiclink/recovery`
token-hash verification, reject unsupported/ambiguous requests and fail safely on
exchange errors. All redirect paths, including failures and exceptions, set
`Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Destinations use an
allowlist of application paths.

## Files

- `src/lib/supabase/server.ts`: request-scoped server Supabase client.
- `src/lib/supabase/browser.ts`: browser Supabase client with publishable key only.
- `src/lib/supabase/proxy.ts`: session refresh and route protection.
- `proxy.ts`: Next.js proxy entrypoint.
- `src/lib/auth/actions.ts`: sign in/out and invitation OTP/password setup server actions.
- `src/lib/recording-sharing/invitations.server.ts`: manager-authorized invitation orchestration and server-only Auth delivery.
- `app/invitations/accept/page.tsx`: public invitation shell with verified-only preview and explicit acceptance.
- `src/lib/auth/password-actions.ts`: reauthenticated password-change server action.
- `src/components/account-security-panel.tsx`: separate account and password form in Settings.
- `app/login/page.tsx`: internal login page.
- `app/auth/callback/route.ts`: privacy-protected callback code exchange and validated OTP types.

## Security Rules

- `SUPABASE_SERVICE_ROLE_KEY` is not used by the login flow.
- Browser code uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Production auth diagnostics are not exposed as public API routes.
- Login errors stay generic and do not reveal whether an email exists.
- Post-login redirects are limited to same-app paths.
- Registration stays disabled in the app UI.
- Password-change errors use fixed Czech copy and never expose provider details or submitted passwords.
- Settings reauthenticates the current password before writing a new one. Invitation
  password setup instead requires a freshly verified email OTP and a valid
  intended-recipient invitation preview.

## Same-origin callback redirect

`app/auth/callback/route.ts` accepts the optional `next` query parameter only as an internal path. The value must begin with exactly one `/`, must not contain a backslash or C0/DEL control character, and must not contain an encoded separator or control character that becomes unsafe after decoding. Absolute URLs, protocol-relative paths, malformed percent escapes, ambiguous double-encoded separators and values such as `/\\evil.example` fall back to `/`.

The callback resolves the accepted path against the trusted `requestUrl.origin` and performs a defense-in-depth check that `target.origin === requestUrl.origin` before redirecting. Ordinary paths, query strings and fragments remain supported, for example `/recordings/123?tab=ai`. A malformed or ambiguous value can therefore never turn `new URL()` into an external redirect.

## 2FA

Two-factor authentication is planned as a later auth hardening step. It should be added through Supabase Auth MFA/TOTP on top of this session model, not as a custom password layer.
