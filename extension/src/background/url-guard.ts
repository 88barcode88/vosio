// Validation of URLs received from the server before the extension fetches or opens them.

// Tells whether a URL is HTTPS and has exactly the given origin (used for signed upload URLs).
export function isHttpsOnOrigin(url: unknown, origin: string): boolean {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.origin === origin;
  } catch {
    return false;
  }
}

// Returns the detail URL only when it is HTTPS on the Vosio web origin of the installation; otherwise null (never opened).
export function safeDetailUrl(url: unknown, webOrigin: string): string | null {
  return isHttpsOnOrigin(url, webOrigin) ? (url as string) : null;
}
