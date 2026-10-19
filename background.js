import { createSettingsController } from "./extension-core.js";

const settings = createSettingsController({
  storage: chrome.storage.local,
  dnr: chrome.declarativeNetRequest
});

async function restoreSettings() {
  try {
    await settings.restore();
  } catch {
    // The popup reads the stored setupError and gives the user a retry path.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void restoreSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void restoreSettings();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_STATE") {
    settings.getState()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "Could not read the saved setting." }));
    return true;
  }

  if (message?.type === "APPLY_LIMIT") {
    settings.applyLimit(message.limit)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
