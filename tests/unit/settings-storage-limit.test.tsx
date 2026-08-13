import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/settings-panel";
import { defaultUserSettings } from "@/lib/settings/types";

vi.mock("@/lib/settings/actions", () => ({
  updateUserSettingsAction: vi.fn()
}));

const MEBIBYTE = 1024 * 1024;

describe("settings storage limit", () => {
  it("renders the selected Supabase preference with effective limits", () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        installationStatus={{
          environment: "development",
          geminiConfigured: false,
          missingRequiredNames: [],
          ready: true
        }}
        recordingStorageConfig={{
          allowedMimeTypes: ["audio/mpeg"],
          bucketMaxFileSizeBytes: 100 * MEBIBYTE,
          detectedGlobalMaxFileSizeBytes: null,
          maxFileSizeBytes: 50 * MEBIBYTE,
          planMaxFileSizeBytes: 50 * MEBIBYTE
        }}
        settings={{ ...defaultUserSettings, supabaseStoragePlan: "free" }}
        status={null}
        usageState={{ error: "Usage unavailable.", summary: null }}
      />
    );

    expect(markup).toContain('name="supabaseStoragePlan"');
    expect(markup).toContain('<option value="free" selected="">Free</option>');
    expect(markup).toContain("Efektivní limit manuálního uploadu");
    expect(markup).toContain("50 MB");
    expect(markup).toContain("Technické informace");
    expect(markup).not.toContain("Globální limit projektu");
  });
});
