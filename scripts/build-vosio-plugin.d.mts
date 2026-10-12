export function validatePluginEndpoint(value: unknown): string;
// Build a URL-only package by default, or preserve an explicit pre-registered OAuth pair.
export function buildVosioPlugin(options: { url: string; webOrigin: string; publicClientId?: string; callbackUrl?: string; callbackPort?: number; name?: string; out: string; format?: "portable" | "codex" }): string;
