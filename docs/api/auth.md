# Auth

## Current Model

Vosio uses Supabase Auth with email/password login for internal users.

The application does not expose registration. Users are created manually in the Supabase dashboard under Auth users. The app login form only calls `signInWithPassword` for existing users.

## Runtime Flow

```text
Visitor opens protected route
-> Next.js proxy refreshes Supabase cookies
-> unauthenticated visitor is redirected to /login
-> user signs in with email/password
-> Supabase stores cookie-backed session
-> user lands on the Vosio workspace
```

## Files

- `src/lib/supabase/server.ts`: request-scoped server Supabase client.
- `src/lib/supabase/browser.ts`: browser Supabase client with publishable key only.
- `src/lib/supabase/proxy.ts`: session refresh and route protection.
- `proxy.ts`: Next.js proxy entrypoint.
- `src/lib/auth/actions.ts`: sign in and sign out server actions.
- `app/login/page.tsx`: internal login page.
- `app/auth/callback/route.ts`: callback route for code exchange.

## Security Rules

- `SUPABASE_SERVICE_ROLE_KEY` is not used by the login flow.
- Browser code uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Production auth diagnostics are not exposed as public API routes.
- Login errors stay generic and do not reveal whether an email exists.
- Post-login redirects are limited to same-app paths.
- Registration stays disabled in the app UI.

## 2FA

Two-factor authentication is planned as a later auth hardening step. It should be added through Supabase Auth MFA/TOTP on top of this session model, not as a custom password layer.
