const TERMS_VERSION = 1;

let activeFilter = "todo";
let items = [];
let taskStates = {};
let googleConnected = false;
let calendarEnabled = false;
let appInitialized = false;

const $ = (selector) => document.querySelector(selector);
const list = $("#itemList");
const scanButton = $("#scanButton");
const scanStatus = $("#scanStatus");
const googleButton = $("#googleButton");

document.addEventListener("DOMContentLoaded", async () => {
  $("#acceptTermsCheckbox").addEventListener("change", (event) => {
    $("#acceptTermsButton").disabled = !event.target.checked;
  });
  $("#acceptTermsButton").addEventListener("click", acceptTerms);
  $("#settingsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());
  scanButton.addEventListener("click", scanCanvas);
  googleButton.addEventListener("click", toggleGoogle);
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((button) => button.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.dataset.filter;
    render();
  }));

  const { termsAcceptance } = await chrome.storage.local.get("termsAcceptance");
  if (termsAcceptance?.version === TERMS_VERSION) await initializeApp();
  else showTerms();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !appInitialized) return;
    if (changes.canvasItems) items = changes.canvasItems.newValue || [];
    if (changes.canvasTaskStates) taskStates = changes.canvasTaskStates.newValue || {};
    if (changes.settings) await refreshGoogleStatus();
    if (changes.canvasItems || changes.canvasTaskStates || changes.settings) render();
  });
});

function showTerms() {
  $("#termsGate").hidden = false;
  $("#app").hidden = true;
}

async function acceptTerms() {
  if (!$("#acceptTermsCheckbox").checked) return;
  $("#acceptTermsButton").disabled = true;
  await chrome.storage.local.set({
    termsAcceptance: { version: TERMS_VERSION, acceptedAt: new Date().toISOString() }
  });
  await initializeApp();
}

async function initializeApp() {
  $("#termsGate").hidden = true;
  $("#app").hidden = false;
  appInitialized = true;
  await loadData();
  await refreshGoogleStatus();
}

async function loadData() {
  const stored = await chrome.storage.local.get(["canvasItems", "canvasTaskStates"]);
  items = stored.canvasItems || [];
  taskStates = stored.canvasTaskStates || {};
  render();
}

async function scanCanvas() {
  setStatus("Scanning your active Canvas courses…");
  scanButton.disabled = true;
  try {
    const { settings = {}, termsAcceptance } = await chrome.storage.local.get(["settings", "termsAcceptance"]);
    if (termsAcceptance?.version !== TERMS_VERSION) throw new Error("Accept the terms before scanning Canvas.");
    const canvasOrigin = normalizeOrigin(settings.canvasBaseUrl || "https://elearn.ucr.edu");
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url) throw new Error("Open your Canvas website first.");
    if (new URL(tab.url).origin !== canvasOrigin) throw new Error(`Open ${canvasOrigin}, sign in manually, then scan again.`);

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_CANVAS" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_CANVAS" });
    }
    if (!response?.ok) throw new Error(response?.error || "Canvas scan failed.");

    mergeItems(response.items || []);
    await chrome.storage.local.set({ canvasItems: items, lastCanvasScan: response.scannedAt });
    const skipped = response.skippedAnnouncementCount || 0;
    const announcementText = skipped ? ` ${skipped} unchanged announcements were skipped.` : "";
    setStatus(`Scanned ${response.courseCount} courses and found ${response.items.length} new or updated items.${announcementText}`, "success");
    render();
  } catch (error) {
    const message = /Cannot access|permission/i.test(error.message)
      ? "Canvas access is not enabled for this school. Open Settings and save the Canvas address again."
      : error.message;
    setStatus(message, "error");
  } finally {
    scanButton.disabled = false;
  }
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.origin;
  } catch {
    throw new Error("Set a valid HTTPS Canvas address in Settings first.");
  }
}

function mergeItems(incoming) {
  const existing = new Map(items.map((item) => [item.key, item]));
  for (const fresh of incoming) {
    const old = existing.get(fresh.key);
    existing.set(fresh.key, old ? {
      ...fresh,
      status: old.status,
      dueAt: old.userEditedDate ? old.dueAt : fresh.dueAt,
      userEditedDate: old.userEditedDate,
      calendarUrl: old.calendarUrl
    } : fresh);
  }
  items = [...existing.values()].sort(sortItems);
}

function sortItems(a, b) {
  if (!a.dueAt && !b.dueAt) return (b.discoveredAt || "").localeCompare(a.discoveredAt || "");
  if (!a.dueAt) return -1;
  if (!b.dueAt) return 1;
  return a.dueAt.localeCompare(b.dueAt);
}

function allTasks() {
  const unique = new Map();
  for (const item of items) {
    let tasks = Array.isArray(item.tasks) ? item.tasks : [];
    if (!tasks.length && /assignment/i.test(item.sourceType || "")) {
      tasks = [{
        key: `${item.key}:task`,
        title: item.title,
        details: item.details,
        dueAt: item.dueAt,
        courseCode: item.courseCode,
        courseName: item.courseName,
        sourceUrl: item.sourceUrl,
        kind: item.kindLabel || item.kind || "Assignment"
      }];
    }
    for (const task of tasks) {
      const key = task.key || `${item.key}:task:${task.title}`;
      const state = taskStates[key] || {};
      unique.set(key, {
        ...task,
        key,
        parentKey: item.key,
        courseCode: task.courseCode || item.courseCode,
        courseName: task.courseName || item.courseName,
        sourceUrl: task.sourceUrl || item.sourceUrl,
        kind: task.kind || item.kindLabel || item.kind || "Task",
        dueAt: state.userEditedDate ? state.dueAt : (task.dueAt || null),
        completed: Boolean(state.completed),
        calendarUrl: state.calendarUrl || null,
        userEditedDate: Boolean(state.userEditedDate)
      });
    }
  }
  return [...unique.values()].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return `${a.courseCode || a.courseName} ${a.title}`.localeCompare(`${b.courseCode || b.courseName} ${b.title}`);
  });
}

function render() {
  if (!appInitialized) return;
  list.replaceChildren();
  const tasks = allTasks();
  $("#todoCount").textContent = String(tasks.filter((task) => !task.completed).length);
  $("#pendingCount").textContent = String(items.filter((item) => item.status === "pending").length);
  $("#calendarCount").textContent = String(items.filter((item) => item.status === "calendar").length);

  if (activeFilter === "todo") {
    if (!tasks.length) return renderEmpty("No tasks yet. Sign in to Canvas and run a manual scan.");
    for (const task of tasks) list.append(renderTodoCard(task));
    return;
  }

  const visible = items.filter((item) => item.status === activeFilter);
  if (!visible.length) {
    renderEmpty(activeFilter === "pending" ? "Nothing needs review." : "No items in this section.");
    return;
  }
  for (const item of visible) list.append(renderCard(item));
}

function renderEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = message;
  list.append(empty);
}

function renderTodoCard(task) {
  const fragment = $("#todoTemplate").content.cloneNode(true);
  const card = fragment.querySelector(".todo-card");
  if (task.completed) card.classList.add("completed");

  const checkbox = card.querySelector(".todo-check");
  checkbox.checked = task.completed;
  checkbox.addEventListener("change", async () => {
    taskStates[task.key] = { ...(taskStates[task.key] || {}), completed: checkbox.checked };
    await persistTaskStates();
    render();
  });

  card.querySelector(".todo-title").textContent = task.title;
  card.querySelector(".course").textContent = task.courseCode || task.courseName || "Canvas";
  card.querySelector(".kind").textContent = task.kind || "Task";
  card.querySelector(".details").textContent = task.details || "No additional details were provided.";

  const source = card.querySelector(".source-link");
  if (task.sourceUrl) source.href = task.sourceUrl;
  else source.remove();

  const input = card.querySelector(".due-at");
  input.value = toLocalInput(task.dueAt);
  input.addEventListener("change", async () => {
    const dueAt = input.value ? new Date(input.value).toISOString() : null;
    taskStates[task.key] = { ...(taskStates[task.key] || {}), dueAt, userEditedDate: true };
    await persistTaskStates();
    render();
  });

  const addButton = card.querySelector(".add");
  addButton.textContent = !calendarEnabled ? "Calendar off" : task.calendarUrl ? "Update Calendar" : task.dueAt ? "Add to Calendar" : "Set date to add";
  addButton.disabled = !calendarEnabled || !task.dueAt;
  addButton.addEventListener("click", () => addTaskToCalendar(task, addButton));
  return card;
}

function renderCard(item) {
  const fragment = $("#itemTemplate").content.cloneNode(true);
  const card = fragment.querySelector(".item-card");
  card.querySelector(".course").textContent = item.courseCode || item.courseName;
  card.querySelector(".item-title").textContent = item.title;
  card.querySelector(".kind").textContent = item.kindLabel || item.kind || "Assessment";
  const confidence = card.querySelector(".confidence");
  confidence.textContent = item.confidence || "needs review";
  confidence.classList.add(item.confidence === "exact" ? "exact" : "review");
  card.querySelector(".details").textContent = item.details || "No additional details were provided.";
  const source = card.querySelector(".source-link");
  if (item.sourceUrl) source.href = item.sourceUrl;
  else source.remove();

  const input = card.querySelector(".due-at");
  input.value = toLocalInput(item.dueAt);
  input.addEventListener("change", async () => {
    item.dueAt = input.value ? new Date(input.value).toISOString() : null;
    item.userEditedDate = true;
    item.confidence = "confirmed by you";
    await persistItems();
    render();
  });

  const addButton = card.querySelector(".add");
  addButton.textContent = !calendarEnabled ? "Calendar off" : item.status === "calendar" ? "Update Calendar" : "Add to Calendar";
  addButton.disabled = !calendarEnabled;
  addButton.addEventListener("click", () => addItemToCalendar(item, addButton));
  card.querySelector(".dismiss").addEventListener("click", async () => {
    item.status = item.status === "dismissed" ? "pending" : "dismissed";
    await persistItems();
    render();
  });
  if (activeFilter === "dismissed") card.querySelector(".dismiss").textContent = "Restore";
  return card;
}

async function addTaskToCalendar(task, button) {
  const calendarItem = {
    key: task.key,
    title: task.title,
    calendarTitle: `${task.courseCode || task.courseName || "Canvas"}: ${task.title}`,
    courseCode: task.courseCode,
    courseName: task.courseName,
    kindLabel: task.kind,
    details: task.details,
    sourceType: task.sourceType,
    sourceUrl: task.sourceUrl,
    dueAt: task.dueAt
  };
  const response = await saveCalendarEvent(calendarItem, button);
  if (!response) return;
  taskStates[task.key] = { ...(taskStates[task.key] || {}), calendarUrl: response.event.htmlLink || task.calendarUrl };
  await persistTaskStates();
  render();
}

async function addItemToCalendar(item, button) {
  const response = await saveCalendarEvent(item, button);
  if (!response) return;
  item.status = "calendar";
  item.calendarUrl = response.event.htmlLink || item.calendarUrl;
  await persistItems();
  render();
}

async function saveCalendarEvent(item, button) {
  if (!item.dueAt) {
    setStatus("Confirm a date and time for this item first.", "error");
    return null;
  }
  if (!calendarEnabled) {
    setStatus("Enable Google Calendar in Settings first.", "error");
    return null;
  }
  if (!googleConnected) {
    setStatus("Connect Google Calendar first.", "error");
    return null;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  const response = await chrome.runtime.sendMessage({ type: "UPSERT_CALENDAR_EVENT", item });
  button.disabled = false;
  if (!response?.ok) {
    setStatus(response?.error || "Could not add the calendar event.", "error");
    button.textContent = "Add to Calendar";
    return null;
  }
  setStatus(response.event.updated ? "Calendar event updated." : "Calendar event created with reminders.", "success");
  return response;
}

async function toggleGoogle() {
  if (!calendarEnabled) {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (googleConnected) {
    const response = await chrome.runtime.sendMessage({ type: "GOOGLE_DISCONNECT" });
    if (!response?.ok) setStatus(response?.error || "Could not disconnect Google.", "error");
  } else {
    const response = await chrome.runtime.sendMessage({ type: "GOOGLE_CONNECT" });
    if (!response?.ok) {
      setStatus(response?.error || "Could not connect Google Calendar.", "error");
      if (/Client ID/i.test(response?.error || "")) chrome.runtime.openOptionsPage();
    }
  }
  await refreshGoogleStatus();
}

async function refreshGoogleStatus() {
  const response = await chrome.runtime.sendMessage({ type: "GOOGLE_STATUS" });
  calendarEnabled = Boolean(response?.enabled);
  googleConnected = Boolean(response?.connected);
  if (!calendarEnabled) {
    $("#googleStatus").textContent = "Off — enable in Settings";
    googleButton.textContent = "Settings";
  } else {
    $("#googleStatus").textContent = googleConnected ? "Connected locally" : response?.configured ? "Ready to connect" : "Client ID required";
    googleButton.textContent = googleConnected ? "Disconnect" : "Connect";
  }
}

async function persistItems() { await chrome.storage.local.set({ canvasItems: items }); }
async function persistTaskStates() { await chrome.storage.local.set({ canvasTaskStates: taskStates }); }

function setStatus(message, type = "") {
  scanStatus.className = `status ${type}`.trim();
  scanStatus.textContent = message;
}

function toLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
