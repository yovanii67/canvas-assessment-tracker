# Canvas Assessment Tracker

A browser side-panel checklist for Canvas coursework. It finds assignments and actionable announcement instructions, groups tasks by course or announcement, and can optionally add reminders to Google Calendar.

## What you need

- A desktop computer running Microsoft Edge or Google Chrome
- Access to an active Canvas account
- Permission to view this private GitHub repository
- No package installation, command line, or build step

Google Calendar is optional. Using it requires a Google Cloud OAuth Client ID; the checklist works without one.

## Install on your device

1. Open this repository on GitHub.
2. Select **Code → Download ZIP**.
3. Extract the downloaded ZIP to a folder you will keep on your computer.
4. Open `edge://extensions` in Edge or `chrome://extensions` in Chrome.
5. Turn on **Developer mode**.
6. Select **Load unpacked**.
7. Choose the extracted folder that directly contains `manifest.json`.
8. Pin **Canvas Assessment Tracker** from the browser's extensions menu if desired.

Do not delete or move the extracted folder while the extension is installed.

## Use the tracker

1. Open the extension side panel.
2. Review and accept the Terms of Use and Privacy Notice.
3. Open **Settings** and confirm your school's official Canvas address.
4. Sign in manually on that Canvas website.
5. Return to the extension and select **Scan open Canvas tab**.
6. Review tasks grouped beneath their Canvas announcement or course.
7. Check off completed work and verify dates against the original Canvas page.

Scans run only when you press the scan button. Coursework and checklist state are stored locally in your browser profile.

## Optional Google Calendar reminders

1. Open extension **Settings**.
2. Enable Google Calendar.
3. Follow the displayed instructions to create a Google OAuth Client ID.
4. Save the Client ID and connect your Google account.
5. Set or confirm a task date, then select **remind**.

Google Calendar is not required to scan Canvas or use the checklist.

## Update after downloading a newer version

1. Replace the files in the installed extension folder with the newer files.
2. Open `edge://extensions` or `chrome://extensions`.
3. Select **Reload** on the Canvas Assessment Tracker card.
4. Reopen the side panel and refresh the Canvas page.

## Remove local data

Open extension **Settings** and select **Delete all local data**. Removing the extension also removes its browser-managed local storage.
