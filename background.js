const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TERMS_VERSION = 1;
const DEFAULT_SETTINGS = {
  canvasBaseUrl: "https://elearn.ucr.edu",
  calendarEnabled: false,
  googleClientId: "",
  reminderMinutes: [10080, 1440, 120],
  includeAllAnnouncements: false,
  announcementLookbackDays: 7
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.action.setBadgeText({ text: "" });
  const { settings = {} } = await chrome.storage.local.get("settings");
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ settings: mergedSettings });
  if (!mergedSettings.calendarEnabled) await chrome.storage.local.remove("googleTokens");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GOOGLE_STATUS") {
    googleStatus().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "GOOGLE_CONNECT") {
    getAccessToken(true)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "GOOGLE_DISCONNECT") {
    chrome.storage.local.remove(["googleTokens"])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "UPSERT_CALENDAR_EVENT") {
    upsertCalendarEvent(message.item)
      .then((event) => sendResponse({ ok: true, event }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function googleStatus() {
  const { settings = {}, googleTokens, termsAcceptance } = await chrome.storage.local.get(["settings", "googleTokens", "termsAcceptance"]);
  return {
    ok: true,
    enabled: Boolean(settings.calendarEnabled),
    termsAccepted: termsAcceptance?.version === TERMS_VERSION,
    configured: Boolean(settings.googleClientId),
    connected: Boolean(settings.calendarEnabled && (googleTokens?.refreshToken || (googleTokens?.accessToken && googleTokens.expiresAt > Date.now())))
  };
}

async function getAccessToken(interactive = false) {
  const { settings = {}, googleTokens = {}, termsAcceptance } = await chrome.storage.local.get(["settings", "googleTokens", "termsAcceptance"]);
  if (termsAcceptance?.version !== TERMS_VERSION) throw new Error("Accept the current terms before connecting Google Calendar.");
  if (!settings.calendarEnabled) throw new Error("Enable Google Calendar in Settings first.");
  const clientId = settings?.googleClientId?.trim();
  if (!clientId) throw new Error("Add your Google OAuth Client ID in Extension Settings first.");

  if (googleTokens.accessToken && googleTokens.expiresAt > Date.now() + 60_000) {
    return googleTokens.accessToken;
  }
  if (googleTokens.refreshToken) {
    try {
      return await refreshAccessToken(clientId, googleTokens.refreshToken);
    } catch (error) {
      if (!interactive) throw error;
    }
  }
  if (!interactive) throw new Error("Google Calendar is not connected.");
  return authorizeWithPkce(clientId);
}

async function authorizeWithPkce(clientId) {
  const redirectUri = chrome.identity.getRedirectURL("oauth2");
  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomBase64Url(24);
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);

  const callback = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  if (!callback) throw new Error("Google authorization was canceled.");
  const callbackUrl = new URL(callback);
  if (callbackUrl.searchParams.get("state") !== state) throw new Error("Google authorization state did not match.");
  const oauthError = callbackUrl.searchParams.get("error");
  if (oauthError) throw new Error(`Google authorization failed: ${oauthError}`);
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("Google did not return an authorization code.");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || "Google token exchange failed.");
  await saveTokens(payload);
  return payload.access_token;
}

async function refreshAccessToken(clientId, refreshToken) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || "Google token refresh failed.");
  await saveTokens({ ...payload, refresh_token: refreshToken });
  return payload.access_token;
}

async function saveTokens(payload) {
  const { googleTokens = {} } = await chrome.storage.local.get("googleTokens");
  await chrome.storage.local.set({
    googleTokens: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || googleTokens.refreshToken || "",
      expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
    }
  });
}

async function upsertCalendarEvent(item) {
  if (!item?.key || !item?.dueAt) throw new Error("A valid date and time are required before adding this item.");
  const { termsAcceptance } = await chrome.storage.local.get("termsAcceptance");
  if (termsAcceptance?.version !== TERMS_VERSION) throw new Error("Accept the current terms before creating Calendar events.");
  const token = await getAccessToken(true);
  const { settings = {}, calendarEventMap = {} } = await chrome.storage.local.get(["settings", "calendarEventMap"]);
  const eventId = calendarEventMap[item.key];
  const start = new Date(item.dueAt);
  if (Number.isNaN(start.getTime())) throw new Error("The detected due date is invalid.");
  const end = item.endAt ? new Date(item.endAt) : new Date(start.getTime() + 30 * 60 * 1000);
  const reminders = (settings.reminderMinutes || [10080, 1440, 120])
    .filter((minutes) => Number.isFinite(Number(minutes)) && Number(minutes) >= 0 && Number(minutes) <= 40320)
    .map((minutes) => ({ method: "popup", minutes: Number(minutes) }));

  const body = {
    summary: item.calendarTitle || `${item.courseCode || item.courseName}: ${item.title}`,
    description: buildDescription(item),
    location: item.location || "",
    start: { dateTime: start.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    colorId: "11",
    reminders: { useDefault: false, overrides: reminders },
    extendedProperties: { private: { canvasTrackerKey: item.key } }
  };

  const url = eventId ? `${GOOGLE_CALENDAR_API}/${encodeURIComponent(eventId)}` : GOOGLE_CALENDAR_API;
  const response = await fetch(url, {
    method: eventId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 404 && eventId) {
      delete calendarEventMap[item.key];
      await chrome.storage.local.set({ calendarEventMap });
      return upsertCalendarEvent(item);
    }
    throw new Error(payload.error?.message || "Google Calendar rejected the event.");
  }
  calendarEventMap[item.key] = payload.id;
  await chrome.storage.local.set({ calendarEventMap });
  return { id: payload.id, htmlLink: payload.htmlLink, updated: Boolean(eventId) };
}

function buildDescription(item) {
  const lines = [
    `Course: ${item.courseName || item.courseCode || "Canvas course"}`,
    `Type: ${item.kindLabel || item.kind || "Assessment"}`,
    `Source: ${item.sourceType || "Canvas"}`
  ];
  if (item.details) lines.push("", item.details);
  if (item.sourceUrl) lines.push("", `Canvas source: ${item.sourceUrl}`);
  lines.push("", "Added with Canvas Assessment Tracker.");
  return lines.join("\n");
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
