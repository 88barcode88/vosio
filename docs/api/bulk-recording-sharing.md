# Atomic bulk recording sharing

Status: source-only. `20260923000000_add_bulk_recording_sharing.sql` follows the
reviewed `20260922230000` forward without changing it. No migration apply,
PostgreSQL/pgTAP/isolation execution or production verification has occurred.
Project CRUD is outside this contract.

## Session API

```sql
public.bulk_share_recordings_v1(
  p_request_id uuid,
  p_recording_ids uuid[],
  p_visibility text,
  p_recipients jsonb default '[]'
) returns table(recording_id uuid, visibility text)
```

Only `authenticated` can execute; the actor is exclusively `auth.uid()`. Empty
session fails closed. The trusted T1 owner runs a fixed-empty-search-path
SECURITY DEFINER function. No new table/column privileges are granted.

- IDs must be a one-dimensional array of **1–100 raw elements**, with no NULLs.
  Duplicate IDs count against the input bound, then collapse. Results contain
  every unique ID exactly once, ascending UUID order; visibility is the accepted
  requested value. NULL/empty/multidimensional arrays are errors, not no-ops.
- Visibility is `private|project|selected`. Recipients use the reviewed
  `[{"userId":"UUID","role":"reader|editor"}]` format, maximum **100 raw JSON
  elements before canonicalization**, no unknown fields or duplicate UUIDs.
  `selected` requires at least one; other visibilities require an empty set.
  The reviewed canonicalizer normalizes UUID spelling and recipient order; the
  reviewed full validator checks user existence once for a new request.
- Invalid shape/transition/recipient set raises `22023` (invalid UUID text may
  retain the reviewed helper's `22P02`). Missing/foreign/deleted or unauthorized
  recording, missing session and request-payload collision raise `42501`.
  No error includes a failing ID, recipient or content snapshot.

## All-or-nothing authority and mutation

The transaction takes the canonical sharing advisory lock, distinct involved
project rows ascending by ID, then all recording rows ascending by ID. It
re-fetches and validates the complete set after locks. No UPDATE/DELETE/INSERT,
audit or receipt is performed until **all** rows/transitions pass. The same global
lock linearizes overlapping bulk calls with reviewed single-share, assignment,
grant revoke, member revoke and other canonical sharing writers. Project-row
locks cover the existing founder project update/delete path; a changed project
not in the locked set fails closed. Privileged out-of-contract writes must not
bypass canonical locking.

Single-share authority/transition semantics are retained:

- Current `can_manage_recording` and non-deleted status are required for each ID.
  Shared project custody belongs to the founder, not the technical author.
- Publishing an owned private-in-project row requires current project capture
  authority. An active editor can publish their own private row to `project`,
  transferring management to its founder. Selected project sharing additionally
  requires the founder. A founder cannot publish another user's private row.
- `project` requires a project. The D8 forward permits only founder-owned original
  recordings to return from project custody to private; other authors remain shared.
  Standalone selected remains owner-managed and may return to private.
- Active grants and pending invitations intersecting any selected ID are revoked.
  As with single-share, an intersecting multi-recording invitation is revoked as
  a whole bundle, not partially rewritten. Accepted invitations are untouched.
  Pending email invitations are never treated as grants.
- Visibility is changed, then the exact recipient set is inserted per recording
  with `scope_project_id` equal to that recording's project (NULL for standalone).
  Technical owner, attribution, personal taxonomy and provider/storage custody
  are untouched. One `share` audit per unique recording is written on the first
  accepted request. A fresh request intentionally repeats single-share's
  revoke/regrant/audit semantics even when final visibility/grants already match.

Maximum fan-out is 100 recordings × 100 recipients (10,000 grant inserts), plus
revocations of prior grants and pending invitation bundles. Existing history can
make revoke scans larger; this is a correctness bound, not a measured latency
guarantee. Do not split one user bulk action into an app loop of single-share RPCs.

## Durable retry contract

Generate and retain a request UUID **before** the first call; retry uncertain
responses with the same request ID and complete payload. IDs and recipients are
canonicalized before hashing. A forced-RLS, no-direct-grants ledger stores only
actor/request IDs, SHA-256 canonical payload fingerprint, sorted recording IDs,
accepted visibility and completion time. It stores no recipients/roles/emails,
content, paths or tokens; no API updates or deletes completed receipts. No FK
cascade removes a receipt when content or accounts are deleted.

An identical actor/request/canonical-payload retry returns the immutable stored
result with no grant, invitation or audit changes. It works after membership
revoke, later visibility changes, recording purge or recipient account deletion:
syntax is checked before replay but current recipient existence/authority is
checked only for new requests. **This is a historical accepted result, not current
permission or current visibility.** Refresh current UI reads separately.

The same actor/request with another payload is denied. Another actor cannot read
that receipt; the same UUID is a separate actor namespace, and a new operation
there still needs full current authority. Unauthorized actors get no evidence of
the original receipt. Failed requests commit neither mutation nor receipt and
may be retried after correcting the cause. Different request IDs represent new
operations, never recovery of an earlier response.

## Verification, deployment and rollback

The source T4 inbox now calls this RPC once for an explicit private selection;
the recording detail uses the same atomic caller for supported visibility changes.
Both retain the entire attempt and request UUID after uncertain results and validate
the full ordered receipt before showing success. The result is historical; current
reads refresh separately. The D8 forward permits founder-owned originals to return
to private, but preserves other authors' project custody. Standalone first-email invitations
remain a separate explicit invitation/acceptance workflow. These callers are not
enabled against a verified live database by this source change.

Source checks are `tests/unit/bulk-recording-sharing-contract.test.ts`, not RLS
runtime proof. `supabase/tests/bulk_recording_sharing.sql` is executable pgTAP;
`bulk_recording_sharing_concurrency.spec` is PostgreSQL isolationtester input
with exception-raising postconditions. Both require a disposable full-chain DB
and trusted fixture setup. Runtime results remain unverified.

Before deployment: run the full-chain pgTAP and isolation scenarios; inspect
owner/ACL/RLS catalog state; measure representative 100×100 requests and large
grant/invitation history, including lock wait, with EXPLAIN (ANALYZE, BUFFERS) in
a rollback-only staging transaction. Verify trigger/constraint failures roll back
every row and receipt, and both bulk/revoke orders. No latency/concurrency pass
is claimed from source checks. Deploy the forward transactionally under the
trusted T1 owner before enabling the T4 session caller; keep the prior T1–T3
coordinated rollout gates. No service-role app workaround is allowed.

Rollback is forward-only: disable the bulk caller and revoke this exact function's
authenticated EXECUTE in a reviewed forward. Keep receipts for recovery/audit;
do not drop or reinterpret them, since that could repeat completed mutations.
Do not automatically reverse grants/custody after users have made later changes.
Receipt retention/deletion requires a separately approved policy; no background
expiry or pruning is introduced here.
# Additive D8 privacy transition

`20261002030000` preserves the original bulk receipt and all-or-nothing contract, while allowing shared project → private only when the current founder is also the original technical owner. Both single and bulk share revoke the exact old grants and pending invitation bundles before the transition. Other authors' recordings remain in project custody; there is no ownership/account transfer.
