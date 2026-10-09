# Inspection and implementation plan

Inspected all tracked application files on main at `21f7db0` before editing.

## Existing behavior to preserve

Express 5 serves public HTML/CSS/vanilla JS and mounts file routes under `/api`.
Multer writes files locally. The frontend already sends the current folder in
the upload query; `/api/delete` matches the backend despite its outdated comment.
Grid/list views, local search/sort, breadcrumbs, drag/drop, preview and confirmations
are useful and should remain. The server listens on all network interfaces.

## Findings

- No authentication or ownership checks on any route; anyone can read/delete everything.
- `safePath` rejects lexical traversal but follows symlinks outside storage.
- Browser paths and visible filenames are disk paths. Duplicate-name probing races;
  renaming with case-insensitive comparisons can overwrite another file on Linux.
- Multer has no upload size/count limits and multipart filename encoding is not repaired.
- Previews interpolate filenames into HTML attributes (XSS). Arbitrary HTML can be
  served from the app origin. Audio and unsupported previews reference undefined `url`.
- Root rename is not explicitly prohibited; deletion recursively removes whole trees.
- Client navigation requests can race, showing stale folder contents.
- Fixed sidebar, nonwrapping actions and list columns overflow phones; controls are small.
- Preview markup precedes the body; controls lack accessible labels/focus management.
- `.env` and service account keys are not ignored. No setup guide or tests exist.

## Plan and dependencies

1. Retain Express/Multer and route names, replace unsafe browser paths with opaque
   IDs consistently in routes, frontend, breadcrumbs and download/preview calls.
2. Add Admin token verification and metadata repository. Files remain local; UUID
   disk keys are separate from NFC-normalized Unicode display names. Deny direct
   Firestore client access. Limit and budget database work with no listeners/polling.
3. Add ownership, inherited folder grants, viewer/editor/owner checks, moves and
   bounded recursive deletion. Serialize mutations for this single-server deployment.
4. Add email/password auth and update the existing UI, preserving its identity and
   working features while fixing previews, errors, upload feedback and responsiveness.
5. Test APIs, authorization, filesystem failures and browser workflows; document
   Spark-only setup, migration, usage estimates, limitations and manual checks.

The authorization model and frontend must change together: path-based endpoints
cannot remain as an unauthenticated compatibility backdoor. Legacy `storage/` is
left untouched and private; the operator must explicitly import files into an account.
Only `codex/multi-user-local-drive` may receive commits. Main is never updated.
