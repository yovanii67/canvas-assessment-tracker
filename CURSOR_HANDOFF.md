# Cursor Handoff

## Product goal

Canvas Assessment Tracker is a Manifest V3 browser extension that privately converts a student's Canvas assignments, announcements, and relevant Canvas events into a local checklist. It supports optional, user-approved Google Calendar writes.

The product must remain usable without an account, server, analytics service, or Google Calendar connection.

## Privacy invariants

Treat these as non-negotiable acceptance criteria for every Cursor change:

1. Never collect, request, log, transmit, or persist Canvas passwords or email addresses.
2. Never place OAuth client secrets, Google tokens, Canvas cookies, or user data in source files, Git, logs, telemetry, or a remote service.
3. Canvas login always happens manually on the school's official site.
4. Do not scan until the current terms are accepted and the user presses the scan button.
5. Keep Calendar disabled by default.
6. Store scanned data and optional tokens only in `chrome.storage.local`.
7. Request custom Canvas host permission only for the exact HTTPS origin the user saves.
8. Preserve **Delete all local data** and ensure it clears terms acceptance and Google tokens.
9. Do not add remote scripts, CDNs, trackers, analytics, ads, or remotely hosted executable code.
10. Always make extracted dates reviewable and link back to the original Canvas source.

## Architecture

| File | Responsibility |
| --- | --- |
| `manifest.json` | Manifest V3 permissions, service worker, side panel, settings page, and optional host access. |
| `background.js` | Default settings, optional Google OAuth PKCE flow, token refresh, and Calendar event upserts. |
| `content.js` | Runs only after manual injection into the active approved Canvas tab; calls Canvas API endpoints and normalizes assignments, announcements, tasks, and events. |
| `sidepanel.html` | Terms gate, tracker shell, filters, and task/review templates. |
| `sidepanel.js` | Terms acceptance, manual script injection, task state, scan merging, UI rendering, and Calendar approval actions. |
| `sidepanel.css` | Minimalist cream/cobalt visual system inspired by editorial portfolio design. |
| `options.html/js/css` | Exact Canvas-origin permission, optional Calendar setup, scan settings, privacy information, and deletion controls. |
| `terms.html`, `privacy.html` | In-extension readable policies. |
| `TERMS.md`, `PRIVACY.md` | Repository copies of the policies. |

## Data flow

1. User installs the unpacked extension.
2. User opens the side panel and accepts Terms version 1.
3. User confirms an official Canvas HTTPS origin in Settings.
4. User signs in manually on Canvas.
5. User presses **Scan open Canvas tab**.
6. `sidepanel.js` verifies the active tab's origin, then injects `content.js` into that tab.
7. `content.js` calls same-origin Canvas API endpoints with the browser's existing session.
8. Normalized results return to the side panel and are saved locally.
9. If Calendar is enabled and connected, the user can approve individual event writes.

No Canvas password, email address, or session cookie is read into extension storage.

## Storage keys

| Key | Contents |
| --- | --- |
| `settings` | Canvas origin, Calendar opt-in, OAuth client ID, reminder minutes, and announcement preferences. |
| `termsAcceptance` | Accepted terms version and timestamp. |
| `canvasItems` | Normalized Canvas assignments, announcements, and relevant events. |
| `canvasTaskStates` | Per-task completion, user-edited date, and Calendar link state. |
| `seenAnnouncements` | Canvas announcement fingerprints used to skip unchanged announcements. |
| `googleTokens` | Optional local OAuth access/refresh token data. |
| `calendarEventMap` | Local mapping used to update rather than duplicate Calendar events. |
| `lastCanvasScan` | Timestamp of the last manual scan. |

## Local development in Cursor

1. Extract the source ZIP.
2. In Cursor, choose **File → Open Folder** and select the folder containing `manifest.json`.
3. Open `edge://extensions` or `chrome://extensions`.
4. Turn on Developer mode and choose **Load unpacked**.
5. Select the same source folder.
6. After code changes, press **Reload** on the extension card and refresh the Canvas page.

No `npm install`, compiler, or build step is required.

## Required validation

Run after every JavaScript or manifest change:

```bash
node --check background.js
node --check content.js
node --check sidepanel.js
node --check options.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"
```

Run a secret-pattern check before every GitHub push:

```bash
git grep -nEi "client_secret|access_token|refresh_token|password|BEGIN (RSA |EC )?PRIVATE KEY"
```

Expected matches should be documentation or runtime field names only—never actual credentials.

## Manual test checklist

- [ ] Fresh install shows the terms gate and hides the tracker.
- [ ] Scan cannot run before acceptance.
- [ ] Terms and Privacy links open local extension pages.
- [ ] Accepting terms reveals the tracker.
- [ ] Calendar shows as off by default.
- [ ] UCR Canvas scans only after a manual click.
- [ ] A different active website is rejected.
- [ ] Saving a custom Canvas origin triggers an exact-site permission request.
- [ ] Assignments appear as checklist tasks.
- [ ] Actionable announcement lines become separate tasks.
- [ ] Completing a task survives another scan.
- [ ] Calendar cannot connect while disabled.
- [ ] Disabling Calendar removes local Google tokens.
- [ ] Delete all local data removes tasks and returns the extension to the terms gate.
- [ ] No passwords, email addresses, tokens, or course data appear in the repository.

## Suggested next milestones

1. Add automated unit tests for date parsing and announcement task extraction.
2. Add a small permissions-status indicator for the configured Canvas origin.
3. Add import/export of local checklist data as a user-controlled JSON file.
4. Add an optional completed-task archive filter.
5. Test against multiple Canvas domains before claiming broad compatibility.
6. Prepare an unlisted Chrome Web Store listing and a formal privacy-policy URL if shared OAuth is desired.

## Safe Cursor prompt

Use this at the beginning of a Cursor session:

> You are editing a Manifest V3 browser extension named Canvas Assessment Tracker. Read README.md, CURSOR_HANDOFF.md, PRIVACY.md, and TERMS.md before changing code. Preserve all privacy invariants: manual Canvas login, manual scans only, required terms acceptance, exact-origin permissions, local-only storage, no passwords or email addresses, no telemetry/backend/remote scripts, Calendar disabled by default, and complete local-data deletion. Do not add dependencies unless strictly necessary. After edits, run every validation command and report changed files, privacy impact, and manual tests still required.

## Release packaging

From the source folder:

```bash
zip -r ../canvas-assessment-tracker-v0.3.0.zip . \
  -x '.git/*' '.DS_Store' 'Thumbs.db' '*.pem' '*.key' '.env*' 'releases/*'
unzip -t ../canvas-assessment-tracker-v0.3.0.zip
```

The ZIP root must contain `manifest.json`; do not place the source inside an extra nested folder.
