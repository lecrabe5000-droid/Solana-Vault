// Ecrin Wallet background: locks the wallet after the chosen idle time by wiping the unlocked phrase from memory
// (chrome.storage.session lives only in memory and is cleared when the browser closes).
const lock = () => chrome.storage.session.clear();

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "autolock" && m.until) chrome.alarms.create("lock", { when: m.until });
  if (m?.type === "lock") { chrome.alarms.clear("lock"); lock(); }
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "lock") return;
  const { until } = await chrome.storage.session.get("until");
  if (!until || until <= Date.now() + 1000) lock(); else chrome.alarms.create("lock", { when: until });
});
// Only the wallet's own pages may read the unlocked phrase, never a web page or content script.
chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.runtime.onStartup.addListener(lock);

// "Always" auto-lock: the popup keeps a connection open; when it closes, lock at once.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;
  port.onDisconnect.addListener(async () => { const { autolock } = await chrome.storage.local.get("autolock"); if (autolock === 0) { chrome.alarms.clear("lock"); lock(); } });
});
