import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertIsolatedPlaywrightWorkspace,
  cleanupIsolatedPlaywrightWorkspace,
  createIsolatedPlaywrightWorkspace,
  pathExists
} from "../../scripts/isolated-playwright-workspace.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const ownedMarkers = new Set<string>();
const directlyOwnedWorkspaces = new Set<string>();
const teardownReceiptName = ".vosio-teardown-receipt.json";

// waitForExit captures the outer runner result without invoking a shell.
function waitForExit(child: ChildProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

// collectChildStderr captures fixed runner diagnostics without exposing them through the test process.
function collectChildStderr(child: ChildProcess) {
  return new Promise<string>((resolve) => {
    let output = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { output += chunk; });
    child.stderr?.once("end", () => resolve(output));
  });
}

// startTestRunner launches the production runner with a bounded fake Playwright child.
function startTestRunner({
  marker = randomUUID(),
  mode,
  port = 3175,
  readinessDelayMs = 0,
  receiptFailure,
  serverMode = "listen",
  signalAfterSpawn = false,
  signalBeforeSpawn = false,
  signalDuringReadiness = false,
  treeKillFailure = false,
  treeKillOutput
}: {
  marker?: string;
  mode: "delay-zero" | "exit-one" | "exit-zero";
  port?: number;
  readinessDelayMs?: number;
  receiptFailure?: "rename" | "write";
  serverMode?: "exit-after-ready" | "exit-after-ready-with-child" | "listen" | "spawn-child" | "spawn-child-unforced";
  signalAfterSpawn?: boolean;
  signalBeforeSpawn?: boolean;
  signalDuringReadiness?: boolean;
  treeKillFailure?: boolean;
  treeKillOutput?: "delayed-drain" | "empty" | "incomplete-drain" | "localized" | "partial-success" | "truncated";
}) {
  ownedMarkers.add(marker);
  const child = spawn(process.execPath, ["scripts/run-isolated-playwright.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PLAYWRIGHT_PORT: String(port),
      VOSIO_E2E_TEST_CHILD_MODE: mode,
      VOSIO_E2E_TEST_MARKER: marker,
      VOSIO_E2E_TEST_READINESS_DELAY_MS: String(readinessDelayMs),
      VOSIO_E2E_TEST_RECEIPT_FAILURE: receiptFailure ?? "",
      VOSIO_E2E_TEST_SERVER_MODE: serverMode,
      VOSIO_E2E_TEST_SIGNAL_AFTER_SPAWN: signalAfterSpawn ? "1" : "0",
      VOSIO_E2E_TEST_SIGNAL_BEFORE_SPAWN: signalBeforeSpawn ? "1" : "0",
      VOSIO_E2E_TEST_SIGNAL_DURING_READINESS: signalDuringReadiness ? "1" : "0",
      VOSIO_E2E_TEST_SKIP_COPY: "1",
      VOSIO_E2E_TEST_TREE_KILL_FAILURE: treeKillFailure ? "1" : "0",
      VOSIO_E2E_TEST_TREE_KILL_OUTPUT: treeKillOutput ?? ""
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });
  return { child, exit: waitForExit(child), marker, stderr: collectChildStderr(child) };
}

// isPortClosed verifies the runner released only the exact listener it started.
async function isPortClosed(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

// findMarkedWorkspace returns only a test workspace carrying this test's exact marker.
async function findMarkedWorkspace(marker: string) {
  const tempRoot = path.join(projectRoot, ".tmp");
  const entries = await readdir(tempRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^next-playwright-[a-zA-Z0-9]{6}$/u.test(entry.name)) continue;
    const workspace = path.join(tempRoot, entry.name);
    const markerPath = path.join(workspace, ".vosio-test-marker");
    if (await pathExists(markerPath) && await readFile(markerPath, "utf8") === marker) {
      return workspace;
    }
  }
  return null;
}

// waitForMarkedWorkspace observes one exact test-owned workspace without broad directory cleanup.
async function waitForMarkedWorkspace(marker: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const workspace = await findMarkedWorkspace(marker);
    if (workspace) return workspace;
    await delay(25);
  }
  throw new Error("Timed out waiting for the isolated test workspace.");
}

// readTeardownReceipt loads only the bounded diagnostic receipt from one retained test workspace.
async function readTeardownReceipt(workspace: string) {
  const serialized = await readFile(path.join(workspace, teardownReceiptName), "utf8");
  expect(serialized.length).toBeLessThanOrEqual(2_048);
  return JSON.parse(serialized) as Record<string, unknown>;
}

afterEach(async () => {
  for (const workspace of directlyOwnedWorkspaces) {
    if (await pathExists(workspace)) {
      await cleanupIsolatedPlaywrightWorkspace(projectRoot, workspace);
    }
  }
  directlyOwnedWorkspaces.clear();

  for (const marker of ownedMarkers) {
    const workspace = await findMarkedWorkspace(marker);
    if (workspace) {
      await cleanupIsolatedPlaywrightWorkspace(projectRoot, workspace);
    }
  }
  ownedMarkers.clear();
});

describe("isolated Playwright outer runner", () => {
  it("copies only the runnable project and keeps Next-generated writes isolated", async () => {
    const trackedNextEnvPath = path.join(projectRoot, "next-env.d.ts");
    const trackedTsconfigPath = path.join(projectRoot, "tsconfig.json");
    const originalNextEnv = await readFile(trackedNextEnvPath, "utf8");
    const originalTsconfig = await readFile(trackedTsconfigPath, "utf8");
    const workspace = await createIsolatedPlaywrightWorkspace(projectRoot);
    directlyOwnedWorkspaces.add(workspace);

    await expect(access(path.join(workspace, "app"))).resolves.toBeUndefined();
    await expect(access(path.join(workspace, "src"))).resolves.toBeUndefined();
    await expect(access(path.join(workspace, "public"))).resolves.toBeUndefined();
    await expect(access(path.join(workspace, ".env.local"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(workspace, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(workspace, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(path.join(workspace, "next-env.d.ts"), "generated next-env\n", "utf8");
    await writeFile(path.join(workspace, "tsconfig.json"), "{\"generated\":true}\n", "utf8");
    await expect(readFile(trackedNextEnvPath, "utf8")).resolves.toBe(originalNextEnv);
    await expect(readFile(trackedTsconfigPath, "utf8")).resolves.toBe(originalTsconfig);
  }, 15_000);

  it("cleans its workspace after successful and failed Playwright exits", async () => {
    for (const [mode, expectedCode, port] of [["exit-zero", 0, 3175], ["exit-one", 1, 3176]] as const) {
      const run = startTestRunner({ mode, port });
      await expect(run.exit).resolves.toMatchObject({ code: expectedCode });
      await expect(isPortClosed(port)).resolves.toBe(true);
      await expect(findMarkedWorkspace(run.marker)).resolves.toBeNull();
    }
  });

  it("cleans without spawning Playwright when interrupted during preparation", async () => {
    const run = startTestRunner({ mode: "exit-zero", signalBeforeSpawn: true });

    await expect(run.exit).resolves.toMatchObject({ code: 143 });
    await expect(findMarkedWorkspace(run.marker)).resolves.toBeNull();
  });

  it("stops its owned server and cleans its workspace after an interrupted Playwright child", async () => {
    const port = 3177;
    const run = startTestRunner({ mode: "delay-zero", port, signalAfterSpawn: true });

    await expect(run.exit).resolves.toMatchObject({ code: 143 });
    await expect(isPortClosed(port)).resolves.toBe(true);
    await expect(findMarkedWorkspace(run.marker)).resolves.toBeNull();
  });

  it("allows only one same-port runner to reach Playwright through its owned readiness token", async () => {
    const first = startTestRunner({ mode: "delay-zero", port: 3178 });
    const second = startTestRunner({ mode: "delay-zero", port: 3178 });
    const firstWorkspace = await waitForMarkedWorkspace(first.marker);
    const secondWorkspace = await waitForMarkedWorkspace(second.marker);

    expect(firstWorkspace).not.toBe(secondWorkspace);
    const results = await Promise.all([first.exit, second.exit]);
    expect(results.map((result) => result.code).sort()).toEqual([0, 1]);
    await expect(isPortClosed(3178)).resolves.toBe(true);
    await expect(findMarkedWorkspace(first.marker)).resolves.toBeNull();
    await expect(findMarkedWorkspace(second.marker)).resolves.toBeNull();
  }, 10_000);

  it("interrupts readiness immediately and cleans after its bounded owned-server stop", async () => {
    const port = 3179;
    const run = startTestRunner({
      mode: "exit-zero",
      port,
      readinessDelayMs: 10_000,
      signalDuringReadiness: true
    });

    await expect(run.exit).resolves.toMatchObject({ code: 143 });
    await expect(isPortClosed(port)).resolves.toBe(true);
    await expect(findMarkedWorkspace(run.marker)).resolves.toBeNull();
  }, 5_000);

  it("cleans its workspace when the owned Windows server already stopped after readiness", async () => {
    const port = 3180;
    const run = startTestRunner({ mode: "delay-zero", port, serverMode: "exit-after-ready" });

    await expect(run.exit).resolves.toMatchObject({ code: 0 });
    await expect(isPortClosed(port)).resolves.toBe(true);
    await expect(findMarkedWorkspace(run.marker)).resolves.toBeNull();
  });

  it.runIf(process.platform === "win32")(
    "fails closed when a terminal Windows leader leaves an unproven descendant",
    async () => {
      const port = 3181;
      const run = startTestRunner({
        mode: "delay-zero",
        port,
        serverMode: "exit-after-ready-with-child"
      });

      await expect(run.exit).resolves.toMatchObject({ code: 1 });
      await expect(isPortClosed(port)).resolves.toBe(true);
      const workspace = await findMarkedWorkspace(run.marker);
      expect(workspace).not.toBeNull();
      await expect(readTeardownReceipt(workspace!)).resolves.toEqual({
        portProof: { closed: true, required: true },
        server: {
          leaderSettlement: { settled: true },
          pid: expect.any(Number),
          preState: { exitCode: 0, signalCode: null, terminal: true },
          selectedBranch: "terminal-leader",
          taskkill: null
        },
        version: 1
      });
    }
  );

  it("fails closed and retains its workspace when a descendant tree cannot be proven stopped", async () => {
    const port = 3182;
    const run = startTestRunner({
      mode: "exit-zero",
      port,
      serverMode: "spawn-child-unforced",
      treeKillFailure: true
    });

    await expect(run.exit).resolves.toMatchObject({ code: 1 });
    await expect(isPortClosed(port)).resolves.toBe(true);
    const workspace = await findMarkedWorkspace(run.marker);
    expect(workspace).not.toBeNull();
    await expect(readTeardownReceipt(workspace!)).resolves.toEqual({
      portProof: { closed: true, required: true },
      server: {
        leaderSettlement: { settled: true },
        pid: expect.any(Number),
        preState: { exitCode: null, signalCode: null, terminal: false },
        selectedBranch: "taskkill-failed",
        taskkill: {
          code: 1,
          durationMs: expect.any(Number),
          errorCategory: "nonzero-exit",
          outputSummary: {
            failedPidCount: 0,
            leaderSuccess: false,
            parseComplete: false,
            reasonCategoryCounts: {
              "access-denied": 0,
              "no-running-instance": 0,
              "operation-not-supported": 0,
              other: 0
            },
            successPidCount: 0,
            truncated: false
          },
          settled: true
        }
      },
      version: 1
    });
  });

  it("persists only bounded taskkill output aggregates for every diagnostic shape", async () => {
    const fixtures = [
      {
        name: "partial-success" as const,
        port: 3186,
        summary: {
          failedPidCount: 3,
          leaderSuccess: true,
          parseComplete: true,
          reasonCategoryCounts: {
            "access-denied": 1,
            "no-running-instance": 1,
            "operation-not-supported": 1,
            other: 0
          },
          successPidCount: 2,
          truncated: false
        }
      },
      {
        name: "localized" as const,
        port: 3187,
        summary: {
          failedPidCount: 1,
          leaderSuccess: true,
          parseComplete: false,
          reasonCategoryCounts: {
            "access-denied": 0,
            "no-running-instance": 0,
            "operation-not-supported": 0,
            other: 1
          },
          successPidCount: 1,
          truncated: false
        }
      },
      {
        name: "truncated" as const,
        port: 3188,
        summary: {
          failedPidCount: 3,
          leaderSuccess: true,
          parseComplete: false,
          reasonCategoryCounts: {
            "access-denied": 1,
            "no-running-instance": 1,
            "operation-not-supported": 1,
            other: 0
          },
          successPidCount: 2,
          truncated: true
        }
      },
      {
        name: "empty" as const,
        port: 3189,
        summary: {
          failedPidCount: 0,
          leaderSuccess: false,
          parseComplete: false,
          reasonCategoryCounts: {
            "access-denied": 0,
            "no-running-instance": 0,
            "operation-not-supported": 0,
            other: 0
          },
          successPidCount: 0,
          truncated: false
        }
      },
      {
        name: "delayed-drain" as const,
        port: 3190,
        summary: {
          failedPidCount: 3,
          leaderSuccess: true,
          parseComplete: true,
          reasonCategoryCounts: {
            "access-denied": 1,
            "no-running-instance": 1,
            "operation-not-supported": 1,
            other: 0
          },
          successPidCount: 2,
          truncated: false
        }
      },
      {
        name: "incomplete-drain" as const,
        port: 32191,
        summary: {
          failedPidCount: 3,
          leaderSuccess: true,
          parseComplete: false,
          reasonCategoryCounts: {
            "access-denied": 1,
            "no-running-instance": 1,
            "operation-not-supported": 1,
            other: 0
          },
          successPidCount: 2,
          truncated: false
        }
      }
    ];

    for (const fixture of fixtures) {
      const run = startTestRunner({
        mode: "exit-zero",
        port: fixture.port,
        serverMode: "spawn-child-unforced",
        treeKillOutput: fixture.name
      });

      await expect(run.exit).resolves.toMatchObject({ code: 1 });
      const workspace = await findMarkedWorkspace(run.marker);
      const stderr = await run.stderr;
      expect(workspace, `${fixture.name}: ${stderr}`).not.toBeNull();
      const receipt = await readTeardownReceipt(workspace!);
      expect(receipt, fixture.name).toMatchObject({
        server: {
          selectedBranch: "taskkill-failed",
          taskkill: { code: 1, outputSummary: fixture.summary }
        }
      });
      const serializedReceipt = JSON.stringify(receipt);
      expect(serializedReceipt).not.toContain("No running instance");
      expect(serializedReceipt).not.toContain("Lokalizovaný důvod");
      expect(stderr).toContain(`"outputSummary":${JSON.stringify(fixture.summary)}`);
      expect(stderr).not.toContain("No running instance");
      expect(stderr).not.toContain("Lokalizovaný důvod");
    }
  }, 15_000);

  it("fails closed and retains its workspace when a descendant tree is explicitly unproven", async () => {
    const port = 3183;
    const run = startTestRunner({ mode: "exit-zero", port, serverMode: "spawn-child" });

    await expect(run.exit).resolves.toMatchObject({ code: 1 });
    await expect(isPortClosed(port)).resolves.toBe(true);
    const workspace = await findMarkedWorkspace(run.marker);
    expect(workspace).not.toBeNull();
    await expect(readTeardownReceipt(workspace!)).resolves.toEqual({
      portProof: { closed: true, required: true },
      server: {
        leaderSettlement: { settled: true },
        pid: expect.any(Number),
        preState: { exitCode: null, signalCode: null, terminal: false },
        selectedBranch: "force-unproven",
        taskkill: null
      },
      version: 1
    });
  });

  it("preserves primary fail-closed diagnostics when atomic receipt persistence fails", async () => {
    for (const [receiptFailure, port] of [["write", 3184], ["rename", 3185]] as const) {
      const run = startTestRunner({
        mode: "exit-zero",
        port,
        receiptFailure,
        serverMode: "spawn-child-unforced",
        treeKillOutput: "partial-success"
      });
      const workspace = await waitForMarkedWorkspace(run.marker);

      await expect(run.exit).resolves.toMatchObject({ code: 1 });
      const stderr = await run.stderr;
      expect(stderr).toContain(`Owned process-tree cleanup could not be proven; retained ${workspace}.`);
      expect(stderr).toContain("Playwright teardown receipt could not be persisted.");
      expect(stderr).toContain('"leaderSuccess":true');
      expect(stderr).not.toContain("No running instance");
      await expect(isPortClosed(port)).resolves.toBe(true);
      await expect(pathExists(workspace)).resolves.toBe(true);
      await expect(pathExists(path.join(workspace, teardownReceiptName))).resolves.toBe(false);
      const receiptTemps = (await readdir(workspace))
        .filter((entry) => entry.startsWith(`${teardownReceiptName}.`) && entry.endsWith(".tmp"));
      expect(receiptTemps).toEqual([]);
    }
  });

  it("rejects every cleanup path outside an exact mkdtemp workspace", () => {
    for (const unsafe of [
      path.join(projectRoot, ".tmp"),
      path.join(projectRoot, ".tmp", "next-playwright-build"),
      path.join(projectRoot, ".tmp", "next-playwright-Ab12Cd", "child"),
      path.join(projectRoot, "next-playwright-Ab12Cd")
    ]) {
      expect(() => assertIsolatedPlaywrightWorkspace(projectRoot, unsafe))
        .toThrow("direct mkdtemp child");
    }
  });
});
