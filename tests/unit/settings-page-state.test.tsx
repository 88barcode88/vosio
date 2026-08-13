import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getInstallationStatus: vi.fn(() => ({
    environment: "preview",
    geminiConfigured: false,
    missingRequiredNames: [],
    ready: true
  })),
  getRecordingStorageConfig: vi.fn(async () => ({
    allowedMimeTypes: ["audio/mpeg"],
    bucketMaxFileSizeBytes: 50_000_000,
    detectedGlobalMaxFileSizeBytes: null,
    maxFileSizeBytes: 50_000_000,
    planMaxFileSizeBytes: null
  })),
  loadCurrentMonthUsageState: vi.fn(async () => ({ error: "Fixture usage unavailable.", summary: null })),
  redirect: vi.fn()
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/installation-status.server", () => ({ getInstallationStatus: mocks.getInstallationStatus }));
vi.mock("@/lib/recordings/storage-config.server", () => ({ getRecordingStorageConfig: mocks.getRecordingStorageConfig }));
vi.mock("@/lib/usage/summary", () => ({ loadCurrentMonthUsageState: mocks.loadCurrentMonthUsageState }));

import SettingsPage from "../../app/settings/page";

// configurePersistedGlobalUser supplies the server-authoritative settings state for page rendering.
function configurePersistedGlobalUser() {
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            email: "user@example.test",
            user_metadata: { vosio_settings: { sonioxRegion: "global" } }
          }
        }
      })
    }
  });
}

describe("settings page action state boundary", () => {
  it("ignores legacy failure query drafts and renders persisted metadata", async () => {
    configurePersistedGlobalUser();

    const element = await SettingsPage({
      searchParams: Promise.resolve({ error: "save_failed", sonioxRegion: "eu" })
    });

    expect(element.props.settingsStatus).toBeNull();
    expect(element.props.userSettings.sonioxRegion).toBe("global");
    expect(element.props).not.toHaveProperty("settingsPresentationKey");
  });

  it("accepts only the exact success marker as initial feedback", async () => {
    configurePersistedGlobalUser();
    const element = await SettingsPage({ searchParams: Promise.resolve({ saved: "1" }) });
    expect(element.props.settingsStatus).toBe("saved");
  });
});
