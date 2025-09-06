// === WebTime background: tracks usage per domain + handles limits ===

// Storage keys
const USAGE_TODAY_KEY = "usageToday";
const USAGE_DATE_KEY  = "usageDate";
const LIMITS_KEY      = "limits";
const NOTIFIED_KEY    = "notifiedToday";
const STATE_KEY       = "state";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function cleanHost(url) {
  try {
    const h = new URL(url).hostname;
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

// Ensure reset if day changed
async function ensureToday() {
  const { [USAGE_DATE_KEY]: storedDate } = await chrome.storage.local.get(USAGE_DATE_KEY);
  const t = todayStr();
  if (storedDate !== t) {
    await chrome.storage.local.set({
      [USAGE_DATE_KEY]: t,
      [USAGE_TODAY_KEY]: {},
      [NOTIFIED_KEY]: {}
    });
  }
}

// Finalize tracked time
async function finalizeTrackedTime() {
  await ensureToday();
  const data = await chrome.storage.local.get([STATE_KEY, USAGE_TODAY_KEY, LIMITS_KEY, NOTIFIED_KEY]);
  const state = data[STATE_KEY] || { active: false, domain: null, lastStart: null };
  if (!state.active || !state.domain || !state.lastStart) return;

  const now = Date.now();
  let deltaSec = Math.floor((now - state.lastStart) / 1000);
  if (deltaSec <= 0) {
    state.lastStart = now;
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return;
  }

  const usageToday = data[USAGE_TODAY_KEY] || {};
  usageToday[state.domain] = (usageToday[state.domain] || 0) + deltaSec;

  // Check limits
  const limits = data[LIMITS_KEY] || {};
  const notified = data[NOTIFIED_KEY] || {};
  const limitMin = limits[state.domain];
  if (limitMin && !notified[state.domain]) {
    const limitSec = limitMin * 60;
    if (usageToday[state.domain] >= limitSec) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wIAAgMBAp0pHgAAAABJRU5ErkJggg==", // fallback transparent PNG
        title: "WebTime Alert",
        message: `${state.domain} exceeded its limit of ${limitMin} minutes`
      });

      notified[state.domain] = true;
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#d32f2f" });
    }
  }

  state.lastStart = now;

  await chrome.storage.local.set({
    [USAGE_TODAY_KEY]: usageToday,
    [NOTIFIED_KEY]: notified,
    [STATE_KEY]: state
  });
}

// Activate domain
async function activateDomain(domain) {
  await finalizeTrackedTime();
  const state = { active: !!domain, domain: domain || null, lastStart: domain ? Date.now() : null };
  await chrome.storage.local.set({ [STATE_KEY]: state });
  if (!domain) chrome.action.setBadgeText({ text: "" });
}

async function getActiveDomain() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url) return null;
  return cleanHost(tab.url);
}

// Events
chrome.runtime.onInstalled.addListener(async () => {
  await ensureToday();
  chrome.alarms.create("webtime_tick", { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureToday();
  chrome.alarms.create("webtime_tick", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "webtime_tick") await finalizeTrackedTime();
});

chrome.tabs.onActivated.addListener(async () => {
  await ensureToday();
  const domain = await getActiveDomain();
  await activateDomain(domain);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === "complete") {
    const domain = cleanHost(tab.url || "");
    await activateDomain(domain);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await activateDomain(null);
  } else {
    const domain = await getActiveDomain();
    await activateDomain(domain);
  }
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === "active") {
    const domain = await getActiveDomain();
    await activateDomain(domain);
  } else {
    await activateDomain(null);
  }
});

// Handle messages
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "setLimit") {
      const { domain, minutes } = msg;
      const { [LIMITS_KEY]: limitsRaw } = await chrome.storage.local.get(LIMITS_KEY);
      const limits = limitsRaw || {};
      if (minutes && minutes > 0) limits[domain] = minutes;
      else delete limits[domain];
      await chrome.storage.local.set({ [LIMITS_KEY]: limits });
      sendResponse({ ok: true });
    } else if (msg.type === "getData") {
      await finalizeTrackedTime();
      await ensureToday();
      const d = await chrome.storage.local.get([USAGE_TODAY_KEY, USAGE_DATE_KEY, LIMITS_KEY]);
      sendResponse({
        usageToday: d[USAGE_TODAY_KEY] || {},
        usageDate: d[USAGE_DATE_KEY] || todayStr(),
        limits: d[LIMITS_KEY] || {}
      });
    } else if (msg.type === "clearToday") {
      await chrome.storage.local.set({
        [USAGE_TODAY_KEY]: {},
        [NOTIFIED_KEY]: {},
        [USAGE_DATE_KEY]: todayStr()
      });
      sendResponse({ ok: true });
    }
  })();
  return true;
});
