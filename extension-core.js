export const DEFAULT_LIMIT = 50;
export const SETTINGS_KEY = "analyticsLimit";
export const NOTICE_KEY = "setupNotice";
export const ERROR_KEY = "setupError";
export const ANALYTICS_RULE_ID = 1;

const ANALYTICS_URL_FILTER = "https://api.nextdns.io/profiles/*/analytics/*";

/** Parse a numeric input or saved value without coercing invalid values. */
export function validateLimit(value) {
  let parsed;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    return { valid: false, message: "Enter a positive whole number." };
  }

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { valid: false, message: "Enter a positive whole number." };
  }

  return { valid: true, value: parsed };
}

/** Build the one dynamic DNR rule owned by this extension. */
export function createAnalyticsRule(limit) {
  const result = validateLimit(limit);
  if (!result.valid) {
    throw new TypeError(result.message);
  }

  return {
    id: ANALYTICS_RULE_ID,
    priority: 1,
    condition: {
      urlFilter: ANALYTICS_URL_FILTER,
      initiatorDomains: ["my.nextdns.io"],
      resourceTypes: ["main_frame", "xmlhttprequest"]
    },
    action: {
      type: "redirect",
      redirect: {
        transform: {
          queryTransform: {
            addOrReplaceParams: [
              { key: "limit", value: String(result.value) }
            ]
          }
        }
      }
    }
  };
}

/**
 * Create a small settings controller around the browser APIs. Keeping the
 * storage and DNR dependencies injectable makes persistence and rule updates
 * testable without a browser.
 */
export function createSettingsController({ storage, dnr }) {
  let operationQueue = Promise.resolve();

  function enqueue(operation) {
    const result = operationQueue.then(operation);
    operationQueue = result.catch(() => undefined);
    return result;
  }

  async function replaceRule(limit) {
    await dnr.updateDynamicRules({
      removeRuleIds: [ANALYTICS_RULE_ID],
      addRules: [createAnalyticsRule(limit)]
    });
  }

  return {
    getState() {
      return enqueue(async () => {
        const saved = await storage.get([SETTINGS_KEY, NOTICE_KEY, ERROR_KEY]);
        const parsed = validateLimit(saved[SETTINGS_KEY]);
        return {
          ok: true,
          limit: parsed.valid ? parsed.value : DEFAULT_LIMIT,
          notice: saved[NOTICE_KEY] || "",
          error: saved[ERROR_KEY] || ""
        };
      });
    },

    applyLimit(value) {
      return enqueue(async () => {
        const parsed = validateLimit(value);
        if (!parsed.valid) {
          throw new TypeError(parsed.message);
        }

        const previous = await storage.get([SETTINGS_KEY]);
        try {
          await storage.set({
            [SETTINGS_KEY]: parsed.value,
            [NOTICE_KEY]: "",
            [ERROR_KEY]: ""
          });
        } catch {
          throw new Error("Could not save this setting. Please try again.");
        }

        try {
          await replaceRule(parsed.value);
        } catch {
          try {
            if (Object.hasOwn(previous, SETTINGS_KEY)) {
              await storage.set({
                [SETTINGS_KEY]: previous[SETTINGS_KEY],
                [ERROR_KEY]: "The request rule could not be updated. Retry applying your setting."
              });
            } else {
              await storage.remove(SETTINGS_KEY);
              await storage.set({
                [ERROR_KEY]: "The request rule could not be updated. Retry applying your setting."
              });
            }
          } catch {
            // The popup still reports the failed rule update. A later startup
            // will reconcile the rule with whichever setting was persisted.
          }
          throw new Error("Could not update the request rule. Your previous rule remains active; please retry.");
        }

        return { ok: true, limit: parsed.value };
      });
    },

    restore() {
      return enqueue(async () => {
        let saved;
        try {
          saved = await storage.get([SETTINGS_KEY]);
        } catch {
          throw new Error("Could not read the saved analytics limit.");
        }

        const hadSavedValue = Object.hasOwn(saved, SETTINGS_KEY);
        const parsed = validateLimit(saved[SETTINGS_KEY]);
        const limit = parsed.valid ? parsed.value : DEFAULT_LIMIT;

        try {
          await replaceRule(limit);
        } catch {
          const message = "Could not restore the analytics request rule. Open the popup and retry applying your setting.";
          try {
            await storage.set({ [ERROR_KEY]: message });
          } catch {
            // Keep the original DNR failure as the useful error.
          }
          throw new Error(message);
        }

        const notice = !hadSavedValue
          ? ""
          : parsed.valid
            ? ""
            : "The saved value was invalid, so the limit was reset to 50.";

        try {
          await storage.set({
            [SETTINGS_KEY]: limit,
            [NOTICE_KEY]: notice,
            [ERROR_KEY]: ""
          });
        } catch {
          throw new Error("The network rule is ready, but the setting could not be saved.");
        }

        return { ok: true, limit, notice };
      });
    }
  };
}
