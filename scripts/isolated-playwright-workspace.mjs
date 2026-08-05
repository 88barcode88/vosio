import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const workspaceNamePattern = /^next-playwright-[a-zA-Z0-9]{6}$/u;
const copiedDirectories = ["app", "public", "src"];
const copiedFiles = [
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
  "proxy.ts",
  "tsconfig.json"
];

// pathExists keeps optional project entries out of the isolated copy when they are absent.
export async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

// assertIsolatedPlaywrightWorkspace restricts cleanup to one direct mkdtemp child under repo .tmp.
export function assertIsolatedPlaywrightWorkspace(sourceRoot, candidate) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedCandidate = path.resolve(candidate);
  const expectedParent = path.join(resolvedSourceRoot, ".tmp");

  if (
    path.dirname(resolvedCandidate) !== expectedParent
    || !workspaceNamePattern.test(path.basename(resolvedCandidate))
  ) {
    throw new Error("Playwright workspace must be one direct mkdtemp child under the repository .tmp.");
  }
  return resolvedCandidate;
}

// createIsolatedPlaywrightWorkspace atomically creates and optionally populates one whitelisted project copy.
export async function createIsolatedPlaywrightWorkspace(sourceRoot, { copyProject = true } = {}) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const tempRoot = path.join(resolvedSourceRoot, ".tmp");
  await mkdir(tempRoot, { recursive: true });
  const workspace = assertIsolatedPlaywrightWorkspace(
    resolvedSourceRoot,
    await mkdtemp(path.join(tempRoot, "next-playwright-"))
  );

  if (!copyProject) return workspace;

  try {
    for (const directory of copiedDirectories) {
      const source = path.join(resolvedSourceRoot, directory);
      if (await pathExists(source)) {
        await cp(source, path.join(workspace, directory), { recursive: true });
      }
    }

    for (const file of copiedFiles) {
      const source = path.join(resolvedSourceRoot, file);
      if (await pathExists(source)) {
        await cp(source, path.join(workspace, file));
      }
    }
  } catch (error) {
    await cleanupIsolatedPlaywrightWorkspace(resolvedSourceRoot, workspace);
    throw error;
  }

  return workspace;
}

// cleanupIsolatedPlaywrightWorkspace retries transient Windows locks only for an exact guarded workspace.
export async function cleanupIsolatedPlaywrightWorkspace(sourceRoot, candidate) {
  const workspace = assertIsolatedPlaywrightWorkspace(sourceRoot, candidate);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await rm(workspace, { force: true, recursive: true });
      return;
    } catch (error) {
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code) || attempt === 49) {
        throw error;
      }
      await delay(100);
    }
  }
}
