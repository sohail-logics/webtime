function fmt(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
}

function niceDate() {
  return new Date().toLocaleDateString([], { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

// Load data from background
async function loadData() {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "getData" }, (res) => {
      if (chrome.runtime.lastError || !res) resolve({ usageToday: {}, limits: {} });
      else resolve(res);
    });
  });
}

// Global state for live updates
let liveUsage = {};
let liveLimits = {};

function render() {
  const entries = Object.entries(liveUsage || {});
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, sec]) => sum + sec, 0);

  document.getElementById("totalTime").textContent = fmt(total);

  const sitesEl = document.getElementById("sites");
  sitesEl.innerHTML = "";

  const maxSec = entries.length ? entries[0][1] : 1;

  for (const [domain, seconds] of entries) {
    const limitMin = liveLimits[domain];
    const row = document.createElement("div");
    row.className = "site";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = domain;

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(5, (seconds / maxSec) * 100)}%`;
    bar.appendChild(fill);

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = fmt(seconds);

    const limit = document.createElement("div");
    limit.className = "limit";
    limit.textContent = limitMin ? `${limitMin}m` : "";

    const setBtn = document.createElement("button");
    setBtn.textContent = "Set";
    setBtn.addEventListener("click", () => {
      document.getElementById("domainInput").value = domain;
      document.getElementById("minutesInput").focus();
    });

    row.appendChild(name);
    row.appendChild(bar);
    row.appendChild(time);
    row.appendChild(limit);
    row.appendChild(setBtn);

    sitesEl.appendChild(row);
  }
}

async function saveLimit(domain, minutes) {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "setLimit", domain, minutes }, (res) => resolve(res || { ok: true }));
  });
}

async function clearToday() {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "clearToday" }, (res) => resolve(res || { ok: true }));
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("dateText").textContent = niceDate();

  const data = await loadData();
  liveUsage = data.usageToday || {};
  liveLimits = data.limits || {};
  render();

  // Live ticking every second
  setInterval(() => {
    for (const domain in liveUsage) {
      liveUsage[domain] += 1; // add one second per tick
    }
    render();
  }, 1000);

  document.getElementById("saveLimit").addEventListener("click", async () => {
    const domain = document.getElementById("domainInput").value.trim().toLowerCase();
    const minutes = parseInt(document.getElementById("minutesInput").value, 10);

    if (!domain) {
      alert("Please enter a domain, e.g. youtube.com");
      return;
    }

    if (!minutes || minutes <= 0) await saveLimit(domain, 0);
    else await saveLimit(domain, minutes);

    const newData = await loadData();
    liveUsage = newData.usageToday || {};
    liveLimits = newData.limits || {};
    render();

    document.getElementById("domainInput").value = "";
    document.getElementById("minutesInput").value = "";
  });

  document.getElementById("clearBtn").addEventListener("click", async () => {
    await clearToday();
    const newData = await loadData();
    liveUsage = newData.usageToday || {};
    liveLimits = newData.limits || {};
    render();
  });
});
