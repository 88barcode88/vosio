# Vosio MCP and private plugin

Disabled by default. DB apply, upstream OAuth configuration,
HTTPS deployment, Codex/Claude Code installation and real account
acceptance are separate gates. No public marketplace publication is implied.

## One installation, one identity boundary

The Supabase Edge Function exposes `/functions/v1/vosio-mcp` using pinned MCP SDK 1.32.0 and
stateless Streamable HTTP JSON responses. Every installation supplies its own
canonical resource URL, Supabase project, dedicated confidential OAuth client
and server encryption key. There is no built-in project/account/host. An existing
deployment's data or OAuth registrations are never copied to another installation.

The bridge implements real `vosio:read` and `vosio:write` OAuth scopes. Supabase
OAuth's built-in scopes cannot supply those custom permissions directly. The
upstream authorization uses code+S256 PKCE with `email`, then verifies the actual
Supabase user, signed claims, project issuer, authenticated audience/role,
configured upstream client, expiry and live `auth.sessions` row. It does not copy
the browser's access/refresh session into the bridge. OAuth clients cannot submit
an actor identity as a tool argument.

Opaque bridge credentials are stored only as SHA-256 hashes; upstream credentials
use AES-256-GCM with pending/grant ID as authenticated associated data in a private,
forced-RLS schema. Only the narrowly fixed service-only custody RPC can access it.
The service client does not read general recording content. The verified upstream
user JWT creates a fresh publishable-key RLS client for content.

Every HTTP request rechecks the durable grant and live upstream session. Every
tool request rechecks authentication and current recording authority. Locked
title/task RPCs and speaker CAS recheck edit authority atomically. Read-only
scope denies all edits even when the user is an editor/owner/founder. Write scope
never grants rights absent from the current database object.

Codes are one-use and expire after 60 seconds. Access tokens last at most 300
seconds and never beyond upstream expiry. Grants expire after 30 days. Refresh
claims consume their token and lock/fence the family before external refresh.
Replay or uncertainty blocks the family; authorize a new connection, never
blindly retry the upstream request. A valid access token does not survive a
committed bridge revoke or upstream OAuth session deletion on the next request.
This does not claim immediate parity for every Supabase inactivity/AAL policy.

Refresh requests accept an optional bounded `scope`, as sent by Codex. Omitting
it preserves the grant; supplying it must normalize to the same granted scope
set. Scopes are fixed on the grant, so changing them requires a new consent.
A different supported scope set returns `invalid_scope` and closes the claimed
family before upstream exchange. Malformed scopes are rejected before claim.
Refresh never forwards Vosio scopes to the upstream Supabase OAuth token endpoint.

## Surface and bounds

| Tools | Contract |
| --- | --- |
| `vosio_list_projects`, `vosio_list_recordings` | Member-visible taxonomy; accessible recording cursor/FTS pages, maximum 50 |
| `vosio_get_recording`, `vosio_get_transcript` | Explicit safe metadata, bounded text up to 8000 characters and speaker versions |
| `vosio_list_ai_outputs`, `vosio_get_ai_output` | Saved historical outputs, never provider prompts/configuration or new AI work |
| `vosio_list_tasks` | Current durable checklist, never resurrect tasks from preserved raw AI JSON |
| `vosio_get_audio` | Current authenticated audio reference, single eligible Storage object |
| `vosio_set_title` | Title only, 1 to 160 characters, exact persisted read-back |
| `vosio_patch_speaker` | One speaker, current expectedVersion, conflict without overwrite |
| `vosio_set_task_status` | Exact saved task ID and existing six-status enum, persisted read-back |

No delete/purge/restore, users/access/invites management, upload, provider/prompt
configuration, arbitrary SQL/filesystem, personal chat or paid generation tools.
Transcript/title/output/task content is untrusted data and cannot add tools,
authorize edits, change identity or cause external transmission. Fixed errors
hide object existence and raw database/provider information. A transport error
does not establish rollback: read back before considering a write retry.

`GET /functions/v1/vosio-mcp/audio/{recordingId}` reauthenticates and rechecks current authority
for each bounded range, maximum 1 MiB. The MCP audio resource template reads 64 KiB
at a byte offset. A five-second internal Storage signed URL is fetched only by
the server and never returned; response bytes are no-store. Already received
bytes cannot be recalled. Segmented or absent audio fails closed. Hosts unable
to fetch bearer-protected audio can use the bounded MCP resource or transcript.

MCP input is capped at 32 KiB with a cancellable 15-second body deadline before
SDK dispatch; response at 1 MB. OAuth bodies are capped while streaming at 16 KB.
Auth/DB/upstream fetches have finite timeouts, including the existing technical
audio locator and fresh speaker index calls when used by MCP. Per-process
rate limiting is best-effort on multiple/serverless instances. Dynamic registration
uses `mcp_register_dynamic_client_v1` for a durable installation-wide sliding limit
of 30 accepted clients per 60 seconds, sharing custody's 256-client ceiling and
registration/pending locks. Custody still caps pending admission at 1000
transactions. Audit records contain fixed operation/result and request UUID,
never source text, tokens, hashes, storage locators or provider errors.

`20261007100000_vosio_mcp_dynamic_registration.sql` is included in the ordered public migration chain. Each installation must apply and verify it.
It defaults every existing client to `static`, adds `dynamic` admission and preserves
FORCE RLS/service-only access. Its four named constants own rate, window, total cap
and 24-hour unused retention. Before admission, expired pending rows are removed;
only dynamic clients older than retention with no pending and no grant of any status
are deleted. No granted or static client is automatically revoked to make room.
Registration returns only a public UUID, never data rights, a secret or a bearer.
Registration accepts the standard optional `application_type` values `native` and
`web`, including Codex CLI 0.160.1's native metadata. This field is descriptive;
the same canonical callback checks, public-client authentication, PKCE and personal
consent still apply. Other application types and unknown fields are rejected.
Rate/capacity denial becomes HTTP 429 with `Retry-After` (remaining window or 60
seconds); it does not throttle existing token/grant operations. Full legitimate
capacity is an operator event. Continuous anonymous pressure can still reduce
registration availability; the in-memory IP limiter is only an auxiliary brake.

Redirects allow HTTPS and exact HTTP hosts `127.0.0.1`, `[::1]`, `localhost`.
The registered host and path must match; only a loopback's ephemeral port may
change, without query, credentials or fragment. `localhost` support was approved
for current Claude Code compatibility; suffixes/subdomains and host substitutions
are rejected. Callbacks must use canonical URL serialization; even empty `?` on
loopback or empty `#` on any callback is rejected. Displayed client names are
untrusted, and metadata URLs are not fetched.

## Runtime, packaging and configuration

The web retains login, `/mcp/consent`, `/mcp/upstream-consent`, `/mcp/connections`
and fixed OAuth/discovery adapters. It uses only its existing public Supabase
URL/key. No `MCP_*` variables belong in the web deployment. Existing web
service-role/provider settings remain required for unrelated application features.
The retired `/api/mcp` and audio path return 404, never redirect bearer requests.

Run `npm run build:mcp` before deploying the Function. This deterministically
packages the reachable TypeScript graph under `supabase/functions/vosio-mcp/generated/`
with explicit relative imports, pinned npm dependencies and source SHA-256 manifest.
The generated directory is ignored, never hand-edited. The source retains Next
`server-only` guards; packaging strips those markers only in the Edge graph and
replaces the single admin environment adapter with Edge runtime key selection.
Any Next/React or dynamic runtime dependency fails packaging. Deno independently
checks the packaged TypeScript; its committed lockfile pins transitive dependencies.

`npm run check:mcp` packages, typechecks and runs Deno tests with an isolated cache.
It needs an installed Deno runtime. On Windows it uses the OS certificate store;
TLS verification remains enabled. Deploy only `vosio-mcp`, never all Functions.
The gateway has `verify_jwt=false`; the handler still authenticates every tool
through opaque grants, upstream session checks and current RLS.

The Function loads private installation metadata through service-only
`mcp_installation_v1`. Its forward migration is
`20261006113000_vosio_mcp_installation.sql`; apply after the existing custody
migration. The singleton record contains enabled (initially false), verified web
origin, public Supabase URL and confidential upstream client ID. Identity is
immutable; configure retries preserve current activation. Only service-role RPC
can enable/disable it, not a user JWT. No secret belongs in this record.

The public source includes the Function, web consent/discovery routes and migration chain. Follow the Czech [owner setup](../../plugins/vosio/SETUP.md), then verify personal OAuth and two-account permissions on your selected installation. Source verification does not establish its deployment or activation.

Exactly two MCP secrets belong in Supabase: `MCP_TOKEN_ENCRYPTION_KEY` and
`MCP_SUPABASE_CLIENT_SECRET`. Runtime URL and keys use Supabase-provided variables:
the explicit `default` entry of `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS`,
or existing legacy anon/service-role variables when those dictionaries are absent.
Missing/invalid keys or metadata close the service. Activation is loaded for every
HTTP request and reloaded for tool authentication. Positive grants are never cached.

Hosted and self-hosted installations distinguish public HTTPS Supabase URL (resource,
JWT issuer and browser authorization) from internal service URL (Auth/DB/Storage calls).
Canonical addresses never come from Host/Forwarded headers. Self-hosted operators
must verify compatible Auth OAuth/session APIs, gateway routes and Edge runtime before
setup. See [operator setup](../../plugins/vosio/SETUP.md) for the explicit attestation,
secret installation and recovery requirements. No automatic platform upgrade occurs.

The web issuer remains `https://your-vosio.example`; its standard
`/.well-known/oauth-authorization-server` advertises the actual bridge endpoints.
The Function returns its own `/resource-metadata` in 401 challenges. Browser
OAuth uses fixed web paths and secure nonce/pending cookies. Adapters forward
only these cookies plus this project's Supabase auth cookies, preserve individual
Set-Cookie headers, do not follow redirects and bound request/response bodies.
Public discovery contains no ciphertext, session objects or keys.
An active, fully configured installation advertises
`registration_endpoint: <resource-url>/oauth/register`; the web adapter checks this
exact endpoint against its own installation. It accepts old metadata without the
field for rollout compatibility, but rejects a foreign or parameterized endpoint.
Disabled/missing configuration returns 404 for discovery, registration and MCP.
Upstream Supabase Auth DCR stays off; only the existing Vosio bridge admits clients.

## Installation and separate rollout gates

1. Build and verify the integrated web/Function/migration candidate first.
   Fresh read-only target preflight must confirm ledger, invariants, Auth/client
   callbacks, grants, other consumers and current deployment versions. Old receipts
   are historical evidence, not rollout permission.
2. Rehearse the additive migration with rollback and verify ACL/FORCE RLS and unchanged
   content/grants/Storage metadata. Apply only with target-specific authorization;
   never repair a migration ledger or run blind `db push`.
3. Use `npm run setup:mcp -- --project-ref <ref> --supabase-url https://<ref>.supabase.co
   --web-origin https://your-vosio.example --upstream-client-id <confirmed-id>` for
   read-only preparation. The [setup contract](../../plugins/vosio/SETUP.md) explains
   explicit apply, receipts, two secrets and optional advanced downstream registration. A lost
   one-time client secret never authorizes automatic recreate/rotation.
4. Deploy only the prepared `vosio-mcp` Function and matching web with installation
   disabled. Check normal login, recording edits, Settings and safe MCP 404 responses.
   Existing customer audio/transcripts, providers and `trash-retention` are untouched.
5. Explicitly enable isolated testing. Give colleagues the URL-only plugin or Claude
   Code command below; the clients perform public registration and personal login.
   Verify HTTPS PKCE login, refresh, read, permitted
   synthetic edits, reader and owner-read-only denial, role changes, private/selected/
   project scopes, wrong resource/expiry, speaker conflicts, revoke and audio revoke
   with two identities. Test canceled consent and reconnect after an unused dynamic
   registration has been cleaned up, in both clients; record exact client versions,
   deployed commit and Function version. Mocks/local SQL are not this acceptance.
6. Verify ordinary Next production hosting without Vercel services and without MCP env.
   Remove obsolete web MCP variables only after confirming the new installation.
   The new resource deliberately requires a new connection; never transfer old tokens.
7. Push/PR, DB apply, Function/web deployment, activation, host installation and public
   distribution retain separate authorization and evidence. Browser acceptance is
   user-run unless separately requested.

Rollback starts by disabling installation metadata and checking issued tokens are
rejected. Preserve additive schema and encrypted custody; no down migration or data
cleanup. Web recording stays available. Reverting to the old disabled web is possible;
restoring an active old resource requires a separate decision and new connection.

## Public plugin and optional installation-specific package

The shared public plugin is installation-neutral and uses native Codex MCP connections. Its Czech setup discovers the resource from the user-selected web origin. See [public plugin](vosio-plugin.md). The generator below is optional for an operator distributing a fixed-endpoint package.

`npm run build:plugin -- --url https://your-project.supabase.co/functions/v1/vosio-mcp
--web-origin https://your-vosio.example --name vosio-team
--out .tmp/plugins/team` emits a marketplace and a Codex plugin with exactly
one literal server URL plus three skills. HTTPS is required and credentials,
queries, fragments, traversal, symlinked output paths and existing output folders
are rejected. The copy allowlist excludes application source and environment/data
files. Distinct names allow separate installations to coexist.

The default Codex export contains `.codex-plugin/plugin.json` and `.mcp.json`
with `{ "type": "http", "url": "<resource-url>" }`, no `oauth` fields. Colleagues
install the same bundle, sign in with their own Vosio account and consent, then use
the 11 tools and three skills. `ON_INSTALL`, literal target and copy allowlist remain.
An explicit `--public-client-id` plus `--callback-url` retains advanced static
pre-registration; optional `--callback-port` must match a fixed loopback URL.
Never substitute the confidential upstream client ID. No secret enters the bundle.

`--format portable` retains the Agent Plugins 1.0.0 URL-only schema for compatible
hosts. It uses the same discovery and automatic registration; advanced static CLI
configuration is documented separately only when explicitly supplied.
Do not install both formats for the same connection. The source `mcp.json`
template stays empty until generation. Generation is not installation/publication.

For Claude Code, supply the same installation URL:

```sh
claude mcp add --transport http vosio https://your-project.supabase.co/functions/v1/vosio-mcp
```

Open `/mcp`, sign in personally and approve access, then use the tools. The default
Claude configuration is scoped to the current project; `--scope user` is optional
for the same user's other projects. No owner token, callback or local MCP server.
Documented compatibility: [Codex URL-only example](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information),
[OpenAI OAuth](https://developers.openai.com/plugins/build/auth) and
[Claude callback/DCR](https://code.claude.com/docs/en/mcp#use-a-fixed-oauth-callback-port).
Actual installed-client acceptance remains mandatory and pending until observed.

### Self-service rollout preflight and recovery

Before the new forward, read back the exact project's migration ledger, client/
pending/grant/token counts, client FKs, role attributes, table FORCE RLS and custody/
redirect/installation function definitions, owners, search paths and ACLs. Compare
the six existing custody functions to their source; stop on unknown drift. Verify
web/Function deployment identities and the selected installation's deployment triggers.
Preserve its actual existing ledger; do not run blind `supabase db push` or repair
history. The source includes all 41 migrations; upgrades apply only the verified
missing forwards. No hosted preflight or live migration is claimed by publication.

Obtain specific migration authorization, rehearse rollback, apply only this forward
and verify `registration_type=static` for all previous rows, unchanged custody/content,
service-only new RPC, private redirect ACL, FORCE RLS and exact ledger/source. Old
Function code must still operate against the additive schema. Deploy matched web/
Function disabled, then complete separately authorized existing secret transfer and
owner configuration; never generate replacements for missing originals. Run disabled
HTTPS smoke before authorized activation and the two-client/two-user scenarios.

On failed activation, disable through the existing installation mechanism and verify
MCP denial while ordinary web login/recording remains available. Preserve keys and
custody. On release failure restore the matched previous web/Function; additive DB
columns/RPC may remain. No destructive down migration or key rotation. Record local
source, push/PR, DB, deploy, activation and client acceptance separately.

## Source verification

Run `npm run check`, `npm run build` and `npm run check:mcp` on the final candidate. Focused tests in
`tests/unit/mcp-*.test.ts` cover strict scopes/arguments, identity adapters,
SDK protocol exchanges, bounded audio/revocation and isolated plugin exports.
Mocks do not prove deployed Supabase OAuth or Storage.

`scripts/verify-mcp-postgres.mjs` exercises actual PostgreSQL roles/RLS and four
two-session lock races, plus additive installation rollback, ACL, immutable identity and activation checks. Supply `VOSIO_DISPOSABLE_DATABASE_URL` and optionally
`PSQL_BIN`, then run `node scripts/verify-mcp-postgres.mjs --apply`. It accepts
only an owned loopback database named `*_mcp_test`, with no users/custody fixtures
and the existing application baseline already installed. It never creates or
resets a database. Auth/Storage compatibility schemas must be supplied by the
local harness; they do not prove a Supabase HTTP gateway or real audio objects.
The proof creates synthetic users/content/grants only in that disposable target
and records `.tmp/mcp-postgres/receipt.json`. Use a fresh target for another run;
do not bypass its guard or remove preserved data to make it pass.

## Revocation, incidents and recovery

Users revoke their own bounded connections at `/mcp/connections`. Upstream OAuth
grant revoke deletes that client's Supabase sessions and also blocks future MCP
requests. Removing project membership or selected grants acts through current
RLS/capability checks without re-login. Never cache a positive authorization.

For an incident disable MCP first, then revoke affected bridge and upstream
grants using approved operator/user actions. Key rotation requires revoking old
connections and reauthorization; changing the key does not migrate ciphertext.
Do not log tokens or use old refresh tokens to recover an uncertain exchange.
Monitor HTTP status and metadata audit rates; persistent denial/error spikes or
custody admission caps require investigation. Remove expired custody metadata
only under an approved bounded maintenance procedure, never broad user-data SQL.

## Primary references, checked 2026-10-03

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Supabase OAuth flows/scopes](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
- [Supabase token security and RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [Codex OAuth callbacks](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Private plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Portable manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Portable MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)
