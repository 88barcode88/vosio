# Recording invitation application contract

Status: source-only, uncommitted, unapplied and not rollout-ready. Requires the
reviewed sharing RPC migration described in [recording-sharing.md](recording-sharing.md).
No real email, provider configuration, live Auth user creation or database apply
was performed. The ordinary owner-based application still needs coordinated T3/T4
adoption of the sharing contract.

## HTTP and privacy

Every API handler authenticates a current verified Supabase user. Cookie-authenticated
mutations require an exact same Origin and reject cross-site Fetch Metadata. JSON
payloads are streamed with a 16 KiB cap, strict Zod schemas and at most 100 distinct
recording IDs. Responses, including errors, have `private, no-store` and do not
echo Auth/Postgres/provider details or disclose whether a recipient account exists.

- `POST /api/recording-invitations`: `{email, role, scope, ...}`. `role` is reader/editor.
  `scope=project` requires `projectId`; `scope=project-selected` requires `projectId`
  plus exact `recordingIds`; `scope=standalone` requires exact `recordingIds` and
  rejects any project ID. Returns `{id, delivery: sent|failed|pending}`.
- `GET /api/recording-invitations` with `x-invitation-token` previews the intended
  recipient's invite through the narrow verified-email RPC. A URL token parameter
  is not supported. GET/prefetch does not consume the invitation or grant access.
- The same GET with exactly one `projectId` or `recordingId` query argument returns
  the safe current-manager access list, including pending invitation delivery state.
- `PATCH /api/recording-invitations/{invitationId}` reserves a resend under the same
  ID, atomically rotating the hash. It does not create a replacement invitation.
- `DELETE /api/recording-invitations/{invitationId}` revokes a pending invitation.
  Only strict boolean RPC receipts succeed: `{revoked:true,changed:true}` for a
  transition and `{revoked:true,changed:false}` for authorized already-revoked retry.
  An accepted/nonpending `55000` returns HTTP 409 with `invitation_not_pending`;
  foreign/notfound `42501` remains generic 403, and malformed receipts fail closed.
  This operation never removes a grant/member. The UI refreshes conflicts into the
  current access list and does not announce active-access removal.
- `DELETE /api/recording-invitations` accepts `{kind:member,projectId,userId}` or
  `{kind:grant,recordingId,userId}` and uses the corresponding narrow revoke RPC.
- `POST /api/recording-invitations/accept` accepts `{token}` and calls only the
  atomic accept RPC. Verified email, TTL, current authority/scope, same-user replay
  and accept/revoke races are database responsibilities. No callback or page GET
  calls this RPC.

The server creates 32 random bytes, sends only a SHA-256 hash to RPCs and persists
the pending invitation before delivery. Create binds its delivery receipt to the
exact just-created hash. A known send result settles only the reserved attempt ID;
ambiguous delivery/settlement leaves `pending`. `sent` means accepted by the Auth
email API, not inbox delivery. The raw token remains in memory/delivery payload and
the email link fragment, never a database value or application log. The page removes
the fragment immediately and keeps the token only in React memory: reload requires
reopening the email. Do not log request bodies/custom token headers, Auth responses,
email links or callback queries in hosting/analytics tooling.

Delivery has repository-pattern in-process rate brakes: 20 operations/actor/hour,
30/scope/hour and 5/recipient/hour. Recipient keys are hashed. For create, the scope
key is the project or canonical standalone recording set; resend uses invitation
ID because the safe delivery projection deliberately omits scope IDs. Actor budget
may be consumed before authorization. Scope/recipient budgets are consumed only
after a side-effect-free current-manager preflight: project-scoped
`list_recording_access_v1` for project/project-selected creation, or that RPC for
every bounded standalone recording ID. Resend uses the current-manager delivery
receipt. A denied preflight cannot poison another recipient's shared budget.
The subsequent DB create/resend still rechecks authorization atomically; preflight
never authorizes a later write on its own. These brakes
are best-effort across serverless instances and must not be represented as durable
global quotas. The DB enforces the authoritative five-attempt invitation budget
and 60-second resend cooldown independently of process lifetime. Local 429 errors
preserve the actual `retryAfterSeconds` in both JSON and `Retry-After`; they never
substitute a fixed minute. Resend uses safe `attemptCount`/`nextAttemptAt` to separate
HTTP 429 `invitation_cooldown` from terminal HTTP 409
`invitation_attempts_exhausted` (no retry header). If the DB's locked resend returns
`55000` after a concurrent reservation, the caller refreshes the authorized receipt
before classifying it. An inconclusive current receipt yields
`invitation_retry_limited` without inventing a delay. The UI shows terminal state,
disables exhausted invitations and only displays a retry delay when one is known.

## Invite-only Auth and required email templates

New identities use server-only `auth.admin.inviteUserByEmail`. Only explicit
`email_exists`/`user_already_exists` errors choose the existing-account fallback:
`signInWithOtp({shouldCreateUser:false})` on a stateless public client. This client
does not use the manager's cookies or create a PKCE verifier in the manager's browser.
No public signup route or `signUp` call is introduced. Supabase public signup must
remain disabled on the actual target; its live configuration has not been checked.

The delivery contract intentionally uses email OTP entry, because admin invite
does not support a recipient-browser PKCE verifier. Before any rollout, configure
both Supabase **Invite user** and **Magic link** templates with the bundled
`npm run setup:auth` command and verify a newly delivered email. Local CLI Auth
loads the same templates from `supabase/config.toml`. Each template includes the recipient's `{{ .Token }}`
verification code and an HTML-escaped link to **`{{ .RedirectTo }}`**. The supplied
destination is `/invitations/accept#token=<application token>&type=invite|email`.
Do not use `{{ .ConfirmationURL }}` for this flow: default implicit Auth callbacks
do not preserve this application fragment/OTP contract. The application URL must
be in the target's redirect allowlist. The explicit setup command applies only
the narrow invitation settings; SQL migrations do not configure hosted Auth.
Template/config changes require authorization for the selected target.
See [portable Auth setup](invitation-email-setup.md) for installation, upgrade,
self-hosting and read-back checks. Existing emails require a bounded resend.

The acceptance shell is public but reveals no account/project/recording metadata.
`verifyInvitationIdentityAction` accepts only email/invite OTP types, establishes
the cookie session, rechecks verified identity, then requests the safe invitation
preview. For a new invite it sets the submitted matching initial password only
after that preview succeeds. Existing-account OTP also offers an optional password
setup after this fresh identity verification, allowing recovery after a previous
invite's password update failed. These actions do not grant project/recording access.
The recipient must click **Přijmout pozvánku**, which sends the explicit accept POST.
Failure after OTP consumption may require another manager-triggered resend; no
reusable password-reset or public email-send endpoint is added.

The existing callback now rejects failed code exchange, ambiguous callbacks and
unrecognized OTP types. Supported types are invite/email/magiclink/recovery;
signup/email-change callbacks are not introduced. Next destinations are allowlisted
app routes with backslash/control-character and encoded-path rejection. Successful
callbacks establish identity only; they never consume application invitations.

## T3 component integration

`ProjectAccessManager({projectId,canManageAccess})` renders only for a server-resolved
founder capability. `RecordingAccessManager({recordingId,projectId,visibility,
canManageAccess})` supplies project-selected or standalone exact-ID scope. These
components are mounted in the source workspace/workbench under resolved capabilities.
Their props affect presentation only; RPCs enforce current authority.
The UI selects reader/editor on invitation creation, lists manager-safe invitation
receipts and active access, supports bounded resend/revoke, and never fetches
foreign profile names, private taxonomies or provider settings.

The current owner can invite the first email recipient to a standalone private
recording using the same exact-ID create RPC: `p_scope=recordings`,
`p_project_id=null`, `p_recording_ids=[...]`. The panel allows private and selected
standalone recordings. Sending, previewing, resending or revoking a pending invite
does not grant access or publish content. No pre-share call or existing recipient
UUID is required. T1 atomically changes each still-private exact item to selected
and creates the grant only during verified acceptance, after rechecking current
owner, unchanged scope, original item count, expiry and revocation. A second pending
recipient can accept after that first transition. These remain reviewed SQL source
claims pending disposable runtime evidence.

After successful explicit accept POST, the page refreshes the Next router state
before offering navigation to recordings, so subsequent visibility/capability reads
come from current server state. It does not locally infer or set recording access.
Project-private recordings use the separate explicit visibility/bulk caller before
project-selected invitation creation. Project-selected recordings retain founder
authority and existing selected-visibility precondition.

## Verification boundary

Unit tests cover orchestration, hash-only transport, exact scopes, denial propagation,
safe projection, bounded delivery behavior, origin/body/session checks, callback
failure and invite OTP/password sequencing. Mocked permission-denial cases are
caller-contract tests, not live proof of R/E/X or owner/founder access rules.
The focused React test submits a standalone private first invitation, checks exact
transport with no prepublication request, preserves project-private/nonmanager
denials, and verifies refresh only after successful explicit acceptance.
PostgreSQL TTL/revoke/scope/double-accept/race behavior requires the T1 disposable
SQL suites; it cannot be proven by these RPC mocks.

`tests/e2e/project-invitations.spec.ts` is a browser fixture with mocked API responses
covering non-consuming preview, fragment removal, explicit accept and anonymous
onboarding UI. It passed on desktop Chrome and mobile Chrome on 2026-10-02,
together with the isolated sharing fixture (six tests total); this is not
Auth/email/RLS evidence. The Windows runner required cleanup of its verified owned
test-server processes after all tests passed, then exited successfully. Before rollout,
an isolated Supabase Auth/email sink must demonstrate existing and new users,
template redirect/code behavior, password setup, wrong/unverified identity,
delivery failure/resend, old-token rejection and actual concurrent accept/revoke.
