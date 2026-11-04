import { describe, expect, it } from "vitest";
import { canonicalizeTrashSearchParams } from "@/lib/recordings/trash-navigation";

describe("trash route state", () => {
  it("allows one known action error and strips unknown or duplicate values", () => {
    const known = canonicalizeTrashSearchParams(new URLSearchParams("error=restore_failed"));
    expect(known.actionAlert).toBe("Nahrávku se nepodařilo obnovit. Zkuste to znovu.");
    expect(known.changed).toBe(false);
    expect(known.searchParams.toString()).toBe("error=restore_failed");
    expect(canonicalizeTrashSearchParams(new URLSearchParams("error=private-secret"))).toMatchObject({
      actionAlert: null,
      changed: true
    });
    expect(canonicalizeTrashSearchParams(new URLSearchParams("error=purge_failed&error=purge_failed"))).toMatchObject({
      actionAlert: null,
      changed: true
    });
    expect(canonicalizeTrashSearchParams(new URLSearchParams("private=secret"))).toMatchObject({
      actionAlert: null,
      changed: true
    });
  });

  it("explains an active purge and drops the retired 24-hour purge error code", () => {
    expect(canonicalizeTrashSearchParams(new URLSearchParams("error=purge_in_progress")).actionAlert)
      .toContain("mazání už probíhá");
    expect(canonicalizeTrashSearchParams(new URLSearchParams("error=purge_too_recent")).actionAlert)
      .toBeNull();
  });
});
