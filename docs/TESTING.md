# Validation and manual checks

## Automated validation performed

- 24 Node API/utility/UI tests: real Express HTTP requests and temporary local
  files, with injected metadata/auth doubles. Covers all protected endpoints,
  cross-account access, inherited grants, editor/owner boundaries, revocation,
  correct folder upload, exact upload limits, Unicode/duplicates, rename, move
  cycles, recursive delete and concurrency, database failure recovery, traversal,
  safe preview headers, pagination, budget persistence and storage symlinks.
- The DOM UI integration test executes the actual frontend against Express:
  registration/login/logout UI, folder creation/navigation, rename, text preview,
  sharing, moves and deletion. It substitutes client auth and dialog primitives;
  it does not measure rendered layout.
- Firebase Authentication emulator: actual Firebase client registration, correct
  and wrong-password login, logout, Admin ID-token verification and disabled-user
  rejection through Express.
- Firestore emulator: actual Admin metadata writes, filtered listing, document-ID
  cursor pagination and deletion; direct client requests rejected by deny-all rules.
- Browser auth module built successfully with esbuild. JavaScript syntax checks
  and `npm audit` passed; no known dependency vulnerabilities at validation time.

**Not verified here:** Chrome could not start in the desktop sandbox (Windows IPC
access denied). `test/browser.mjs` is provided but full browser/mobile screenshots
and its layout assertions must be run outside that sandbox. No production Firebase
credentials were provided, so actual Spark project settings, deployed indexes,
authorized domains and multi-device LAN/HTTPS behavior need manual validation.

## Repeat the tests

```sh
npm ci
npm run build
npm test
npm audit
npx playwright install chromium
npm run test:browser
```

Use Node 24 for the test runner. The browser suite uses an injected auth module,
real Express routes and local files. It checks 320/390/768/1440px layouts, grid/list
overflow, duplicate Unicode uploads, sharing and downloads. It saves desktop/mobile
screenshots under ignored `test-results/`. `DRIVE_TEST_CDP` can point to a separately
launched local Chromium debugging endpoint if necessary.

For optional emulator tests install the **free Firebase CLI and Java 21+**. Run
Auth on 127.0.0.1:9099 and Firestore on 127.0.0.1:8089 for project `demo-drive`, using
the repository rules file. An optional local configuration is:

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "emulators": {
    "auth": { "host": "127.0.0.1", "port": 9099 },
    "firestore": { "host": "127.0.0.1", "port": 8089 },
    "ui": { "enabled": false }
  }
}
```

Save this as a temporary config beside the rules file, then run
`firebase emulators:start --only auth,firestore --project demo-drive --config YOUR_CONFIG.json`.
In another terminal run `node test/emulators.mjs`; use `--auth-only` if only Auth is
running. The `demo-` project and explicit localhost hosts prevent production use.
Production `server.js` refuses emulator environment overrides. Do not use emulator
tokens or test fixtures in a live deployment. The Firestore emulator does not
enforce production composite-index deployment requirements.

## Manual acceptance checklist

Use two separate browser profiles/accounts (Alice and Bob), plus a logged-out tab.

1. Register Alice and Bob; verify their email addresses, log out/in, try a wrong password and refresh the page.
   Confirm a logged-out API request is rejected and private content clears on logout.
2. Create nested folders; upload in the inner folder and verify root is unchanged.
   Try ten small files, eleven files, an empty upload and a file over 100 MiB.
3. Upload two identical names, `שיעורי בית (2).pdf`, spaces/accents and long names.
   Verify the display names and downloaded bytes/names. Check disk files are UUIDs.
4. Rename a file/folder and confirm its children and physical file remain intact.
   Navigate with breadcrumbs, back, refresh, grid/list, local search and sort.
5. Move a file between folders and a folder with children. Reject moving a folder
   into itself or its descendant. Check inherited sharing changes as documented.
6. Download text, images and PDFs. Preview text/HTML/SVG safely as text; check
   raster images, audio, video and PDFs. Unsupported or >20 MiB files offer download.
7. Share a file with Bob as viewer; Bob can download but cannot rename/delete/share.
   Change Bob to editor; rename works but owner-only operations remain forbidden.
8. Share a nested folder. Bob sees descendants, but no private ancestor names.
   Editor uploads belong to Alice. Revoke sharing and try the same IDs again.
9. Change IDs in requests to another user's private items. Listing, uploading,
   downloading, previewing, renaming, moving, deleting and sharing must all fail.
   Try traversal/raw path parameters and direct `/storage` or `/data` URLs.
10. Delete a file and a small nested folder after confirmation. Verify associated
    metadata and bytes disappear, and another user's files remain. Test a folder
    over 200 items: it must fail without partial deletion.
11. At 320px and 390px widths, test sidebar actions, long names, lists, dialogs,
    upload progress, breadcrumbs and previews. Check no horizontal page scrolling,
    usable touch controls, keyboard focus and Escape-to-close. Repeat on desktop.
12. Turn off the network mid-request and stop/restart the server. Refresh before
    retrying an ambiguous upload. Check meaningful messages and inspect recovery
    guidance before removing a stale lock or any orphan bytes.
13. Confirm project remains Spark, no billing account exists, Firestore direct
    client access is denied and metadata usage stays within the documented limits.
    Test with actual LAN devices and HTTPS before sharing real sensitive files.
