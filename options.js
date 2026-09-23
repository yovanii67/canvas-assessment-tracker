const DEFAULT_SETTINGS = {
  canvasBaseUrl: "https://elearn.ucr.edu",
  calendarEnabled: false,
  googleClientId: "",
  reminderMinutes: [10080, 1440, 120],
  includeAllAnnouncements: false,
  announcementLookbackDays: 7
};
const UCR_ORIGIN = "https://elearn.ucr.edu";
const GOOGLE_ORIGINS = [
  "https://accounts.google.com/*",
  "https://oauth2.googleapis.com/*",
  "https://www.googleapis.com/*"
];
const redirectUrl = chrome.identity.getRedirectURL("oauth2");
let savedCanvasOrigin = UCR_ORIGIN;

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#redirectUrl").textContent = redirectUrl;
  document.querySelector("#copyRedirect").addEventListener("click", async () => {
    await navigator.clipboard.writeText(redirectUrl);
    setStatus("Redirect URL copied.", "success");
  });
  document.querySelector("#calendarEnabled").addEventListener("change", syncCalendarVisibility);
  document.querySelector("#save").addEventListener("click", save);
  document.querySelector("#deleteData").addEventListener("click", deleteAllLocalData);

  const { settings = {} } = await chrome.storage.local.get("settings");
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  savedCanvasOrigin = normalizeOrigin(merged.canvasBaseUrl);
  document.querySelector("#canvasBaseUrl").value = merged.canvasBaseUrl;
  document.querySelector("#calendarEnabled").checked = Boolean(merged.calendarEnabled);
  document.querySelector("#googleClientId").value = merged.googleClientId;
  document.querySelector("#reminderMinutes").value = merged.reminderMinutes.join(", ");
  document.querySelector("#announcementLookbackDays").value = merged.announcementLookbackDays;
  document.querySelector("#includeAllAnnouncements").checked = Boolean(merged.includeAllAnnouncements);
  syncCalendarVisibility();
});

function syncCalendarVisibility() {
  const enabled = document.querySelector("#calendarEnabled").checked;
  document.querySelector("#calendarSettings").hidden = !enabled;
}

async function save() {
  try {
    const canvasBaseUrl = normalizeOrigin(document.querySelector("#canvasBaseUrl").value);
    const calendarEnabled = document.querySelector("#calendarEnabled").checked;
    const clientId = document.querySelector("#googleClientId").value.trim();
    const reminderMinutes = document.querySelector("#reminderMinutes").value
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 40320);
    const announcementLookbackDays = Number(document.querySelector("#announcementLookbackDays").value);

    if (calendarEnabled && clientId && !clientId.endsWith(".apps.googleusercontent.com")) {
      throw new Error("That does not look like a Google OAuth Client ID.");
    }
    if (calendarEnabled && !reminderMinutes.length) {
      throw new Error("Enter at least one reminder between 0 and 40,320 minutes.");
    }
    if (!Number.isInteger(announcementLookbackDays) || announcementLookbackDays < 1 || announcementLookbackDays > 30) {
      throw new Error("Announcement history must be between 1 and 30 days.");
    }

    const requestedOrigins = [];
    if (canvasBaseUrl !== UCR_ORIGIN) requestedOrigins.push(`${canvasBaseUrl}/*`);
    if (calendarEnabled) requestedOrigins.push(...GOOGLE_ORIGINS);
    if (requestedOrigins.length) {
      const granted = await chrome.permissions.request({ origins: requestedOrigins });
      if (!granted) throw new Error("The requested website access was not granted. Canvas scanning or optional Calendar access cannot work without its matching permission.");
    }

    await chrome.storage.local.set({
      settings: {
        canvasBaseUrl,
        calendarEnabled,
        googleClientId: clientId,
        reminderMinutes: reminderMinutes.length ? reminderMinutes : DEFAULT_SETTINGS.reminderMinutes,
        includeAllAnnouncements: document.querySelector("#includeAllAnnouncements").checked,
        announcementLookbackDays
      }
    });

    if (!calendarEnabled) {
      await chrome.storage.local.remove("googleTokens");
      await chrome.permissions.remove({ origins: GOOGLE_ORIGINS });
    }
    if (savedCanvasOrigin !== canvasBaseUrl && savedCanvasOrigin !== UCR_ORIGIN) {
      await chrome.permissions.remove({ origins: [`${savedCanvasOrigin}/*`] });
    }
    savedCanvasOrigin = canvasBaseUrl;
    setStatus("Settings saved. Canvas access is limited to the selected website.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function deleteAllLocalData() {
  const confirmed = window.confirm("Delete every locally stored task, scan result, setting, acceptance record, and Google authorization token? This cannot be undone.");
  if (!confirmed) return;
  try {
    if (savedCanvasOrigin !== UCR_ORIGIN) {
      await chrome.permissions.remove({ origins: [`${savedCanvasOrigin}/*`] });
    }
    await chrome.permissions.remove({ origins: GOOGLE_ORIGINS });
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    await chrome.action.setBadgeText({ text: "" });
    setStatus("All local data was deleted. Reopen the side panel to review and accept the terms again.", "success");
    setTimeout(() => location.reload(), 900);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:") throw new Error();
    return url.origin;
  } catch {
    throw new Error("Enter a valid HTTPS Canvas address, such as https://elearn.ucr.edu.");
  }
}

function setStatus(message, type) {
  const status = document.querySelector("#status");
  status.textContent = message;
  status.className = type;
}
