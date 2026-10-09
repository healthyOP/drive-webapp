# Architecture, security and free-tier usage

## Request flow

```text
Browser -- email/password --> Firebase Authentication
Browser -- Bearer ID token + file/ID --> local Express server
Express -- verifyIdToken(token, true) --> Firebase Admin Authentication
Express -- metadata reads/writes --> default Cloud Firestore (Spark)
Express -- file bytes --> private local data/blobs/<UUID>
```

`server.js` loads private configuration and dependencies; `app.js` assembles
middleware and is independently testable. `routes/files.js` keeps the original
route names and Multer architecture. `services/permissions.js` resolves ownership
and ancestors. `services/metadata.js` is the only production metadata adapter.
`public/app.js` calls the same-origin API with refreshed tokens; the browser has
no Firestore SDK and never uses Firebase file storage. `src/auth-client.js` uses
only Firebase App/Auth and bundles to a locally served module.

The necessary architecture change is IDs instead of user filesystem paths. An
item ID locates metadata; a separate storage ID locates file bytes. Display names
never select a disk path. Rename only updates metadata. Folders are metadata
relationships, so upload destination does not depend on multipart field order.

## Metadata model

One `items/{uuid}` document per file or folder:

```js
{
  ownerId: 'Firebase UID',
  parentId: null,             // or another item UUID with kind=folder
  kind: 'file',               // or 'folder'
  name: 'שיעורי בית.pdf',      // validated NFC display name, <=255 UTF-8 bytes
  size: 12345,
  mimeType: 'application/pdf', // informational; never trusted for execution
  storageId: 'another-uuid',  // null for folders, never returned to the UI
  created: 'ISO timestamp',
  modified: 'ISO timestamp',
  grants: { recipientUid: { role: 'viewer', email: 'person@example.com' } },
  sharedWith: ['recipientUid'] // bounded index projection for Shared with me
}
```

Ownership cannot be reassigned by a browser. Each subtree has one owner. Uploads
and folders created by an editor in a shared folder belong to that folder's owner.
Grants and their small index projection are written together atomically. No
profile, folder-size, activity or quota-count documents are written per request.
There are no Firestore listeners, background polling or per-card database reads.

Sharing requires the recipient's Firebase email to be verified, preventing an
unverified signup from impersonating the address an owner intends to share with.
The UI sends verification emails only on request, with a resend cooldown.

| Operation | Viewer | Editor | Owner |
| --- | --- | --- | --- |
| List/open/download/preview | Yes | Yes | Yes |
| Rename item | No | Yes | Yes |
| Upload/create in shared folder | No | Yes | Yes |
| Move/delete/share/revoke | No | No | Yes |

Permissions inherit downward; direct grants can add access but cannot deny
inherited access. Moving changes inherited access. Direct grants remain. Shared
with me lists direct shares; opening a folder lists its inherited children. Private
ancestor names are excluded from breadcrumbs. The API validates access even if
the UI hides a control. Unauthorized object IDs return 404; known shared items
with insufficient privileges return 403. Grants are cached only within one request.

## Consistency and deployment boundary

One Node process serializes all mutations. Uploads authorize before streaming,
then recheck permissions with a fresh context inside the mutation lock before
publishing. This prevents uploads into deleted/moved/unshared folders. A startup
disk lock prevents two processes on the same data directory. This is deliberately
a small, single-machine app, not a distributed service: do not point a second
server at the same database, and do not edit metadata manually while it runs.

Firestore batch commits atomically create all metadata for an upload or delete
all metadata in a bounded subtree. The filesystem cannot participate in that
transaction:

- Failure before metadata commit: staged files and newly linked blobs are removed.
- Failure during upload commit: the server retains published blobs because the
  commit may actually have succeeded. Refresh the folder before retrying to avoid
  duplicate uploads. Unreferenced blobs remain private and inaccessible.
- Failure before/during metadata deletion: blobs are retained. A possibly successful
  metadata deletion can leave orphans, but it never breaks a still-accessible file.
- Successful metadata deletion: unlink files; if local cleanup fails, the response
  includes `cleanupPending` and the UI informs the operator. No browser can read them.

After a crash, stop the server, back up both data and metadata, inspect each local
UUID against metadata references, and only remove confirmed orphan files.
Do not remove blobs based solely on a request failure or filename guessing.
`data/incoming` contains unpublished uploads; after confirming no server is running,
leftovers can be removed. An automated reconciliation tool is a future FREE improvement.
Keep the budget ledger during recovery. There is no automatic orphan sweep that
could consume background reads or accidentally remove user data.

## Free-tier costs and safety budget

The architecture uses only free-compatible Authentication and Standard Firestore.
Spark is the no-charge boundary. It can **throttle or stop operations at quota
limits**; free service is not unlimited service. There is no automatic upgrade.

Official [Firestore free quotas](https://firebase.google.com/docs/firestore/quotas),
checked 2026-10-09: one free database, 1 GiB stored data, 50,000 document reads/day,
20,000 writes/day, 20,000 deletes/day and 10 GiB outbound data/month. These are
metadata transfers; actual uploaded/downloaded file bytes travel through your
local server. Daily quotas reset around midnight Pacific time.

The local ledger reserves at most **10,000 reads, 5,000 writes and 5,000 deletes
per Pacific calendar day** across this server. It is persisted before requests
and survives restarts. A query reserves its full limit even if fewer documents
are returned or the request fails. The app deliberately stops early with a useful
503 error when the safety budget is exhausted. This is conservative admission
control, not a Google billing meter: console activity, other programs, SDK retries,
metadata storage and network usage are outside its accounting. Use a dedicated
Spark project and keep storage/usage visible in the Console. Do not erase the
ledger to bypass a limit.

The schema caps names and shares, exempts nonqueried fields from indexes, and
bounds queries and recursive operations. A small deployment with a few users and
thousands of items should fit comfortably; sustained growth still needs monitoring.
Never enable TTL, PITR, managed backup/restore/clone, paid search, Functions or Storage.

### Estimated Firestore operations

`d` is the number of folder documents in the relevant path; `n` is documents
returned, `k` is uploaded files. Empty queries cost at least one read. Request-local
ancestor caching avoids duplicate reads within most operations.

| Action | Approximate actual reads | Writes / deletes |
| --- | --- | --- |
| Registration/login/logout | 0 | 0 (Auth only) |
| Root listing / Shared with me | max(1, n), up to 51 | 0 |
| Open a folder | d + max(1, n), up to 51 query results | 0 |
| Load next page | Same as folder listing | 0 |
| Search/sort/grid/list switch | 0 | 0 |
| Upload k files at root | 0 | k writes, max 10 |
| Upload k files inside a folder | 2d (before and after streaming) | k writes |
| Create folder | d | 1 write |
| Rename/download/preview | 1 + ancestor count | Rename: 1 write; transfer: 0 |
| Share/change/revoke | 1 + ancestor count | 1 write; email lookup uses Auth |
| Move file | Item + source/destination ancestors | 1 write |
| Delete or move a folder | Path reads + child results + minimum reads for empty child queries | Delete: up to 200 deletes; move: 1 write |

Listing reserves 51 reads plus path reads. Recursive traversal reserves 201 reads
per visited folder, so a large tree may hit the safety budget earlier than actual
Firestore quota. Nothing is changed until traversal and permission checks succeed.
Permission checks for downloads still require live metadata; server-side file
bytes do not remove authorization reads.

For example, 50 daily small-folder listings of 20 items at depth 2 consume about
1,100 reads (reserve 2,650), 20 single-file uploads at depth 2 add 80 reads and
20 writes, and 50 file downloads with 2 ancestors add 150 reads. These numbers
exclude Console use and retry overhead. They are estimates, not a promised quota.

Standard email/password auth avoids SMS and email-link costs. Firebase also applies
[Authentication abuse/rate limits](https://firebase.google.com/docs/auth/limits).
This app verifies revoked/disabled sessions on every request, which adds Auth
network traffic but no Firestore reads. Use the limits page for provider-specific
quotas; do not upgrade to a paid provider to avoid a limit.

## Security fixes and remaining boundaries

Fixed unauthenticated access, cross-user ID/path access, lexical traversal and
symlink storage entries, user-controlled disk filenames, duplicate naming races,
case-insensitive rename overwrites, unlimited multipart counts/sizes, filename
HTML injection, inline active-content previews, undefined preview URLs, missing
secret ignores and raw API error handling. API responses and transfers are
no-store. CSP, nosniff, frame restrictions and IP request limits are applied.

Files are not malware-scanned or encrypted by this app. A server OS administrator
can read local data and has privileged Firebase credentials. Secure the operating
system, restrict private-key/data ACLs and use disk encryption/backups as needed.
HTTP does not protect credentials from network observers; HTTPS is needed outside
a trusted development network. A user can always retain content already downloaded.
Logout signs the browser out and clears the UI/session persistence; it does not
invalidate a previously copied ID token on other devices. To revoke those sessions,
use Admin revocation/disable the account. The backend checks revocation every request.

Existing files are not automatically migrated because their ownership is unknown.
Browser visual checks and a real configured Spark project remain operator checks;
emulator behavior does not prove a production index is deployed or client domains
are configured. See the validation record for exact test coverage.
