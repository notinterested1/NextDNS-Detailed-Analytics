import { DEFAULT_LIMIT, validateLimit } from "./extension-core.js";

const input = document.querySelector("#limit-input");
const form = document.querySelector("#limit-form");
const message = document.querySelector("#form-message");
const saveButton = form.querySelector("button[type='submit']");

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

    input.value = String(state.limit ?? DEFAULT_LIMIT);
    if (state.error) {
      showMessage(state.error, "error");
    } else if (state.notice) {
      showMessage(state.notice, "notice");
    }
  } catch {
    input.value = String(DEFAULT_LIMIT);
    showMessage("Could not load the saved setting. Close and reopen this popup.", "error");
  }
}

input.addEventListener("input", () => {
  input.removeAttribute("aria-invalid");
  showMessage("");
});

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
  input.disabled = true;
  saveButton.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "APPLY_LIMIT",
      limit: parsed.value
    });
    if (!result?.ok) {
      throw new Error(result?.error || "Could not apply this limit.");
    }

    input.value = String(result.limit);
    showMessage("Saved. Refresh the dashboard to load analytics.");
  } catch (error) {
    showMessage(error.message || "Could not apply this limit. Please try again.", "error");
  } finally {
    input.disabled = false;
    saveButton.disabled = false;
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
