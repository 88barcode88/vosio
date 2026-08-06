# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Vosio, please report it privately:

- Open a [GitHub private security advisory](https://github.com/88barcode88/vosio/security/advisories/new), or
- Contact the maintainer through GitHub ([@88barcode88](https://github.com/88barcode88)).

Please do not open public issues for security problems. Include steps to reproduce,
the affected area (API route, upload, auth, ...), and the impact you expect.

## Scope Notes

- Vosio has no public sign-up; accounts are created manually by the instance owner.
- All server secrets live in environment variables (see `.env.example`). Never commit `.env.local`.
- Self-hosted deployments are responsible for their own Supabase project configuration
  (RLS is enforced by the bundled migration) and provider API key handling.
