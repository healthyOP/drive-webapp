# My Drive

A small multi-user drive using the existing Node.js/Express, Multer and vanilla
HTML/CSS/JavaScript stack. Actual file bytes stay on the computer running Node.
Firebase is used only for **email/password Authentication and Firestore metadata**.

**No Blaze plan, billing account, credit card, Cloud Storage, Cloud Functions,
paid hosting, or paid Google Cloud service is required. Keep this project on Spark.**
If a free quota is exhausted, wait for its reset or reduce usage; do not enable billing.

## What changed

- Backend-verified login, registration/logout UI and separate private drives.
- UUID disk filenames and metadata display names; duplicate names stay separate.
  Hebrew, accents, spaces, numbers and common punctuation are preserved.
- ID-based folders, upload targeting, breadcrumbs, download, rename and move.
- Viewer/editor grants on files and folders, inherited access and Shared with me.
- Limited Multer uploads, safe text/media previews, consistent JSON errors and
  a responsive version of the existing monochrome drive layout.
- Request-bounded metadata reads and a persistent daily database safety budget.

See [the pre-change inspection](docs/INSPECTION.md),
[architecture and usage estimates](docs/ARCHITECTURE.md), and
[validation and manual tests](docs/TESTING.md).

## Firebase setup — Spark only

1. Create a project in [Firebase Console](https://console.firebase.google.com/).
   Keep the **Spark** plan. Do not link a Cloud Billing account, redeem a Cloud
   trial, or enable Analytics or other services for this app.
2. Under Authentication, enable **Email/Password**. Leave email-link sign-in,
   phone/SMS, enterprise providers and Identity Platform upgrades off. Users can
   register directly in the app. Before someone can receive shares, they must use
   **Verify email**, follow the verification link, then log out/in. This prevents
   someone claiming an email address they do not control. Verification emails are
   available on Spark (1,000/day as of the checked limits). Consider configuring a
   stronger password policy.
3. Register a Web app in project settings. Copy its public `apiKey`, `authDomain`,
   `projectId` and `appId` into `.env` using the names below. These client values
   identify the app; they are not Admin credentials. Only these values are sent
   through `/api/config`.
4. Create the **default Cloud Firestore database, Standard edition / Native mode**,
   in a suitable region. Choose production mode. Publish the contents of
   `firestore.rules` in its Rules tab: all direct client access is denied. The
   local Admin SDK bypasses these rules; Express enforces user permissions.
5. In the Indexes tab, create the collection-scope composite index for `items`:
   `ownerId` ascending, `parentId` ascending (document ID is implicit). Keep the
   automatic array index for `sharedWith`. The exact definitions and optional
   single-field index exemptions are in `firestore.indexes.json`.
   Alternatively, with the free Firebase CLI installed and signed into your own
   account, run `firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID`.
   This deploys database configuration only, not the Node server or files.
6. In Project settings → Service accounts, generate an Admin private key. Save it
   **outside the repository and outside `public/`**, readable only by the server
   account. Set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path. Never send
   it to the browser or commit it. Use a dedicated service account with only the
   necessary Firebase Authentication and Firestore access for longer-lived use.
7. Check Authentication → Settings → Authorized domains for the hostname you use.
   Email/password is used without an OAuth redirect. For localhost development,
   add `localhost` if absent. Do not change `FIREBASE_AUTH_DOMAIN` to your server IP;
   copy the Firebase Web app value. If your setup rejects an IP hostname, use a
   local hostname in DNS/hosts and authorize it.

Firebase's official [pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans),
[Authentication limits](https://firebase.google.com/docs/auth/limits), and
[Firestore quotas](https://firebase.google.com/docs/firestore/quotas) were checked
for this implementation. No paid feature is used or automatically provisioned.
The app cannot detect a billing plan change made by a project administrator;
keeping the project on Spark is the protection against charges.

## Run on your main computer

Use Node.js 24 LTS (Node 22+ for the server) and npm. From this branch:

```sh
npm ci
npm run build
```

Copy `.env.example` to `.env`, then fill it in. In PowerShell use
`Copy-Item .env.example .env`. The build bundles **only Firebase App/Auth** for the
browser; it does not bundle Firestore or any file-storage SDK into the frontend.
Rebuild after changing `src/auth-client.js` or updating the Firebase client SDK.

| Variable | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_API_KEY` | Web app's public API key |
| `FIREBASE_AUTH_DOMAIN` | Web app's configured auth domain |
| `FIREBASE_APP_ID` | Web app ID (recommended) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Absolute private service-account key path |
| `HOST` | `0.0.0.0` to accept LAN connections; `127.0.0.1` for this computer only |
| `PORT` | `3000` by default |
| `STORAGE_ROOT` | Optional absolute private directory; defaults to this repo's `data/` |

On Windows use forward slashes in paths, for example
`GOOGLE_APPLICATION_CREDENTIALS=C:/private/drive-admin.json`. Do not put your data
directory inside `public/`; startup rejects that configuration.

```sh
npm start
```

Open `http://localhost:3000` on the server or `http://SERVER_LAN_IP:3000` from
another computer on the same network. Allow the chosen port on the server's
private-network firewall. Authentication and metadata still need internet access.
HTTP is suitable only for local experiments on a trusted network: it exposes
tokens and file contents to network observers. Use a free HTTPS reverse proxy
such as Caddy with a certificate trusted by clients for real accounts or remote
access. Do not expose this development server directly to the public internet.

Run **one Node process and one server machine** for this Firebase project. No
cluster mode, replicas or second independent copy pointing at the same metadata.
Local mutation serialization and file consistency rely on this documented scope.
An exclusive `data/server.lock` rejects another process using the same directory.
After an abnormal exit, confirm the recorded PID is no longer running before
removing that lock. Never remove it from a running server.

## Files, permissions and limits

Owners can do everything. Viewers can list/open/download. Editors can also rename,
upload and create folders inside shared folders. Editors cannot delete, move,
change ownership or reshare. Uploads inside shared folders belong to the folder's
owner. Folder grants apply to descendants; the strongest direct/inherited grant
wins. Revoking a direct share does not remove an independent inherited share.
Revocation is checked on the next request; already downloaded bytes cannot be recalled.

- 10 files per upload, 100 MiB each; 2 concurrent uploads across this server.
- 50 items per page; search/sort operate on loaded items, without extra cloud reads.
- Up to 20 direct recipients per item and 20 folder levels.
- Recursive deletion and folder moves examine at most 200 items. Larger trees
  must be handled in smaller groups. Deletes are permanent; there is no trash yet.
- Browser previews stop at 20 MiB. Downloads use a browser Blob and can use up to
  the file's size in client memory. SVG/HTML/code preview as text; PDF uses a
  sandboxed frame and may require download in browsers that block PDF frames.
- Metadata is small, but stored metadata and disk space are finite. Monitor both.
  There is no per-user disk quota or malware scanner in this version.

## Existing files and recovery

The old ignored `storage/` directory is **not modified, deleted, exposed or
automatically assigned to anyone**. Back it up first. Register the intended owner,
recreate their folders in the new UI, then upload the old files into that account.
Duplicate names remain distinct. This explicit import avoids assigning private
legacy data to the wrong user. Keep the backup until names and downloads are verified.
Historically corrupted filenames cannot always be recovered automatically; rename
them through the UI after checking the intended name.

Back up `data/blobs` and metadata together to a local disk while the server is
stopped. Do not enable Firestore paid scheduled backups, PITR or managed exports.
For metadata backup, a small operator script using the Admin SDK and local JSON
files can be added later (it will consume document reads).

Uploads stage in `data/incoming`, publish UUID blobs, then atomically commit
metadata. Deletes atomically remove metadata before unlinking bytes. Firestore
and local disk cannot form one transaction: a crash or ambiguous network result
can leave inaccessible orphan blobs. It never warrants deleting all storage.
See recovery details in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development and tests

```sh
npm test
npm audit
# Optional real-browser tests (downloads a free test browser):
npx playwright install chromium
npm run build
npm run test:browser
```

The normal tests use temporary storage and injected test metadata/auth; they never
read `.env` or connect to production Firebase. The browser suite stubs only client
auth and tests real Express/file operations. Separate local Firebase emulator
checks are documented in [TESTING.md](docs/TESTING.md).

## Possible next improvements

| Recommendation | Classification |
| --- | --- |
| Trash with operator-controlled retention on local disk | FREE |
| Per-account disk quota, upload cancellation and storage indicator | FREE |
| Local metadata/byte backup and orphan reconciliation utility | FREE |
| Starred files, recent items, avatars and dark mode | FREE |
| Multi-select, bulk move/delete and streaming ZIP downloads | FREE |
| Streaming authenticated downloads for larger files | FREE |
| Global search using a bounded local index | FREE |
| Local antivirus scanning with ClamAV and quarantine | FREE |
| Additional browser/device tests, keyboard context menus | FREE |
| Managed Firestore PITR/backup/TTL or Firebase Cloud Storage for files | PAID/NOT ALLOWED; use explicit local backup/cleanup instead |
| SMS sign-in or billing-dependent Cloud Functions | PAID/NOT ALLOWED; retain email/password and local Node jobs |

Drag/drop, upload progress, folder sharing, breadcrumbs, local search/sort and
Shared with me are already implemented. Optional recommendations are not enabled.
