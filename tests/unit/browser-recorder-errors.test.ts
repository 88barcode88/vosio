import { describe, expect, it } from "vitest";
import { getRealtimeConfigErrorMessage } from "@/components/browser-recorder/helpers";

describe("browser recorder realtime configuration errors", () => {
  it("explains EU project access and includes the provider request id", () => {
    expect(getRealtimeConfigErrorMessage("soniox_eu_access_required", "req-eu-403")).toBe(
      "EU region Soniox vyžaduje EU Soniox projekt a odpovídající regionální API key. " +
      "Kontaktujte support@soniox.com. ID požadavku: req-eu-403."
    );
  });

  it("does not invent a request id when the provider omitted it", () => {
    const message = getRealtimeConfigErrorMessage("soniox_eu_access_required");

    expect(message).toBe(
      "EU region Soniox vyžaduje EU Soniox projekt a odpovídající regionální API key. " +
      "Kontaktujte support@soniox.com."
    );
    expect(message).not.toContain("ID požadavku");
    expect(message).not.toContain("undefined");
  });

  it("keeps the global authentication/configuration message generic", () => {
    const message = getRealtimeConfigErrorMessage("soniox_auth_or_region", "req-global-401");

    expect(message).toBe("Soniox API key neodpovídá nastavenému regionu.");
    expect(message).not.toContain("EU projekt");
    expect(message).not.toContain("support@soniox.com");
    expect(message).not.toContain("req-global-401");
  });
});
