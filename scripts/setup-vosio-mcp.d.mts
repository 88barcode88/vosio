export function setupOrigin(value: unknown, internal?: boolean): string;
export function hostedServiceKey(projectRef: string, managementToken: string, fetcher?: typeof fetch): Promise<string>;
export function setupVosioMcp(options: Record<string, unknown>, client: unknown, journal?: unknown): Promise<{ mode: string; webOrigin: string; publicSupabaseUrl: string; resourceUrl: string; upstreamClientId: string | null; enabled: boolean; secretsPresent: boolean; downstreamClientId: string | null }>;
export function receiptStore(path: string): { acquire(): void; release(): void; load(): Record<string, unknown> | null; save(receipt: unknown): void };
export function createSetupClient(options: Record<string, unknown>, fetcher?: typeof fetch): {
  installation(action: string, payload?: Record<string, unknown>): Promise<unknown>;
  register(payload: Record<string, unknown>): Promise<unknown>;
  downstreamClient(id: string): Promise<unknown>;
  getClient(id: string): Promise<unknown>;
  createClient(payload: Record<string, unknown>): Promise<unknown>;
  preflight(): Promise<unknown>;
  putSecrets(values: Record<string, string>): Promise<unknown>;
};
