import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  cleanupIsolatedPlaywrightWorkspace,
  createIsolatedPlaywrightWorkspace,
  pathExists
} from "./isolated-playwright-workspace.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// loadLocalEnvironment passes ignored local configuration to Playwright without copying or logging it.
async function loadLocalEnvironment() {
  const localEnvPath = path.join(sourceRoot, ".env.local");
  if (await pathExists(localEnvPath)) {
    process.loadEnvFile(localEnvPath);
  }
}

// waitForChild captures startup errors as results so guarded cleanup still runs.
function waitForChild(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, error, signal: null }));
    child.once("exit", (code, signal) => resolve({ code, error: null, signal }));
  });
}

// run creates one temp project and delegates the complete Next process lifecycle to Playwright.
async function run() {
  let playwright = null;
  let workspace = null;
  let shutdownRequested = false;
  let requestedSignal = null;
  let cleanupProvenSafe = false;

  // forwardSignal gives the owned Playwright process the same interruption without discovering other PIDs.
  function forwardSignal(signal) {
    requestedSignal = signal;
    shutdownRequested = true;
    if (playwright?.pid && playwright.exitCode === null && playwright.signalCode === null) {
      playwright.kill(signal);
    }
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
    cleanupProvenSafe = true;
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
      cleanupProvenSafe = true;
      process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
      return;
    }

    await loadLocalEnvironment();
    if (shutdownRequested) {
      cleanupProvenSafe = true;
      process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
      return;
    }

    const childEnvironment = {
      ...process.env,
      VOSIO_PLAYWRIGHT_PROJECT_ROOT: workspace,
      VOSIO_PLAYWRIGHT_RUNNER: "1"
    };
    delete childEnvironment.VOSIO_E2E_TEST_CHILD_MODE;
    delete childEnvironment.VOSIO_E2E_TEST_MARKER;
    delete childEnvironment.VOSIO_E2E_TEST_SIGNAL_AFTER_SPAWN;
    delete childEnvironment.VOSIO_E2E_TEST_SIGNAL_BEFORE_SPAWN;
    delete childEnvironment.VOSIO_E2E_TEST_SKIP_COPY;

    const testChildMode = testRuntime ? process.env.VOSIO_E2E_TEST_CHILD_MODE : undefined;
    const playwrightCli = path.join(sourceRoot, "node_modules", "@playwright", "test", "cli.js");
    const args = testChildMode === "exit-zero"
      ? ["-e", "process.exit(0)"]
      : testChildMode === "exit-one"
        ? ["-e", "process.exit(1)"]
        : testChildMode === "delay-zero"
          ? ["-e", "setTimeout(() => process.exit(0), 500)"]
        : [playwrightCli, "test", ...process.argv.slice(2)];

    cleanupProvenSafe = false;
    playwright = spawn(process.execPath, args, {
      cwd: sourceRoot,
      env: childEnvironment,
      stdio: testChildMode ? "ignore" : "inherit",
      windowsHide: true
    });
    const resultPromise = waitForChild(playwright);
    if (testRuntime && process.env.VOSIO_E2E_TEST_SIGNAL_AFTER_SPAWN === "1") {
      process.emit("SIGTERM");
    }
    const result = await resultPromise;

    if (result.error) {
      cleanupProvenSafe = true;
      throw result.error;
    }
    if (!shutdownRequested && result.signal === null) {
      cleanupProvenSafe = true;
      process.exitCode = result.code ?? 1;
    } else if (requestedSignal === "SIGINT") {
      process.exitCode = 130;
    } else if (requestedSignal === "SIGTERM") {
      process.exitCode = 143;
    } else {
      process.exitCode = 1;
    }
  } finally {
    process.removeListener("SIGINT", signalHandlers.SIGINT);
    process.removeListener("SIGTERM", signalHandlers.SIGTERM);
    if (workspace && cleanupProvenSafe) {
      await cleanupIsolatedPlaywrightWorkspace(sourceRoot, workspace);
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
