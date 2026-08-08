import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import type { RecordingMarkerRequest, RecordingMarkerRow } from "../../src/lib/recording-markers/types";

const recordingId = "00000000-0000-4000-8000-000000000302";
const transcriptId = "00000000-0000-4000-8000-000000000301";
const userId = "00000000-0000-4000-8000-000000000303";

type CapturedBoundary = {
  liveTranscriptRequests: unknown[];
  markerRequests: RecordingMarkerRequest[];
  markerResponseMode?: "fail-first" | "hold-first";
  releaseHeldMarker?: () => void;
  heldMarkerResponseSettled?: Promise<void>;
  recordingUpdates: unknown[];
};

// createFixtureScope isolates browser projects while retaining one provider across client navigation.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// createSavedMarkerRow maps the actual BrowserRecorder request into the mocked HTTP response row.
function createSavedMarkerRow(
  request: RecordingMarkerRequest,
  index: number
): RecordingMarkerRow {
  const timestamp = "2026-08-05T10:00:00.000Z";

  return {
    client_marker_id: request.clientMarkerId,
    created_at: timestamp,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    marker_type: request.markerType,
    note: request.note,
    offset_ms: request.offsetMs,
    recording_id: recordingId,
    updated_at: timestamp,
    user_id: userId
  };
}

// createBoundaryPayload returns only data captured at HTTP boundaries to the real timeline component.
function createBoundaryPayload(markerRequests: RecordingMarkerRequest[]) {
  return {
    markers: markerRequests.map(createSavedMarkerRow),
    recording: {
      audioAvailability: "none",
      created_at: "2026-08-05T10:00:00.000Z",
      duration_seconds: 2,
      file_size_bytes: 0,
      id: recordingId,
      mime_type: null,
      source_type: "realtime",
      status: "completed",
      title: "Live marker fixture",
      updated_at: "2026-08-05T10:00:02.000Z"
    },
    transcript: {
      created_at: "2026-08-05T10:00:02.000Z",
      id: transcriptId,
      language: "cs",
      raw_text: "První část. Druhý označený moment.",
      recording_id: recordingId,
      segments: [
        { end_ms: 500, speaker: 1, start_ms: 0, text: "První část." },
        { end_ms: 2_000, speaker: 2, start_ms: 1_000, text: "Druhý označený moment." }
      ],
      speakers: [],
      transcription_job_id: null,
      user_id: userId
    }
  };
}

// installBrowserMediaBoundaries replaces microphone and MediaRecorder APIs before React initializes.
async function installBrowserMediaBoundaries(page: Page) {
  await page.addInitScript(() => {
    class FixtureMediaRecorder extends EventTarget {
      static isTypeSupported() {
        return true;
      }

      audioBitsPerSecond = 128_000;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      state: "inactive" | "recording" = "inactive";

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([], { type: "audio/webm" }) });
        this.dispatchEvent(new Event("stop"));
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FixtureMediaRecorder
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => undefined }]
        })
      }
    });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => ({
          addEventListener: () => undefined,
          release: async () => undefined
        })
      }
    });
  });
}

// installHttpBoundaries captures persistence calls without touching live Supabase or application APIs.
async function installHttpBoundaries(page: Page, boundary: CapturedBoundary) {
  await page.route("**/auth/v1/user", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        app_metadata: { provider: "email", providers: ["email"] },
        aud: "authenticated",
        created_at: "2026-08-05T10:00:00.000Z",
        email: "fixture@vosio.test",
        id: userId,
        role: "authenticated",
        user_metadata: {}
      },
      status: 200
    });
  });

  await page.route("**/rest/v1/recordings**", async (route) => {
    const method = route.request().method();

    if (method === "POST") {
      await route.fulfill({ contentType: "application/json", json: { id: recordingId }, status: 201 });
      return;
    }

    if (method === "PATCH") {
      boundary.recordingUpdates.push(route.request().postDataJSON());
      await route.fulfill({ contentType: "application/json", json: {}, status: 200 });
      return;
    }

    await route.fulfill({ contentType: "application/json", json: [], status: 200 });
  });

  await page.route(`**/api/recordings/${recordingId}/markers`, async (route) => {
    const request = route.request().postDataJSON() as RecordingMarkerRequest;
    boundary.markerRequests.push(request);
    const requestIndex = boundary.markerRequests.length - 1;

    if (boundary.markerResponseMode === "fail-first" && requestIndex === 0) {
      await route.fulfill({ status: 500 });
      return;
    }

    if (boundary.markerResponseMode === "hold-first" && requestIndex === 0) {
      let resolveHeldMarkerResponse!: () => void;
      boundary.heldMarkerResponseSettled = new Promise<void>((resolve) => {
        resolveHeldMarkerResponse = resolve;
      });

      await new Promise<void>((resolve) => {
        boundary.releaseHeldMarker = resolve;
      });

      try {
        await route.fulfill({
          contentType: "application/json",
          json: { marker: createSavedMarkerRow(request, requestIndex) },
          status: 201
        });
      } finally {
        resolveHeldMarkerResponse();
      }

      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: { marker: createSavedMarkerRow(request, requestIndex) },
      status: 201
    });
  });

  await page.route(`**/api/recordings/${recordingId}/live-draft`, async (route) => {
    await route.fulfill({ contentType: "application/json", json: { ok: true }, status: 200 });
  });

  await page.route(`**/api/recordings/${recordingId}/live-transcript`, async (route) => {
    boundary.liveTranscriptRequests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", json: { ok: true }, status: 200 });
  });

  await page.route("**/api/live-marker-e2e/state**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: createBoundaryPayload(boundary.markerRequests),
      status: 200
    });
  });
}

// boxesOverlap reports whether two visible controls intercept the same viewport area.
function boxesOverlap(
  left: { height: number; width: number; x: number; y: number },
  right: { height: number; width: number; x: number; y: number }
) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

test("actual persistent recorder saves two markers and opens both from timeline", async ({ page }, testInfo) => {
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [],
    markerRequests: [],
    recordingUpdates: []
  };
  const scope = createFixtureScope();

  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${scope}`);
  await expect(page.locator('[data-e2e-live-marker-state="full"]')).toBeVisible();

  await page.getByRole("button", { name: "Nahrávat live" }).click();
  const recordingOptions = page.locator("[data-e2e-recording-options]");
  await expect(recordingOptions).not.toHaveAttribute("data-e2e-recording-options", "");
  const defaultOptions = JSON.parse(
    await recordingOptions.getAttribute("data-e2e-recording-options")
      ?? "null"
  );
  expect(defaultOptions).toMatchObject({
    enable_language_identification: true,
    enable_speaker_diarization: true
  });
  expect(defaultOptions).not.toHaveProperty("language_hints");
  expect(defaultOptions).not.toHaveProperty("language_hints_strict");
  const fullMarker = page.getByRole("button", { name: "Označit moment" });
  await expect(fullMarker).toBeEnabled();
  await expect(page.getByText("Označené momenty: 0")).toBeVisible();
  await fullMarker.click();
  await expect.poll(() => boundary.markerRequests.length).toBe(1);
  await expect(page.getByText("Označené momenty: 1")).toBeVisible();

  await page.getByRole("link", { name: "Přejít na jinou stránku" }).click();
  await expect(page).toHaveURL(new RegExp(`scope=${scope}&view=away`));
  const dock = page.locator(".persistent-recorder-dock:not([hidden])");
  await expect(dock).toBeVisible();
  await expect(dock.locator(".browser-recorder-compact")).toBeVisible();

  await page.waitForTimeout(1_100);
  const compactMarker = dock.getByRole("button", { name: "Označit moment" });

  if (testInfo.project.name === "mobile-chrome") {
    const stopButton = dock.getByRole("button", { name: "Zastavit" });
    const mobileNav = page.getByRole("navigation", { name: "Mobilní navigace" });
    const [dockBox, markerBox, stopBox, navBox] = await Promise.all([
      dock.boundingBox(),
      compactMarker.boundingBox(),
      stopButton.boundingBox(),
      mobileNav.boundingBox()
    ]);

    expect(dockBox).not.toBeNull();
    expect(markerBox).not.toBeNull();
    expect(stopBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(boxesOverlap(markerBox!, stopBox!)).toBe(false);
    expect(boxesOverlap(dockBox!, navBox!)).toBe(false);
    expect(boxesOverlap(markerBox!, navBox!)).toBe(false);
    expect(boxesOverlap(stopBox!, navBox!)).toBe(false);
  }

  await compactMarker.click();
  await expect.poll(() => boundary.markerRequests.length).toBe(2);
  await expect(dock.getByText("Označené momenty: 2")).toBeVisible();
  await dock.getByRole("button", { name: "Zastavit" }).click();
  await expect(dock).toBeHidden();
  await expect.poll(() => boundary.liveTranscriptRequests.length).toBe(1);
  await expect.poll(() => boundary.recordingUpdates.length).toBe(1);

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  expect(boundary.markerRequests).toHaveLength(2);
  expect(boundary.markerRequests.map((request) => request.clientMarkerId))
    .toEqual([expect.stringMatching(uuidPattern), expect.stringMatching(uuidPattern)]);
  expect(new Set(boundary.markerRequests.map((request) => request.clientMarkerId)).size).toBe(2);
  expect(boundary.markerRequests.every((request) => (
    request.markerType === "important"
      && request.note === null
      && Number.isInteger(request.offsetMs)
      && request.offsetMs >= 0
  ))).toBe(true);
  expect(boundary.markerRequests[1]!.offsetMs).toBeGreaterThan(boundary.markerRequests[0]!.offsetMs);

  await page.getByRole("button", { name: "Načíst uloženou timeline" }).click();
  await expect(page.locator('[data-e2e-live-marker-state="timeline"]')).toBeVisible();
  await expect(page.locator(".timeline-marker-row")).toHaveCount(2);

  await page.locator(".timeline-marker-row").nth(0).click();
  await expect(page.locator("#transcript-at-0")).toHaveAttribute("aria-current", "true");
  await expect(page.locator("audio")).toHaveCount(0);

  await page.getByRole("tab", { name: "Časová osa" }).click();
  await page.locator(".timeline-marker-row").nth(1).click();
  await expect(page.locator("#transcript-at-1000")).toHaveAttribute("aria-current", "true");
  await expect(page.locator("audio")).toHaveCount(0);
});

test("passes the selected live language only at the recording start boundary", async ({ page }) => {
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [],
    markerRequests: [],
    recordingUpdates: []
  };
  const scope = createFixtureScope();

  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${scope}`);

  const languageSelect = page.getByLabel("Jazyk live přepisu");
  await expect(languageSelect).toHaveValue("auto");
  await languageSelect.selectOption("de");
  await page.getByRole("button", { name: "Nahrávat live" }).click();

  const recordingOptions = page.locator("[data-e2e-recording-options]");
  await expect(recordingOptions).not.toHaveAttribute("data-e2e-recording-options", "");
  const selectedOptions = JSON.parse(
    await recordingOptions.getAttribute("data-e2e-recording-options")
      ?? "null"
  );
  expect(selectedOptions).toMatchObject({
    enable_language_identification: true,
    enable_speaker_diarization: true,
    language_hints: ["de"],
    language_hints_strict: true
  });
  await expect(languageSelect).toHaveCount(0);

  await page.getByRole("button", { name: "Zastavit" }).click();
  await expect(recordingOptions).toHaveAttribute(
    "data-e2e-recording-options",
    /language_hints/
  );
});

test("counts only a marker that succeeds after a failed retry", async ({ page }) => {
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [],
    markerRequests: [],
    markerResponseMode: "fail-first",
    recordingUpdates: []
  };
  const scope = createFixtureScope();

  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${scope}`);
  await page.getByRole("button", { name: "Nahrávat live" }).click();

  const marker = page.getByRole("button", { name: "Označit moment" });
  await expect(marker).toBeEnabled();
  await expect(page.getByText("Označené momenty: 0")).toBeVisible();
  await marker.click();
  await expect.poll(() => boundary.markerRequests.length).toBe(1);
  await expect(page.getByText("Označené momenty: 0")).toBeVisible();

  const retry = page.getByRole("button", { name: "Zkusit moment znovu" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => boundary.markerRequests.length).toBe(2);
  await expect(page.getByText("Označené momenty: 1")).toBeVisible();
});

test("resets the count for a new session and ignores a stale marker response", async ({ page }) => {
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [],
    markerRequests: [],
    markerResponseMode: "hold-first",
    recordingUpdates: []
  };
  const scope = createFixtureScope();

  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${scope}`);
  await page.getByRole("button", { name: "Nahrávat live" }).click();

  const marker = page.getByRole("button", { name: "Označit moment" });
  await expect(marker).toBeEnabled();
  await marker.click();
  await expect.poll(() => Boolean(boundary.releaseHeldMarker && boundary.heldMarkerResponseSettled)).toBe(true);

  await page.getByRole("button", { name: "Zastavit" }).click();
  await expect(page.getByRole("button", { name: "Nahrávat live" })).toBeVisible();
  await page.getByRole("button", { name: "Nahrávat live" }).click();
  await expect(page.getByText("Označené momenty: 0")).toBeVisible();

  expect(boundary.releaseHeldMarker).toBeDefined();
  expect(boundary.heldMarkerResponseSettled).toBeDefined();
  boundary.releaseHeldMarker!();
  await boundary.heldMarkerResponseSettled!;
  await expect(page.getByText("Označené momenty: 0")).toBeVisible();
});
