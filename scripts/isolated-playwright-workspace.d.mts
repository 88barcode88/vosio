export function pathExists(candidate: string): Promise<boolean>;
export function assertIsolatedPlaywrightWorkspace(sourceRoot: string, candidate: string): string;
export function createIsolatedPlaywrightWorkspace(
  sourceRoot: string,
  options?: { copyProject?: boolean }
): Promise<string>;
export function cleanupIsolatedPlaywrightWorkspace(sourceRoot: string, candidate: string): Promise<void>;
