# Canvas Assessment Tracker

A local-first Microsoft Edge and Google Chrome extension that turns Canvas assignments and actionable announcement instructions into a private checklist. Google Calendar reminders are optional and require individual approval.

## Privacy promise

- Users sign in manually on their school's official Canvas website.
- The extension never asks for or stores Canvas passwords or email addresses.
- Scanning starts only after the user accepts the terms and presses **Scan open Canvas tab**.
- Canvas data, checklist history, settings, and optional Google authorization tokens stay in that browser profile's extension storage.
- There is no developer-operated account, analytics service, backend, or shared database.
- Each installation is isolated. The developer and other users cannot see someone else's course data.
- **Settings → Delete all local data** removes coursework, task history, settings, terms acceptance, and local Google tokens.

Read [`PRIVACY.md`](PRIVACY.md) and [`TERMS.md`](TERMS.md) before distributing the extension.

## Version 0.3.0

- Adds a required Terms of Use and Privacy Notice gate.
- Prevents Canvas scans and Calendar actions until the current terms are accepted.
- Removes automatic background scanning; every scan is manually initiated.
- Adds a configurable HTTPS Canvas address for schools outside UCR.
- Requests browser access only for the exact custom Canvas domain saved by the user.
- Keeps Google Calendar disabled by default.
- Adds a full local-data deletion control.
- Adds a minimalist cream-and-cobalt interface with serif display typography.
- Keeps the unified to-do list introduced in version 0.2.

## What it scans

- Active Canvas courses.
- Unsubmitted assignments, including undated assignments.
- Recent announcements from the configured 1–30 day window.
- Instructor-created Canvas calendar events with assessment keywords.
- Numbered, lettered, bulleted, and action-oriented announcement instructions.

The scanner remembers announcement IDs and edit timestamps so unchanged announcements are not processed repeatedly. Completed tasks remain completed after later scans.

## Install locally

1. Download and unzip the release.
2. Open `edge://extensions` or `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the folder that directly contains `manifest.json`.
6. Open the side panel, review the terms, and accept them.
7. Open **Settings** and confirm the official Canvas address.
8. Sign in manually on that Canvas website.
9. Open the extension and press **Scan open Canvas tab**.

## Share through GitHub

The repository contains code only. It does not contain user coursework, passwords, email addresses, Google tokens, or browser storage.

1. Create a GitHub repository.
2. Copy the contents of this folder into it.
3. Confirm that no secrets or personal files were added:

   ```bash
   git status
   git grep -nE "client_secret|access_token|refresh_token|password"
   ```

4. Commit and push:

   ```bash
   git init
   git add .
   git commit -m "Initial privacy-first Canvas tracker release"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
   git push -u origin main
   ```

5. Create a GitHub Release and attach a ZIP whose root contains `manifest.json`.
6. Friends download the release, unzip it, and use **Load unpacked**.

A public repository lets users inspect the privacy behavior. A private repository limits source access but does not make local user data more private; the local-only architecture provides that separation.

## Custom Canvas schools

UCR (`https://elearn.ucr.edu`) is included as the default required host. For another school:

1. Open extension Settings.
2. Enter the school's exact official HTTPS Canvas origin, such as `https://school.instructure.com`.
3. Save.
4. Approve the browser's permission request for that website.

The extension does not receive general browsing access unless a user explicitly grants a custom Canvas origin.

## Optional Google Calendar

Calendar integration is off by default. Each user should authorize their own Google account. For GitHub-loaded builds, the simplest privacy-preserving setup is for each user to create their own OAuth Client ID.

1. Enable Google Calendar in extension Settings.
2. Copy the displayed redirect URL.
3. In Google Cloud Console, enable the Google Calendar API.
4. Configure the OAuth consent screen.
5. Create a **Web application** OAuth Client ID.
6. Add the extension's redirect URL to **Authorized redirect URIs**.
7. Paste the Client ID into Settings and save.
8. Return to the panel and press **Connect**.

Never add a Google client secret to this extension or GitHub. A client ID is an identifier, not a secret. Calendar access requests only `calendar.events`. Approved task details are sent to Google only when the user chooses to create or update an event.

For a smoother shared OAuth experience, publish an unlisted Chrome Web Store build with a fixed extension ID and complete Google's OAuth verification requirements. Keep the GitHub source available separately if desired.

## Browser permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Saves settings, tasks, completion status, terms acceptance, and optional Google tokens locally. |
| `identity` | Opens Google's optional OAuth flow. |
| `sidePanel` | Displays the tracker interface. |
| `tabs` | Identifies the active Canvas tab after a manual scan click. |
| `scripting` | Injects the scanner into the active, approved Canvas website only when scanning. |
| UCR host access | Supports the default `elearn.ucr.edu` Canvas installation. |
| Optional HTTPS host access | Allows the browser to grant one custom Canvas origin selected in Settings. |
| Optional Google hosts | Requested only when Calendar is enabled; supports authorization and event writes. |

## Development

No build step or package installation is required. Edit the HTML, CSS, and JavaScript files, then press **Reload** on the browser's extensions page.

Run basic checks:

```bash
node --check background.js
node --check content.js
node --check sidepanel.js
node --check options.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"
```

See [`CURSOR_HANDOFF.md`](CURSOR_HANDOFF.md) for architecture, privacy invariants, file ownership, testing, and suggested next work.

## Limitations

- Natural-language task and date extraction is intentionally conservative.
- Users must verify dates and instructions against the original Canvas page.
- Canvas institutions may restrict API endpoints.
- Custom Canvas installations may behave differently from UCR.
- Google OAuth setup for unpacked extensions is technical and is not required for checklist use.
- This is an independent student tool, not an official Instructure, Google, UCR, or school product.
