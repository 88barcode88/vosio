# Auth

## Current Model

Vosio uses Supabase Auth with email/password login for internal users.

The application does not expose registration. Users are created manually in the Supabase dashboard under Auth users. The app login form only calls `signInWithPassword` for existing users. An authenticated user can change their own password from Settings.

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

## Files

- `src/lib/supabase/server.ts`: request-scoped server Supabase client.
- `src/lib/supabase/browser.ts`: browser Supabase client with publishable key only.
- `src/lib/supabase/proxy.ts`: session refresh and route protection.
- `proxy.ts`: Next.js proxy entrypoint.
- `src/lib/auth/actions.ts`: sign in and sign out server actions.
- `src/lib/auth/password-actions.ts`: reauthenticated password-change server action.
- `src/components/account-security-panel.tsx`: separate account and password form in Settings.
- `app/login/page.tsx`: internal login page.
- `app/auth/callback/route.ts`: callback route for code exchange.

## Security Rules

- `SUPABASE_SERVICE_ROLE_KEY` is not used by the login flow.
- Browser code uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Production auth diagnostics are not exposed as public API routes.
- Login errors stay generic and do not reveal whether an email exists.
- Post-login redirects are limited to same-app paths.
- Registration stays disabled in the app UI.
- Password-change errors use fixed Czech copy and never expose provider details or submitted passwords.
- The current password is reauthenticated before a new password can be written.

## Same-origin callback redirect

`app/auth/callback/route.ts` accepts the optional `next` query parameter only as an internal path. The value must begin with exactly one `/`, must not contain a backslash or C0/DEL control character, and must not contain an encoded separator or control character that becomes unsafe after decoding. Absolute URLs, protocol-relative paths, malformed percent escapes, ambiguous double-encoded separators and values such as `/\\evil.example` fall back to `/`.

The callback resolves the accepted path against the trusted `requestUrl.origin` and performs a defense-in-depth check that `target.origin === requestUrl.origin` before redirecting. Ordinary paths, query strings and fragments remain supported, for example `/recordings/123?tab=ai`. A malformed or ambiguous value can therefore never turn `new URL()` into an external redirect.

## 2FA

Two-factor authentication is planned as a later auth hardening step. It should be added through Supabase Auth MFA/TOTP on top of this session model, not as a custom password layer.
