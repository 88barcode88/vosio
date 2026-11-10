// Keeps the MV3 service worker alive during long operations by calling a cheap extension API (workers idle for 30 s are killed).

export const KEEP_ALIVE_MS = 20_000;

// Starts periodic keep-alive pings and returns a function that stops them; failures of the ping API are ignored.
export function startKeepAlive(): () => void {
  const timer = setInterval(() => {
    try {
      void chrome.runtime.getPlatformInfo().catch(() => undefined);
    } catch {
      // API unavailable (older browser or test stub): the worker simply relies on pending-request lifetime.
    }
  }, KEEP_ALIVE_MS);
  return () => clearInterval(timer);
}
