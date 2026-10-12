export function validateWebOrigin(value: string): string;
export function readInstallation(webOrigin: string, metadata: unknown): { serverName: string; webOrigin: string; mcpUrl: string };
export function discoverInstallation(webOrigin: string, fetcher?: typeof fetch): Promise<{ serverName: string; webOrigin: string; mcpUrl: string }>;
