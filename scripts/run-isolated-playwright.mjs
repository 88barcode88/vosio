import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createConnection } from "node:net";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  cleanupIsolatedPlaywrightWorkspace,
  createIsolatedPlaywrightWorkspace,
  pathExists
} from "./isolated-playwright-workspace.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const processStopTimeoutMs = 5_000;
const serverReadyTimeoutMs = 120_000;
const readinessPath = "/login/vosio-playwright-ready";

// loadLocalEnvironment passes ignored local configuration to Playwright without copying or logging it.
async function loadLocalEnvironment() {
  const localEnvPath = path.join(sourceRoot, ".env.local");
  if (await pathExists(localEnvPath)) {
    process.loadEnvFile(localEnvPath);
  }
}

// getPlaywrightPort validates the isolated port before the runner starts an owned listener.
function getPlaywrightPort() {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    throw new Error(
      "PLAYWRIGHT_BASE_URL is not supported; use PLAYWRIGHT_PORT with the owned isolated server."
    );
  }
  const value = process.env.PLAYWRIGHT_PORT ?? "3047";
  const port = Number(value);
  if (!/^\d{4,5}$/u.test(value) || !Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("PLAYWRIGHT_PORT must be an integer between 1024 and 65535.");
  }
  return port;
}

// waitForChild captures startup errors as results so guarded cleanup still runs.
function waitForChild(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, error, signal: null }));
    child.once("exit", (code, signal) => resolve({ code, error: null, signal }));
  });
}

// settleWithin bounds process teardown instead of trusting child shutdown indefinitely.
function settleWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ settled: false, value: null }), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve({ settled: true, value });
    });
  });
}

// canConnect reports whether any listener currently owns the exact loopback port.
function canConnect(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;

    // finish closes the probe exactly once and reports the observed listener state.
    function finish(listening) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    }

    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

// startReadinessProbe verifies the response body against this runner's unguessable workspace token.
function startReadinessProbe(url, readinessToken) {
  let settled = false;
  let responseBody = "";
  let resolveProbe;
  const promise = new Promise((resolve) => {
    resolveProbe = resolve;
  });
  const probe = request(url, { method: "GET" });

  // finish closes the readiness request exactly once.
  function finish(ready) {
    if (settled) return;
    settled = true;
    probe.destroy();
    resolveProbe(ready);
  }

  probe.setTimeout(1_000, () => finish(false));
  probe.once("response", (response) => {
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      responseBody += chunk;
      if (responseBody.length > readinessToken.length) finish(false);
    });
    response.once("end", () => finish(response.statusCode === 200 && responseBody === readinessToken));
    response.once("error", () => finish(false));
  });
  probe.once("error", () => finish(false));
  probe.end();

  return {
    // cancel aborts only this runner's in-flight readiness request.
    cancel: () => finish(false),
    promise
  };
}

// waitForServerReady rejects foreign responses and exits promptly when shutdown wins the race.
async function waitForServerReady(url, readinessToken, serverResultPromise, shutdownPromise) {
  const deadline = Date.now() + serverReadyTimeoutMs;
  while (Date.now() < deadline) {
    const probe = startReadinessProbe(url, readinessToken);
    const outcome = await Promise.race([
      probe.promise.then((ready) => ({ kind: ready ? "ready" : "retry" })),
      serverResultPromise.then((result) => ({ kind: "exit", result })),
      shutdownPromise.then(() => ({ kind: "shutdown" }))
    ]);
    probe.cancel();

    if (outcome.kind === "ready") return true;
    if (outcome.kind === "shutdown") return false;
    if (outcome.kind === "exit") {
      if (outcome.result.error) throw outcome.result.error;
      throw new Error(`Owned Next server exited before readiness (code ${outcome.result.code ?? "unknown"}).`);
    }
    await Promise.race([delay(100), shutdownPromise]);
  }
  throw new Error(`Owned Next server did not become ready at ${url} within ${serverReadyTimeoutMs}ms.`);
}

// waitForPortClosed proves the exact owned listener is gone before its workspace can be removed.
async function waitForPortClosed(port) {
  const deadline = Date.now() + processStopTimeoutMs;
  while (Date.now() < deadline) {
    if (!await canConnect(port)) return true;
    await delay(100);
  }
  return !await canConnect(port);
}

// isProcessGroupAlive checks the detached POSIX group rather than only its original leader.
function isProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

// waitForProcessGroupStopped proves no member remains in the exact POSIX process group.
async function waitForProcessGroupStopped(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(processGroupId)) return true;
    await delay(100);
  }
  return !isProcessGroupAlive(processGroupId);
}

// stopOwnedProcessTree proves complete teardown or fails closed while retaining the workspace.
async function stopOwnedProcessTree(
  child,
  resultPromise,
  { forceUnproven = false, knownLeaf = false, simulateTreeKillFailure = false } = {}
) {
  if (!child?.pid || !resultPromise) return true;
  const processId = child.pid;

  if (forceUnproven) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await settleWithin(resultPromise, processStopTimeoutMs);
    return false;
  }

  if (knownLeaf) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    return (await settleWithin(resultPromise, processStopTimeoutMs)).settled;
  }

  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    const taskkill = simulateTreeKillFailure
      ? spawn(process.execPath, ["-e", "process.exit(1)"], {
        stdio: "ignore",
        windowsHide: true
      })
      : spawn("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
    const taskkillResult = await settleWithin(waitForChild(taskkill), processStopTimeoutMs);
    const treeStopSucceeded = taskkillResult.settled
      && !taskkillResult.value.error
      && taskkillResult.value.code === 0;
    if (!treeStopSucceeded) {
      if (taskkill.exitCode === null && taskkill.signalCode === null) taskkill.kill();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await settleWithin(resultPromise, processStopTimeoutMs);
      return false;
    }
    return (await settleWithin(resultPromise, processStopTimeoutMs)).settled;
  }

  if (isProcessGroupAlive(processId)) {
    try {
      process.kill(-processId, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") return false;
    }
  }
  if (await waitForProcessGroupStopped(processId, processStopTimeoutMs)) return true;
  try {
    process.kill(-processId, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") return false;
  }
  return waitForProcessGroupStopped(processId, processStopTimeoutMs);
}

// createOwnedReadinessRoute embeds a per-run token only in the isolated workspace copy.
async function createOwnedReadinessRoute(workspace, readinessToken) {
  const routeDirectory = path.join(workspace, "app", readinessPath.slice(1));
  await mkdir(routeDirectory, { recursive: true });
  const routeSource = [
    `const readinessToken = ${JSON.stringify(readinessToken)};`,
    "",
    "// GET proves that this exact isolated workspace owns the requested test server.",
    "export function GET() {",
    "  return new Response(readinessToken, {",
    "    headers: { \"cache-control\": \"no-store\", \"content-type\": \"text/plain; charset=utf-8\" }",
    "  });",
    "}",
    ""
  ].join("\n");
  await writeFile(path.join(routeDirectory, "route.ts"), routeSource, "utf8");
}

// startOwnedNextServer launches either Next or a bounded test server without a shell.
function startOwnedNextServer({ childEnvironment, port, readinessToken, testRuntime }) {
  const testServerMode = testRuntime ? process.env.VOSIO_E2E_TEST_SERVER_MODE : undefined;
  const readinessDelayMs = testRuntime
    ? Number(process.env.VOSIO_E2E_TEST_READINESS_DELAY_MS ?? "0")
    : 0;
  const testServerScript = [
    "const { spawn } = require('node:child_process');",
    "const http = require('node:http');",
    "const port = Number(process.argv[1]);",
    "const token = process.argv[2];",
    "const delayMs = Number(process.argv[3]);",
    "const spawnChild = process.argv[4] === 'exit-after-ready-with-child' || process.argv[4] === 'spawn-child' || process.argv[4] === 'spawn-child-unforced';",
    "const exitAfterReady = process.argv[4] === 'exit-after-ready' || process.argv[4] === 'exit-after-ready-with-child';",
    "if (spawnChild) spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 3000)'], { stdio: 'ignore', windowsHide: true });",
    `const server = http.createServer((request, response) => { if (request.url !== '${readinessPath}') { response.statusCode = 404; response.end(); return; } setTimeout(() => response.end(token, () => { if (exitAfterReady) server.close(() => process.exit(0)); }), delayMs); });`,
    "server.listen(port, '127.0.0.1');"
  ].join(" ");
  const nextCli = path.join(sourceRoot, "node_modules", "next", "dist", "bin", "next");
  const isTestServer = testServerMode === "exit-after-ready"
    || testServerMode === "exit-after-ready-with-child"
    || testServerMode === "listen"
    || testServerMode === "spawn-child"
    || testServerMode === "spawn-child-unforced";
  const args = isTestServer
    ? ["-e", testServerScript, String(port), readinessToken, String(readinessDelayMs), testServerMode]
    : [nextCli, "dev", childEnvironment.VOSIO_PLAYWRIGHT_PROJECT_ROOT, "--hostname", "127.0.0.1", "--port", String(port)];
  const child = spawn(process.execPath, args, {
    cwd: sourceRoot,
    detached: process.platform !== "win32",
    env: childEnvironment,
    stdio: isTestServer ? "ignore" : "inherit",
    windowsHide: true
  });

  return {
    child,
    forceUnproven: testServerMode === "spawn-child",
    knownLeaf: testServerMode === "exit-after-ready" || testServerMode === "listen",
    simulateTreeKillFailure: testRuntime
      && process.env.VOSIO_E2E_TEST_TREE_KILL_FAILURE === "1"
  };
}

// run owns the isolated Next and Playwright lifecycles before cleaning their exact workspace.
async function run() {
  let playwright = null;
  let playwrightKnownLeaf = false;
  let playwrightResultPromise = null;
  let playwrightStopProven = true;
  let readinessSignalTimer = null;
  let server = null;
  let serverForceUnproven = false;
  let serverKnownLeaf = false;
  let serverSimulateTreeKillFailure = false;
  let serverOwnedReadiness = false;
  let serverResultPromise = null;
  let workspace = null;
  let shutdownRequested = false;
  let requestedSignal = null;
  let resolveShutdown;
  const shutdownPromise = new Promise((resolve) => {
    resolveShutdown = resolve;
  });

  // forwardSignal wakes startup or Playwright waits so bounded owned-tree teardown starts immediately.
  function forwardSignal(signal) {
    requestedSignal = signal;
    shutdownRequested = true;
    resolveShutdown();
  }

  // signalHandlers are installed before the first await and retain removable listener identities.
  const signalHandlers = {
    SIGINT: () => forwardSignal("SIGINT"),
    SIGTERM: () => forwardSignal("SIGTERM")
  };
  process.once("SIGINT", signalHandlers.SIGINT);
  process.once("SIGTERM", signalHandlers.SIGTERM);

  try {
    const testRuntime = process.env.NODE_ENV === "test";
    const skipTestCopy = testRuntime && process.env.VOSIO_E2E_TEST_SKIP_COPY === "1";
    workspace = await createIsolatedPlaywrightWorkspace(sourceRoot, {
      copyProject: !skipTestCopy
    });
    if (testRuntime && process.env.VOSIO_E2E_TEST_MARKER) {
      await writeFile(
        path.join(workspace, ".vosio-test-marker"),
        process.env.VOSIO_E2E_TEST_MARKER,
        "utf8"
      );
    }

    if (testRuntime && process.env.VOSIO_E2E_TEST_SIGNAL_BEFORE_SPAWN === "1") {
      process.emit("SIGTERM");
    }
    if (shutdownRequested) {
      process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
      return;
    }

    await loadLocalEnvironment();
    if (shutdownRequested) {
      process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
      return;
    }

    const playwrightPort = getPlaywrightPort();
    if (await canConnect(playwrightPort)) {
      throw new Error(`PLAYWRIGHT_PORT ${playwrightPort} is already in use; refusing to adopt an unowned server.`);
    }
    const readinessToken = randomBytes(32).toString("hex");
    const childEnvironment = {
      ...process.env,
      VOSIO_PLAYWRIGHT_PROJECT_ROOT: workspace,
      VOSIO_PLAYWRIGHT_RUNNER: "1"
    };
    delete childEnvironment.VOSIO_E2E_TEST_CHILD_MODE;
    delete childEnvironment.VOSIO_E2E_TEST_MARKER;
    delete childEnvironment.VOSIO_E2E_TEST_READINESS_DELAY_MS;
    delete childEnvironment.VOSIO_E2E_TEST_SERVER_MODE;
    delete childEnvironment.VOSIO_E2E_TEST_SIGNAL_AFTER_SPAWN;
    delete childEnvironment.VOSIO_E2E_TEST_SIGNAL_BEFORE_SPAWN;
    delete childEnvironment.VOSIO_E2E_TEST_SIGNAL_DURING_READINESS;
    delete childEnvironment.VOSIO_E2E_TEST_SKIP_COPY;
    delete childEnvironment.VOSIO_E2E_TEST_TREE_KILL_FAILURE;

    if (!testRuntime || !process.env.VOSIO_E2E_TEST_SERVER_MODE) {
      await createOwnedReadinessRoute(workspace, readinessToken);
    }
    const serverHandle = startOwnedNextServer({
      childEnvironment,
      port: playwrightPort,
      readinessToken,
      testRuntime
    });
    server = serverHandle.child;
    serverForceUnproven = serverHandle.forceUnproven;
    serverKnownLeaf = serverHandle.knownLeaf;
    serverSimulateTreeKillFailure = serverHandle.simulateTreeKillFailure;
    serverResultPromise = waitForChild(server);
    if (testRuntime && process.env.VOSIO_E2E_TEST_SIGNAL_DURING_READINESS === "1") {
      readinessSignalTimer = setTimeout(() => process.emit("SIGTERM"), 50);
    }
    const playwrightBaseUrl = `http://127.0.0.1:${playwrightPort}`;
    serverOwnedReadiness = await waitForServerReady(
      `${playwrightBaseUrl}${readinessPath}`,
      readinessToken,
      serverResultPromise,
      shutdownPromise
    );
    if (!serverOwnedReadiness || shutdownRequested) {
      process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
      return;
    }
    childEnvironment.VOSIO_PLAYWRIGHT_SERVER_READY = "1";

    const testChildMode = testRuntime ? process.env.VOSIO_E2E_TEST_CHILD_MODE : undefined;
    const playwrightCli = path.join(sourceRoot, "node_modules", "@playwright", "test", "cli.js");
    const args = testChildMode === "exit-zero"
      ? ["-e", "process.exit(0)"]
      : testChildMode === "exit-one"
        ? ["-e", "process.exit(1)"]
        : testChildMode === "delay-zero"
          ? ["-e", "setTimeout(() => process.exit(0), 500)"]
          : [playwrightCli, "test", ...process.argv.slice(2)];

    playwrightKnownLeaf = Boolean(testChildMode);
    playwrightStopProven = false;
    playwright = spawn(process.execPath, args, {
      cwd: sourceRoot,
      detached: process.platform !== "win32",
      env: childEnvironment,
      stdio: testChildMode ? "ignore" : "inherit",
      windowsHide: true
    });
    playwrightResultPromise = waitForChild(playwright);
    if (testRuntime && process.env.VOSIO_E2E_TEST_SIGNAL_AFTER_SPAWN === "1") {
      process.emit("SIGTERM");
    }
    const outcome = await Promise.race([
      playwrightResultPromise.then((result) => ({ kind: "result", result })),
      shutdownPromise.then(() => ({ kind: "shutdown" }))
    ]);

    if (outcome.kind === "shutdown") {
      playwrightStopProven = await stopOwnedProcessTree(playwright, playwrightResultPromise, {
        knownLeaf: playwrightKnownLeaf
      });
      process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
      return;
    }

    playwrightStopProven = true;
    const result = outcome.result;
    if (result.error) throw result.error;
    process.exitCode = result.signal === null ? result.code ?? 1 : 1;
  } finally {
    if (readinessSignalTimer) clearTimeout(readinessSignalTimer);
    process.removeListener("SIGINT", signalHandlers.SIGINT);
    process.removeListener("SIGTERM", signalHandlers.SIGTERM);
    if (!playwrightStopProven) {
      playwrightStopProven = await stopOwnedProcessTree(playwright, playwrightResultPromise, {
        knownLeaf: playwrightKnownLeaf
      });
    }
    const serverStopped = await stopOwnedProcessTree(server, serverResultPromise, {
      forceUnproven: serverForceUnproven,
      knownLeaf: serverKnownLeaf,
      simulateTreeKillFailure: serverSimulateTreeKillFailure
    });
    const portClosed = serverOwnedReadiness ? await waitForPortClosed(getPlaywrightPort()) : true;
    if (workspace && playwrightStopProven && serverStopped && portClosed) {
      await cleanupIsolatedPlaywrightWorkspace(sourceRoot, workspace);
    } else if (workspace) {
      process.stderr.write(`Owned process-tree cleanup could not be proven; retained ${workspace}.\n`);
      process.exitCode = 1;
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
