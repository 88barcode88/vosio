import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  })
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("redirects only a missing session to login", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) }
    });

    await expect(SettingsPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("REDIRECT:/login?next=/settings");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/settings");
  });

  it.each([
    ["missing email", { user_metadata: {} }],
    ["invalid email", { email: "not-an-email", user_metadata: {} }]
  ])("renders a stable fail-closed state for an authenticated account with %s", async (_name, user) => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }
    });

    const element = await SettingsPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(element);

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("Nastavení účtu není dostupné");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('name="currentPassword"');
    expect(mocks.loadCurrentMonthUsageState).not.toHaveBeenCalled();
  });
});
