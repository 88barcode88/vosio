# Project sharing database contract

Status: **source-only, not applied and not rollout-ready**. The migration
`20260922190000_add_project_sharing.sql` requires coordinated server/capture adoption.
The source application adopts shared list/search/count, capability-scoped mutations
and capture/worker APIs across the ordered chain. This document describes the T1
contract, not a target apply receipt. Do not apply it independently to a running app.

## Authority

`recordings.user_id` remains the technical owner for existing descendant composite
FKs and Storage paths. `created_by` is attribution, never an access bypass. Legacy
rows backfill to `private`; IDs, content, paths and Trash timestamps remain intact.
Projects may have no client. Assigning a project never changes visibility.

For private recordings the owner alone has access, including when assigned to a
project owned by someone else. Project-visible recordings use active project
membership. Selected recordings use exact active grants whose scope matches the
recording's current project (or null for standalone). Project membership never
widens a selected set. The founder always manages shared project content; the
technical author alone cannot privatize, detach or delete it; the later D8 exception
permits the founder's own original recording to return to private. Standalone selected content
remains managed by its owner. Shared recipients cannot read Trash.

Editors may edit title, one speaker slot, and task status; they may also capture into
a project with active editor membership. They cannot manage access, delete, restore,
purge, invoke AI or use the author's private chat. `runPersonalAi` additionally
requires the original personal/provider owner, current read access and manager
authority. A founder can run personal AI on their own recording, but not on a
foreign-author project recording. This capability never authorizes use of another
person's provider settings. Personal clients, folders, tags,
prompts, provider settings, job snapshots, audit and chat are not shared. Shared
reads cover recordings, transcripts, exact audio, saved AI outputs and projections.
Reading an existing personal chat requires both thread ownership and current
recording access; revocation removes that read without sharing the chat with anyone.

Authenticated direct recording SELECT is restricted to `id`, `title`, `source_type`,
`visibility`, `project_id`, `status`, `duration_seconds`, `file_size_bytes`,
`created_at`, `updated_at` and `created_by`. Sensitive fields such as Storage paths,
provider errors, private client/folder associations, request fingerprints and purge
metadata are not directly selectable, including through `SELECT *` or predicates.
`get_personal_recording_metadata_v1` returns personal metadata only to its original
owner with current recording access. Service workers retain their privileged data
path. Project SELECT similarly exposes only `id/name/color/created_at/updated_at`;
its personal client association is available only through the founder-scoped
`get_personal_recording_project_v1`.

**T3 adoption requirement:** enumerate safe columns for shared lists/details and
replace current owner-only `SELECT *`, `user_id` filters and list/search/count RPCs
that return or inspect protected columns. Use personal metadata RPCs only for
personal owner flows, and the service path only after current request authorization.
Never widen column grants to preserve an old query. Until that coordinated adoption,
the migration and the existing application are intentionally not deployable together.

## Entry points

Revocation blocks new signed-URL creation through the current-access gate. It cannot
recall a URL already issued for the existing 300-second validity window, invalidate
an in-flight download, or erase an already downloaded/cached audio copy. T3 must keep
signature endpoints current-access scoped and preserve the short TTL/no-store
response contract without claiming instantaneous revocation of issued tokens.

All permission-plus-write RPCs take one transaction advisory lock, then entity row
locks. This deliberately coarse first implementation serializes sharing changes
across an installation. No throughput claim is made without DB measurement.

## Invitation API for T2

All entry points below require an authenticated session, use its verified Auth
identity, and have fixed empty `search_path`. Invitation/item tables and private
projection/authority helpers remain inaccessible to authenticated callers. Use the
session client, not service-role writes. No RPC sends email or stores raw tokens.

```sql
create_recording_invitation_v1(
  p_token_hash text, p_email text, p_role text, p_scope text,
  p_project_id uuid, p_recording_ids uuid[], p_expires_at timestamptz
) returns uuid
preview_recording_invitation_v1(p_token_hash text) returns jsonb
get_recording_invitation_delivery_v1(
  p_invitation_id uuid, p_expected_token_hash text default null
) returns jsonb
list_recording_access_v1(
  p_project_id uuid default null, p_recording_id uuid default null
) returns jsonb
resend_recording_invitation_v1(
  p_invitation_id uuid, p_token_hash text, p_expires_at timestamptz
) returns jsonb
settle_recording_invitation_delivery_v1(
  p_invitation_id uuid, p_attempt_id uuid, p_delivered boolean
) returns boolean
accept_recording_invitation_v1(p_token_hash text) returns uuid
revoke_recording_invitation_v1(p_invitation_id uuid) returns boolean
```

Create, list, delivery receipt, resend, settle and revoke check the **current**
project founder for project/project-selected scopes, or the current owner of every
exact standalone recording item. Historical `created_by` alone never authorizes
them. Create/resend persist the current manager as `authorized_by`; preview and
accept recheck that this authorizer still manages the scope. Legacy rows without
an authorizer fall back to validating the historical creator's *current* authority.
If authority changed, the current manager can revoke or explicitly reauthorize by
resending; accepting the old authorization fails. Accept also rechecks active
visibility and exact project association for every recording item. Project-scoped
items must already be selected; the standalone first-email exception follows below.

Invitation revoke returns `true` only when it actually changed an unaccepted,
unrevoked invitation to revoked. An authorized retry on an already-revoked,
unaccepted invitation returns `false` with no mutation or duplicate audit. Both
outcomes confirm that this token is revoked; `false` never means already accepted.
Current manager authority is required even for retries. Unknown or unauthorized
IDs return the same `42501` / `revoke denied` without exposing foreign state.

An accepted invitation instead fails with `55000` / `invitation already accepted`;
an unexpected failed pending-state update fails with `55000` / `invitation not
pending`. The shared transaction lock and invitation row lock linearize accept and
revoke: revoke-first makes accept fail without grants; accept-first makes invitation
revoke fail while its member/grant remains active. This RPC never revokes accepted
access. Removing that access requires the separately authorized member/grant RPC.

**T2 revoke mapping:** Supabase RPC `data === true` means confirmed new revoke;
`data === false` means verified idempotent already-revoked state. Either can return
an HTTP 200 receipt `{revoked: true, changed: data}`. For this RPC, `55000` maps to
HTTP 409 with stable application code `invitation_not_pending`, never a
`revoked: true` success; refresh access state and offer the separate access-removal
action. Map `42501` to the same generic unavailable/forbidden response for absent
and unauthorized IDs. Null, missing or non-boolean data must fail closed, not be
treated as confirmation. Do not map every successful HTTP transport to revoked.

### First email invitation to standalone private content

The existing create signature is unchanged: pass `p_scope='recordings'`,
`p_project_id=null` and exact `p_recording_ids`. The current owner may invite an email
to standalone **private or selected** recordings without first creating user-ID
grants. Multiple pending recipients are allowed. Creation, preview, resend and revoke
do not change visibility or provide recording/list/search/transcript/audio access.
Preview still returns only the intended verified recipient's safe metadata above.

On the first valid accept, the DB takes the shared transaction lock and locks exact
recording rows in UUID order. It revalidates token, current verified email, TTL,
revocation, original item count, current owner authority, active status and unchanged
standalone scope. A private item becomes `selected` and receives the exact recipient
grant in the same transaction. Existing selected items receive their exact grant;
later pending recipients can accept under the same current owner authority. Owner,
author, project and Storage identity are not changed. Any invalid item rolls back
all visibility/grant mutations; hard-purged items cannot silently shrink the set.

Wrong/expired/revoked tokens do not publish content. Reassignment to any project,
deletion or lost owner authority invalidates pending standalone acceptance. Same-user
replay returns only the original receipt and never recreates a grant or republishes
content subsequently returned to private. Revoke before accept leaves private
content private. The existing metadata-free `accept` audit records the transition's
invitation ID, not tokens, email or content.

**T2 caller change:** allow invitation creation for an owned standalone private
recording using the same RPC parameters; do not pre-call `share_recording_v1`, demand
an existing user UUID or publish the recording on send. Refresh capabilities and
visibility after accept. This exception must not be applied to private recordings
inside a project: project-private publication and D5 custody remain outside this
round and require the separately managed T4 transition.

### Safe payloads and bounded delivery

Preview requires the intended recipient's currently verified email. It returns
only `{id, role, scope, expiresAt, recordingCount}`; no email, person/project name,
recording IDs/content or hash. `recordingCount` is zero for project scope. Unknown,
wrong-recipient, consumed, expired, revoked or stale-authority tokens all fail with
the same `42501` unavailable error. Preview never consumes an invitation, adds a
grant/member, or writes audit. The route must not provide an anonymous fallback.

List requires exactly one scope argument. It returns active `members` as
`{userId, role}`, active `grants` as `{recordingId, userId, role}`, and pending
`invitations` (including expired invitations that can still be resent). Standalone
lists have no members. Invitation summaries, also returned by delivery receipt and
resend, have exactly these keys:

```text
id, email, role, scope, expiresAt, acceptedAt, revokedAt,
attemptId, attemptCount, deliveryState, lastAttemptAt, nextAttemptAt,
authorizationCurrent
```

Create reserves delivery attempt 1 and returns the invitation ID. Fetch its safe
delivery receipt with the just-created hash as `p_expected_token_hash` to bind the
`attemptId` to the exact token before delivery. A concurrently rotated, consumed,
revoked or expired token fails that check (`42501`) instead of returning the newer
attempt's receipt. Omit the optional hash only for manager UI inspection, never
when preparing a delivery. Resend atomically reserves the next
attempt under the same invitation ID, rotates the SHA-256 hash and expiry, records
current manager authorization, and resets delivery state to `pending`. The old
application token immediately becomes invalid; no access is granted by resend.
The DB enforces **5 total attempts including create**, **at least 60 seconds between
reservations**, and expiry in the next 30 days. Concurrent resend requests cannot
bypass the bounds. Limit/rate failures return `55000` (`invitation delivery limit
reached`); T2 should map that to a bounded retry/429 response. Invalid input is
`22023`; missing current authority or an accepted/revoked invitation is `42501`.
Budget is not reset by delivery failure or settlement. Do not implement resend by
creating a replacement invitation or writing the table through a service client.

T2 generates a fresh high-entropy raw token in server memory and passes only its
lowercase SHA-256 hash to create/resend. Send the raw token only in the intended
recipient's mail link after a successful reservation; never persist/log it, its
link, request body or provider response containing it. Then settle the exact
`attemptId` with the observed delivery result. Settlement returns false for a
stale, duplicate, consumed or revoked attempt, so an old mail response cannot
overwrite a newer reservation. `sent` is only an application delivery receipt,
not proof of inbox delivery. No email sending was performed by this source change.
If a response is lost, never resend a message using a newly invented token without
a new DB reservation. An ambiguous provider result remains pending for explicit
bounded resend; rotating the token can invalidate an already-delivered old link.

## Accepted work and cascades

The later capture forward replaces the legacy custody acceptance/finalization entry
points and revokes their service EXECUTE. New work uses exact operation/job/claim
receipts described in [capture API](capture-operation-contracts.md). Accepted work
can settle after revoke without restoring user access, restarting TUS or granting
personal AI. Legacy queued/running jobs require separately verified resolution;
they are not automatically converted into new custody receipts.

Source async/live/import/recovery callers adopt this boundary. Service-role access
is still privileged and cannot be secured simply by adding RLS; the technical
`user_id` never replaces current authority or exact continuation receipts. Personal
automatic timeline scheduling has a separate currently authorized boundary.

Delete guards protect shared project recordings from `auth.users`, project and
client cascades. Auth descendants include recordings, transcripts, transcription
jobs, AI jobs/outputs, tasks/chapters/decisions/risks, search chunks, markers, chat,
organization links, timeline intents and custody receipts. Because their owner
FKs lead back to the same recording `user_id`, blocking destruction at the user,
project or client parent retains those descendants too. No transfer, anonymization
or account-deletion workflow is introduced.

## Verification artifacts and limits

`supabase/tests/project_sharing_permissions.sql` uses pgTAP in a transaction ending
in rollback. F/E/R/S/X fixtures use service role only for seeds, followed by actual
`SET LOCAL ROLE authenticated` and `request.jwt.claims` per actor. Owner-only worker
checks run as the disposable DB session owner; anon and browser EXECUTE denials are
separate assertions. SQL source matching is not permission evidence.

`project_sharing_concurrency.spec` is PostgreSQL isolationtester input for two
actual concurrent sessions: revoke-first/edit-first, different speaker slots and
same-slot conflicts, plus both invitation accept/revoke orderings. Invitation races
assert the exact revoke boolean or accepted-state `55000` error, acceptance outcome,
visibility and preserved/absent exact grant. The fixture captures the actual mutation outcome and SQLSTATE;
the revoke-first assertion requires exactly `42501`. Same-slot assertions require
`conflict`, the winner's fresh speaker slot, DB version and search version. Unexpected
errors, missing observations and stale values fail explicitly. It has not been run here.

`project_sharing_upgrade_rollback.sql` starts from the migration chain before
sharing, seeds a legacy Trash row, applies the forward inside a savepoint, compares
all historical fields, then rolls the DDL back and asserts restored schema/data.
Run it only in a disposable DB, separately from the post-migration permission suite.
No database reset, production connection, provider call or email send is included.

This environment has no `psql`/Supabase CLI on PATH and no running Docker daemon.
pgTAP, two-session races and upgrade/rollback rehearsal are prepared but unexecuted.
The source callers are integrated. Disposable runtime evidence and target-specific
preflight remain mandatory before apply, deployment or rollout-readiness claims.
