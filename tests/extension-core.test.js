import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_RULE_ID,
  DEFAULT_LIMIT,
  ERROR_KEY,
  NOTICE_KEY,
  SETTINGS_KEY,
  createAnalyticsRule,
  createSettingsController,
  validateLimit
} from "../extension-core.js";

function makeFakes({ initial = {}, failRuleUpdate = false } = {}) {
  const data = { ...initial };
  const rules = new Map();
  const updates = [];
  const storage = {
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(key) {
      delete data[key];
    }
  };
  const dnr = {
    async updateDynamicRules({ removeRuleIds, addRules }) {
      updates.push({ removeRuleIds, addRules });
      if (failRuleUpdate) {
        throw new Error("simulated DNR failure");
      }
      for (const id of removeRuleIds) rules.delete(id);
      for (const rule of addRules) rules.set(rule.id, rule);
    }
  };

  return { controller: createSettingsController({ storage, dnr }), data, rules, updates };
}

test("validates positive safe whole numbers and rejects malformed values", () => {
  for (const limit of [25, 50, 100, 200, "25", " 50 "]) {
    assert.deepEqual(validateLimit(limit), { valid: true, value: Number(limit) });
  }
  for (const value of [0, -1, 1.5, "", "1.5", "1e2", "nope", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateLimit(value).valid, false, `expected ${String(value)} to be rejected`);
  }
});

test("builds a narrowly scoped rule that replaces limit and preserves other query parameters", () => {
  const rule = createAnalyticsRule(200);
  assert.equal(rule.id, ANALYTICS_RULE_ID);
  assert.equal(rule.condition.urlFilter, "https://api.nextdns.io/profiles/*/analytics/*");
  assert.deepEqual(rule.condition.initiatorDomains, ["my.nextdns.io"]);
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame", "xmlhttprequest"]);
  assert.deepEqual(rule.action.redirect.transform.queryTransform.addOrReplaceParams, [
    { key: "limit", value: "200" }
  ]);

  // Exercise the URL transformation represented by the DNR queryTransform.
  const requestUrl = new URL("https://api.nextdns.io/profiles/abc/analytics/domains?from=1&limit=10&to=2");
  requestUrl.searchParams.set("limit", "200");
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://api.nextdns.io/profiles/abc/analytics/domains");
  assert.deepEqual([...requestUrl.searchParams.entries()], [
    ["from", "1"], ["limit", "200"], ["to", "2"]
  ]);
});

test("persists an applied value and replaces the stable dynamic rule", async () => {
  const { controller, data, rules, updates } = makeFakes({ initial: { [SETTINGS_KEY]: 50 } });
  const result = await controller.applyLimit("200");

  assert.deepEqual(result, { ok: true, limit: 200 });
  assert.equal(data[SETTINGS_KEY], 200);
  assert.equal(data[NOTICE_KEY], "");
  assert.equal(data[ERROR_KEY], "");
  assert.equal(rules.size, 1);
  assert.equal(rules.get(ANALYTICS_RULE_ID).action.redirect.transform.queryTransform.addOrReplaceParams[0].value, "200");
  assert.deepEqual(updates[0].removeRuleIds, [ANALYTICS_RULE_ID]);
});

test("restores a saved setting and initializes new installations to 50", async () => {
  const saved = makeFakes({ initial: { [SETTINGS_KEY]: 100 } });
  assert.deepEqual(await saved.controller.restore(), { ok: true, limit: 100, notice: "" });
  assert.equal(saved.rules.get(ANALYTICS_RULE_ID).action.redirect.transform.queryTransform.addOrReplaceParams[0].value, "100");

  const fresh = makeFakes();
  assert.deepEqual(await fresh.controller.restore(), { ok: true, limit: DEFAULT_LIMIT, notice: "" });
  assert.equal(fresh.data[SETTINGS_KEY], DEFAULT_LIMIT);
  assert.equal(fresh.rules.get(ANALYTICS_RULE_ID).action.redirect.transform.queryTransform.addOrReplaceParams[0].value, "50");
});

test("rejects invalid changes and rolls storage back when the DNR update fails", async () => {
  const invalid = makeFakes({ initial: { [SETTINGS_KEY]: 50 } });
  await assert.rejects(invalid.controller.applyLimit("0"), /positive whole number/);
  assert.equal(invalid.updates.length, 0);

  const failing = makeFakes({ initial: { [SETTINGS_KEY]: 50 }, failRuleUpdate: true });
  await assert.rejects(failing.controller.applyLimit(200), /Could not update the request rule/);
  assert.equal(failing.data[SETTINGS_KEY], 50);
  assert.match(failing.data[ERROR_KEY], /could not be updated/i);
});
