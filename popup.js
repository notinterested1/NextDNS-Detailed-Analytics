import { DEFAULT_LIMIT, validateLimit } from "./extension-core.js";

const input = document.querySelector("#limit-input");
const currentLimit = document.querySelector("#current-limit");
const form = document.querySelector("#limit-form");
const message = document.querySelector("#form-message");
const applyButton = form.querySelector("button[type='submit']");

function showMessage(text, kind = "") {
  message.textContent = text;
  message.className = `message${kind ? ` ${kind}` : ""}`;
}

async function loadState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!state?.ok) {
      throw new Error(state?.error || "Could not read the saved setting.");
    }

    currentLimit.textContent = String(state.limit ?? DEFAULT_LIMIT);
    input.value = String(state.limit ?? DEFAULT_LIMIT);
    if (state.error) {
      showMessage(state.error, "error");
    } else if (state.notice) {
      showMessage(state.notice, "notice");
    }
  } catch {
    currentLimit.textContent = String(DEFAULT_LIMIT);
    input.value = String(DEFAULT_LIMIT);
    showMessage("Could not load the saved setting. Close and reopen this popup.", "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const parsed = validateLimit(input.value);
  if (!parsed.valid) {
    input.setAttribute("aria-invalid", "true");
    showMessage(parsed.message, "error");
    input.focus();
    return;
  }

  input.removeAttribute("aria-invalid");
  applyButton.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "APPLY_LIMIT",
      limit: parsed.value
    });
    if (!result?.ok) {
      throw new Error(result?.error || "Could not apply this limit.");
    }

    currentLimit.textContent = String(result.limit);
    input.value = String(result.limit);
    showMessage(`Limit set to ${result.limit}. Refresh the NextDNS dashboard to reload analytics.`);
  } catch (error) {
    showMessage(error.message || "Could not apply this limit. Please try again.", "error");
  } finally {
    applyButton.disabled = false;
  }
});

document.querySelector("#open-nextdns").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: "https://my.nextdns.io/" });
  } catch {
    showMessage("Could not open NextDNS. Please open https://my.nextdns.io/ in your browser.", "error");
  }
});

void loadState();
