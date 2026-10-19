import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_BROWSER_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browserPath = process.argv[2] || DEFAULT_BROWSER_PATH;
const sourceExtension = path.resolve(process.cwd());
const smokeRequest = {
  url: "https://api.nextdns.io/profiles/smoke-test-profile/analytics/domains?from=2026-10-19T00%3A00%3A00Z&limit=13&to=2026-10-19T01%3A00%3A00Z",
  initiator: "https://my.nextdns.io/",
  type: "xmlhttprequest"
};

function createCdpClient(socketUrl) {
  const socket = new WebSocket(socketUrl);
  const pending = new Map();
  const eventHandlers = new Set();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to the browser debugging socket.")), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    for (const handler of eventHandlers) handler(message);
  });

  return {
    async ready() { await ready; },
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    send(method, params = {}) {
      const id = nextId++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    close() { socket.close(); }
  };
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Browser debugging endpoint returned ${response.status}.`);
  return response.json();
}

async function waitForTarget(debugPort, predicate, timeoutMs = 20000) {
  const started = Date.now();
  let lastTargets = [];
  while (Date.now() - started < timeoutMs) {
    lastTargets = await readJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = lastTargets.find(predicate);
    if (target) return target;
    await delay(200);
  }
  const targetSummary = lastTargets.map(({ type, url }) => ({ type, url }));
  throw new Error(`Timed out waiting for the browser extension page. Browser targets: ${JSON.stringify(targetSummary)}`);
}

async function evaluate(client, expression, timeoutMs = 15000) {
  const response = await Promise.race([
    client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }),
    delay(timeoutMs).then(() => { throw new Error("Timed out waiting for the browser evaluation."); })
  ]);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Browser evaluation failed.");
  }
  return response.result?.value;
}

let tempRoot;
let profileDirectory;
let testExtensionDirectory;
let browserProcess;
let browserClient;

try {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "nextdns-detailed-analytics-edge-"));
  profileDirectory = path.join(tempRoot, "profile");
  testExtensionDirectory = path.join(tempRoot, "extension");
  await mkdir(testExtensionDirectory);

  for (const file of ["manifest.json", "background.js", "extension-core.js", "popup.html", "popup.js"]) {
    await copyFile(path.join(sourceExtension, file), path.join(testExtensionDirectory, file));
  }
  const testManifest = JSON.parse(await readFile(path.join(testExtensionDirectory, "manifest.json"), "utf8"));
  testManifest.permissions.push("declarativeNetRequestFeedback");
  await writeFile(path.join(testExtensionDirectory, "manifest.json"), JSON.stringify(testManifest, null, 2));

  browserProcess = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDirectory}`,
    `--disable-extensions-except=${testExtensionDirectory}`,
    `--load-extension=${testExtensionDirectory}`,
    "about:blank"
  ], { stdio: "ignore", windowsHide: true });

  let launchError;
  browserProcess.on("error", (error) => { launchError = error; });

  const activePortFile = path.join(profileDirectory, "DevToolsActivePort");
  let debugPort;
  const debugStarted = Date.now();
  while (!debugPort && Date.now() - debugStarted < 20000) {
    try {
      const [port] = (await readFile(activePortFile, "utf8")).trim().split(/\r?\n/);
      debugPort = Number(port);
    } catch {
      if (launchError) throw new Error(`Could not launch the browser: ${launchError.message}`);
      if (browserProcess.exitCode !== null) throw new Error("The browser exited before enabling its test debugging endpoint.");
      await delay(200);
    }
  }
  assert.ok(debugPort, "The browser did not start its temporary debugging endpoint.");

  const version = await readJson(`http://127.0.0.1:${debugPort}/json/version`);
  browserClient = createCdpClient(version.webSocketDebuggerUrl);
  await browserClient.ready();

  const workerTarget = await waitForTarget(debugPort, (target) =>
    target.type === "service_worker" && target.url.endsWith("/background.js")
  );
  const extensionId = new URL(workerTarget.url).hostname;
  const extensionTarget = await browserClient.send("Target.createTarget", {
    url: `chrome-extension://${extensionId}/popup.html`
  });
  const extensionPage = await waitForTarget(debugPort, (target) => target.id === extensionTarget.targetId);
  const extensionClient = createCdpClient(extensionPage.webSocketDebuggerUrl);
  await extensionClient.ready();
  await extensionClient.send("Runtime.enable");

  const manifest = await evaluate(extensionClient, "chrome.runtime.getManifest()");
  assert.equal(manifest.name, "NextDNS Detailed Analytics", "The browser page is not the test extension.");

  const rules = await evaluate(extensionClient, "chrome.declarativeNetRequest.getDynamicRules()");
  const rule = rules.find((candidate) => candidate.id === 1);
  assert.ok(rule, "The extension did not install its analytics dynamic rule.");
  assert.equal(rule.condition.urlFilter, "https://api.nextdns.io/profiles/*/analytics/*");
  assert.deepEqual(rule.condition.initiatorDomains, ["my.nextdns.io"]);
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame", "xmlhttprequest"]);
  assert.equal(
    rule.action.redirect.transform.queryTransform.addOrReplaceParams.find((item) => item.key === "limit")?.value,
    "50"
  );

  const matchResult = await evaluate(
    extensionClient,
    `chrome.declarativeNetRequest.testMatchOutcome(${JSON.stringify(smokeRequest)})`
  );
  assert.ok(
    matchResult.matchedRules.some((matchedRule) => matchedRule.ruleId === 1),
    "The browser's DNR engine did not match an analytics request from the NextDNS dashboard."
  );

  const unrelatedResult = await evaluate(
    extensionClient,
    `chrome.declarativeNetRequest.testMatchOutcome(${JSON.stringify({
      ...smokeRequest,
      url: "https://api.nextdns.io/profiles/smoke-test-profile/settings"
    })})`
  );
  assert.deepEqual(unrelatedResult.matchedRules, [], "The rule should not match a non-analytics API path.");

  console.log("PASS: The browser installed the dynamic rule; its DNR engine matched the dashboard analytics request and excluded a non-analytics API path.");
  console.log("The production query transform was also checked by the Node unit test.");
  extensionClient.close();
} finally {
  if (browserClient) {
    try { await browserClient.send("Browser.close"); } catch { /* Browser may already have exited. */ }
    browserClient.close();
  }
  if (browserProcess && browserProcess.exitCode === null) {
    browserProcess.kill();
    await Promise.race([
      new Promise((resolve) => browserProcess.once("exit", resolve)),
      delay(3000)
    ]);
  }

  if (tempRoot) {
    const tempDirectory = path.resolve(os.tmpdir()) + path.sep;
    const resolvedRoot = path.resolve(tempRoot);
    assert.ok(resolvedRoot.startsWith(tempDirectory), "Refusing to remove a directory outside the temporary directory.");
    assert.ok(path.basename(resolvedRoot).startsWith("nextdns-detailed-analytics-edge-"), "Refusing to remove an unexpected directory.");
    await rm(resolvedRoot, { recursive: true, force: true });
  }
}
