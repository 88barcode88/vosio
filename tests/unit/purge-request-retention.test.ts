// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { retainPurgeRequest, listRetainedPurgeRequests, forgetPurgeRequest } from "@/lib/recordings/purge-request-retention";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => localStorage.clear());
it("retains the random request key before prepare and reuses it across lost responses/reloads", () => {
  const request = retainPurgeRequest(id, "2026-09-20T00:00:00Z");
  expect(listRetainedPurgeRequests()).toEqual([request]);
  expect(retainPurgeRequest(id, "2026-09-21T00:00:00Z")).toEqual(request);
  forgetPurgeRequest(id, request.requestId);
  expect(listRetainedPurgeRequests()).toEqual([]);
});
it("fails closed before any prepare if durable persistence is unavailable", () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(() => retainPurgeRequest(id, "2026-09-20T00:00:00Z")).toThrow(); spy.mockRestore();
});
it("stores each request under its own key so another tab cannot overwrite an uncertain receipt", () => {
  const request = retainPurgeRequest(id, "2026-09-20T00:00:00Z");
  expect(localStorage.getItem(`vosio:manual-purge:${request.requestId}`)).toBe(JSON.stringify(request));
});
