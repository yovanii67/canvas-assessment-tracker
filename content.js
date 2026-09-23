const ASSESSMENT_WORDS = /\b(exam|midterm|final|quiz|test|homework|assignment|project|paper|report|problem set|lab|due|deadline)\b/i;
const TASK_ACTION_WORDS = /\b(read|review|complete|submit|upload|watch|bring|fill out|study|prepare|finish|take|access|reference|check|respond|write|create|practice)\b/i;
const TASK_EXTRACTION_VERSION = 1;
const TERMS_VERSION = 1;
const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
};
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "SCAN_CANVAS") return false;
  scanCanvas()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function scanCanvas() {
  const { settings = {}, termsAcceptance } = await chrome.storage.local.get(["settings", "termsAcceptance"]);
  if (termsAcceptance?.version !== TERMS_VERSION) throw new Error("Accept the current terms before scanning Canvas.");
  const configuredOrigin = normalizeOrigin(settings.canvasBaseUrl || "https://elearn.ucr.edu");
  if (location.origin !== configuredOrigin) throw new Error(`Open your configured Canvas site (${configuredOrigin}) before scanning.`);
  if (/\/(login|logout)(\/|$)/.test(location.pathname)) throw new Error("Sign in to Canvas, then open a course or dashboard page before scanning.");
  const courses = await canvasPaginated("/api/v1/courses?enrollment_state=active&include[]=term&per_page=100");
  const activeCourses = courses.filter((course) => !course.access_restricted_by_date);
  const { seenAnnouncements = {} } = await chrome.storage.local.get("seenAnnouncements");
  const batches = await Promise.all(activeCourses.map((course) => scanCourse(course, settings, seenAnnouncements)));
  const items = batches.flatMap((batch) => batch.items).sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return b.discoveredAt.localeCompare(a.discoveredAt);
    if (!a.dueAt) return -1;
    if (!b.dueAt) return 1;
    return a.dueAt.localeCompare(b.dueAt);
  });
  const nextSeen = { ...seenAnnouncements };
  for (const batch of batches) Object.assign(nextSeen, batch.seenAnnouncements);
  const cutoff = Date.now() - 180 * 86400_000;
  for (const [key, value] of Object.entries(nextSeen)) {
    if (new Date(value.lastSeenAt || 0).getTime() < cutoff) delete nextSeen[key];
  }
  await chrome.storage.local.set({ seenAnnouncements: nextSeen });
  return {
    items,
    courseCount: activeCourses.length,
    scannedAt: new Date().toISOString(),
    announcementCount: batches.reduce((sum, batch) => sum + batch.announcementCount, 0),
    skippedAnnouncementCount: batches.reduce((sum, batch) => sum + batch.skippedAnnouncementCount, 0)
  };
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.origin;
  } catch {
    throw new Error("The configured Canvas address must be a valid HTTPS website.");
  }
}

async function scanCourse(course, settings, seenAnnouncements) {
  const courseCode = course.course_code || course.name || `Course ${course.id}`;
  const courseName = course.name || courseCode;
  const now = new Date();
  const lookbackDays = Math.min(30, Math.max(1, Number(settings.announcementLookbackDays || 7)));
  const announcementStart = new Date(now.getTime() - lookbackDays * 86400_000).toISOString();
  const eventStart = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const end = new Date(now.getTime() + 366 * 86400_000).toISOString();
  const [assignments, announcements, events] = await Promise.all([
    safePaginated(`/api/v1/courses/${course.id}/assignments?bucket=unsubmitted&order_by=due_at&include[]=submission&per_page=100`),
    safePaginated(`/api/v1/announcements?context_codes[]=course_${course.id}&start_date=${encodeURIComponent(announcementStart)}&end_date=${encodeURIComponent(end)}&per_page=100`),
    safePaginated(`/api/v1/calendar_events?type=event&context_codes[]=course_${course.id}&start_date=${encodeURIComponent(eventStart)}&end_date=${encodeURIComponent(end)}&per_page=100`)
  ]);

  const assignmentItems = assignments.map((item) => normalizeAssignment(item, courseCode, courseName));
  const newSeenAnnouncements = {};
  let skippedAnnouncementCount = 0;
  const freshAnnouncements = announcements.filter((item) => {
    const seenKey = `course:${course.id}:announcement:${item.id}`;
    const fingerprint = item.updated_at || item.posted_at || item.created_at || "unknown";
    newSeenAnnouncements[seenKey] = { fingerprint, lastSeenAt: new Date().toISOString(), taskExtractionVersion: TASK_EXTRACTION_VERSION };
    if (seenAnnouncements[seenKey]?.fingerprint === fingerprint && seenAnnouncements[seenKey]?.taskExtractionVersion === TASK_EXTRACTION_VERSION) {
      skippedAnnouncementCount += 1;
      return false;
    }
    return true;
  });
  const announcementItems = freshAnnouncements
    .map((item) => normalizeAnnouncement(item, course.id, courseCode, courseName, settings.includeAllAnnouncements))
    .filter(Boolean);
  const eventItems = events
    .map((item) => normalizeEvent(item, courseCode, courseName))
    .filter(Boolean);
  return {
    items: dedupeByKey([...assignmentItems, ...announcementItems, ...eventItems]),
    seenAnnouncements: newSeenAnnouncements,
    announcementCount: freshAnnouncements.length,
    skippedAnnouncementCount
  };
}

function normalizeAssignment(item, courseCode, courseName) {
  const key = `assignment:${item.course_id || courseCode}:${item.id}`;
  const details = clip(stripHtml(item.description || ""), 650);
  return {
    key,
    sourceId: String(item.id),
    sourceType: "Canvas assignment",
    kind: inferKind(`${item.name} ${stripHtml(item.description || "")}`),
    kindLabel: titleCase(inferKind(item.name)),
    title: item.name,
    courseCode,
    courseName,
    dueAt: item.due_at,
    endAt: null,
    details,
    sourceUrl: item.html_url || "",
    confidence: "exact",
    status: "pending",
    tasks: [{
      key: `todo:${key}`,
      title: item.name,
      dueAt: item.due_at,
      details,
      sourceType: "Canvas assignment",
      sourceUrl: item.html_url || "",
      courseCode,
      courseName,
      kind: inferKind(`${item.name} ${details}`),
      kindLabel: titleCase(inferKind(item.name))
    }],
    discoveredAt: new Date().toISOString()
  };
}

function normalizeAnnouncement(item, courseId, courseCode, courseName, includeAll) {
  const body = stripHtml(item.message || "");
  const combined = `${item.title || ""}. ${body}`;
  const date = inferDate(combined, item.posted_at || item.created_at || new Date().toISOString());
  const key = `announcement:${courseId}:${item.id}`;
  const tasks = extractAnnouncementTasks(item.message || "", item.posted_at || item.created_at || new Date().toISOString(), {
    parentKey: key,
    sourceUrl: item.html_url || "",
    courseCode,
    courseName
  });
  if (!includeAll && !ASSESSMENT_WORDS.test(combined) && !tasks.length) return null;
  return {
    key,
    sourceId: String(item.id),
    sourceType: "Canvas announcement",
    kind: inferKind(combined),
    kindLabel: titleCase(inferKind(combined)),
    title: item.title || "Course announcement",
    courseCode,
    courseName,
    dueAt: date?.iso || null,
    endAt: null,
    details: clip(body, 900),
    sourceUrl: item.html_url || "",
    confidence: date?.confidence || "needs review",
    status: "pending",
    tasks,
    discoveredAt: item.posted_at || item.created_at || new Date().toISOString()
  };
}

function normalizeEvent(item, courseCode, courseName) {
  const combined = `${item.title || ""}. ${stripHtml(item.description || "")}`;
  if (!ASSESSMENT_WORDS.test(combined)) return null;
  return {
    key: `event:${courseCode}:${item.id}`,
    sourceId: String(item.id),
    sourceType: "Canvas event",
    kind: inferKind(combined),
    kindLabel: titleCase(inferKind(combined)),
    title: item.title || "Canvas event",
    courseCode,
    courseName,
    dueAt: item.start_at || null,
    endAt: item.end_at || null,
    location: item.location_name || item.location_address || "",
    details: clip(stripHtml(item.description || ""), 700),
    sourceUrl: item.html_url || "",
    confidence: item.start_at ? "exact" : "needs review",
    status: "pending",
    discoveredAt: item.created_at || new Date().toISOString()
  };
}

function extractAnnouncementTasks(html, referenceIso, metadata) {
  const lines = structuredTextLines(html);
  const candidates = [];
  for (const line of lines) {
    const numbered = line.match(/^\s*(?:\d+|[a-z])\s*[\).:-]\s*(.+)$/i);
    const bulleted = line.match(/^\s*[-•▪◦]\s*(.+)$/);
    const taskText = (numbered?.[1] || bulleted?.[1] || line).trim();
    if (!taskText || taskText.length < 4 || taskText.length > 650) continue;
    if (/^(before|after) (your|the) (first|next) (class|lab)\s*:?$/i.test(taskText)) continue;
    const explicitListItem = Boolean(numbered || bulleted);
    const actionableSentence = TASK_ACTION_WORDS.test(taskText);
    if (!explicitListItem && !actionableSentence) continue;
    if (/\b(look forward|welcome to|reach out with any questions)\b/i.test(taskText) && !explicitListItem) continue;
    candidates.push(taskText.replace(/^please\s+/i, "").trim());
  }

  const unique = [...new Set(candidates.map((text) => text.replace(/\s+/g, " ").trim()))];
  return unique.map((title) => {
    const date = inferDate(title, referenceIso);
    const key = `${metadata.parentKey}:task:${stableHash(title.toLowerCase())}`;
    return {
      key,
      title,
      dueAt: date?.iso || null,
      details: `From announcement: ${title}`,
      sourceType: "Canvas announcement",
      sourceUrl: metadata.sourceUrl,
      courseCode: metadata.courseCode,
      courseName: metadata.courseName,
      kind: inferKind(title),
      kindLabel: titleCase(inferKind(title)),
      confidence: date?.confidence || "no deadline detected"
    };
  });
}

function structuredTextLines(html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const elements = [...doc.body.querySelectorAll("li, p")];
  let lines = elements.flatMap((element) => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    return (clone.textContent || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  });
  if (!lines.length) {
    lines = (doc.body.textContent || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  return lines;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function inferKind(text = "") {
  const lower = text.toLowerCase();
  if (/\b(final|midterm|exam|test)\b/.test(lower)) return "exam";
  if (/\bquiz\b/.test(lower)) return "quiz";
  if (/\b(homework|problem set)\b/.test(lower)) return "homework";
  if (/\blab\b/.test(lower)) return "lab";
  if (/\b(project|paper|report)\b/.test(lower)) return "project";
  return "assignment";
}

function inferDate(text, referenceIso) {
  const reference = new Date(referenceIso);
  const normalized = text.replace(/\s+/g, " ");
  let date = null;
  let confidence = "inferred";
  let match = normalized.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan\.?|feb\.?|mar\.?|apr\.?|jun\.?|jul\.?|aug\.?|sep\.?|sept\.?|oct\.?|nov\.?|dec\.?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?/i);
  if (match) {
    const month = MONTHS[match[1].toLowerCase().replace(".", "")];
    let year = match[3] ? Number(match[3]) : reference.getFullYear();
    date = new Date(year, month, Number(match[2]), 23, 59, 0, 0);
    if (!match[3] && date.getTime() < reference.getTime() - 90 * 86400_000) date.setFullYear(year + 1);
  }
  if (!date) {
    match = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
    if (match) {
      let year = match[3] ? Number(match[3]) : reference.getFullYear();
      if (year < 100) year += 2000;
      date = new Date(year, Number(match[1]) - 1, Number(match[2]), 23, 59, 0, 0);
    }
  }
  if (!date) {
    match = normalized.match(/\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if (match) {
      const target = WEEKDAYS[match[2].toLowerCase()];
      let delta = (target - reference.getDay() + 7) % 7;
      if (match[1]?.toLowerCase() === "next") delta = delta === 0 ? 7 : delta + (delta < 3 ? 7 : 0);
      if (delta === 0 && !/\b(today|this)\b/i.test(match[0])) delta = 7;
      date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + delta, 23, 59, 0, 0);
      confidence = "needs review";
    }
  }
  if (!date && /\btomorrow\b/i.test(normalized)) {
    date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1, 23, 59, 0, 0);
    confidence = "needs review";
  }
  if (!date && /\btonight\b/i.test(normalized)) {
    date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 23, 59, 0, 0);
    confidence = "needs review";
  }
  if (!date) return null;

  const time = normalized.match(/\b(?:at|by)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (time) {
    let hour = Number(time[1]);
    const minute = Number(time[2] || 0);
    const pm = time[3].toLowerCase().startsWith("p");
    if (hour === 12) hour = 0;
    if (pm) hour += 12;
    date.setHours(hour, minute, 0, 0);
  } else if (/\bnoon\b/i.test(normalized)) {
    date.setHours(12, 0, 0, 0);
  } else if (/\bmidnight\b/i.test(normalized)) {
    date.setHours(23, 59, 0, 0);
  } else {
    confidence = "needs review";
  }
  return { iso: date.toISOString(), confidence };
}

async function safePaginated(path) {
  try { return await canvasPaginated(path); } catch (error) { console.warn("Canvas scan skipped endpoint", path, error); return []; }
}

async function canvasPaginated(path) {
  let url = new URL(path, location.origin).toString();
  const results = [];
  for (let page = 0; url && page < 10; page += 1) {
    const response = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (response.status === 401) throw new Error("Your Canvas session has expired. Log in again and retry.");
    if (!response.ok) throw new Error(`Canvas returned ${response.status} for ${new URL(url).pathname}.`);
    const payload = await response.json();
    if (Array.isArray(payload)) results.push(...payload);
    else results.push(payload);
    url = nextLink(response.headers.get("Link"));
  }
  return results;
}

function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === "next") return match[1];
  }
  return null;
}

function stripHtml(html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function clip(text, limit) { return text.length > limit ? `${text.slice(0, limit - 1)}…` : text; }
function titleCase(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function dedupeByKey(items) { return [...new Map(items.map((item) => [item.key, item])).values()]; }
