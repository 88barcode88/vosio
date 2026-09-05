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
  storageEvents?: string[];
  transcriptionRequests?: string[];
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
    class FixtureMediaStreamTrack extends EventTarget {
      kind = "audio";
      muted = false;
      readyState: "live" | "ended" = "live";

      // clone creates an independently owned synthetic audio track.
      clone() {
        return new FixtureMediaStreamTrack();
      }

      // stop ends only this synthetic track instance.
      stop() {
        this.readyState = "ended";
      }
    }

    class FixtureMediaStream {
      // constructor stores the tracks owned by this synthetic stream.
      constructor(private readonly tracks: FixtureMediaStreamTrack[] = []) {}

      // clone gives the rotating safety recorder an isolated synthetic stream.
      clone() {
        return new FixtureMediaStream(this.tracks.map((track) => track.clone()));
      }

      // getAudioTracks returns all synthetic audio tracks.
      getAudioTracks() {
        return this.tracks.filter((track) => track.kind === "audio");
      }

      // getTracks returns a defensive copy for independent cleanup.
      getTracks() {
        return [...this.tracks];
      }
    }

    class FixtureMediaRecorder extends EventTarget {
      // isTypeSupported accepts the fixture's deterministic WebM container.
      static isTypeSupported() {
        return true;
      }

      audioBitsPerSecond: number;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      state: "inactive" | "recording" = "inactive";

      // constructor records bitrate options for the synthetic archive, provider, and safety encoders.
      constructor(_stream: FixtureMediaStream, options: MediaRecorderOptions = {}) {
        super();
        this.audioBitsPerSecond = options.audioBitsPerSecond ?? 128_000;
        const fixtureWindow = window as typeof window & {
          __fixtureMediaRecorderBitrates?: number[];
        };
        fixtureWindow.__fixtureMediaRecorderBitrates = [
          ...(fixtureWindow.__fixtureMediaRecorderBitrates ?? []),
          this.audioBitsPerSecond
        ];
      }

      // start marks this synthetic encoder as active.
      start() {
        this.state = "recording";
      }

      // stop emits the same terminal events consumed by BrowserRecorder.
      stop() {
        this.state = "inactive";
        const data = new Blob(["fixture-audio"], { type: "audio/webm" });
        this.ondataavailable?.({ data });
        this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
        this.dispatchEvent(new Event("stop"));
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FixtureMediaRecorder
    });
    Object.defineProperty(window, "MediaStream", {
      configurable: true,
      value: FixtureMediaStream
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => new FixtureMediaStream([new FixtureMediaStreamTrack()])
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
      await route.fulfill({ contentType: "application/json", json: { id: recordingId }, status: 200 });
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

  await page.route(`**/api/recordings/${recordingId}/transcription**`, async (route) => {
    boundary.transcriptionRequests?.push(route.request().url());
    await route.fulfill({ contentType: "application/json", json: { job: { id: "fixture-job" } }, status: 202 });
  });

  await page.route("**/api/recordings/recoverable", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { ownerId: userId, recordings: [] },
      status: 200
    });
  });

  await page.route("**/storage/v1/object/**", async (route) => {
    const request = route.request();
    const url = request.url();

    if (url.includes("/object/list/")) {
      await route.fulfill({ contentType: "application/json", json: [], status: 200 });
      return;
    }

    if (request.method() === "DELETE") {
      boundary.storageEvents?.push("remote-cleanup");
      const prefixes = (request.postDataJSON() as { prefixes?: string[] } | null)?.prefixes ?? [];
      await route.fulfill({
        contentType: "application/json",
        json: prefixes.map((name) => ({ name })),
        status: 200
      });
      return;
    }

    if (request.method() === "POST") {
      boundary.storageEvents?.push(url.includes("part-") ? "safety-upload" : "archive-upload");
      await route.fulfill({ contentType: "application/json", json: { Key: url }, status: 200 });
      return;
    }

    await route.fulfill({ contentType: "application/json", json: {}, status: 200 });
  });

  await page.route("**/api/live-marker-e2e/state**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: createBoundaryPayload(boundary.markerRequests),
      status: 200
    });
  });
}

test("reduced motion removes recorder transitions and the pressed transform", async ({ page }) => {
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [], markerRequests: [], recordingUpdates: []
  };

  await page.emulateMedia({ reducedMotion: "reduce" });
  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${createFixtureScope()}`);
  await expect(page.getByRole("group", { name: "Nastavení live nahrávání" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Ovládání live nahrávání" })).toBeVisible();
  const recordButton = page.getByRole("button", { name: "Nahrávat live" });
  await expect(recordButton).toBeVisible();
  await expect.poll(() => recordButton.evaluate((element) => (
    getComputedStyle(element).transitionDuration
  ))).toBe("0s");

  await recordButton.hover();
  await page.mouse.down();
  try {
    expect(await recordButton.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
  } finally {
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
});

test("provider loss keeps audio and markers alive before restart-safe fallback", async ({ page }) => {
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [], markerRequests: [], recordingUpdates: [],
    storageEvents: [], transcriptionRequests: []
  };
  const scope = createFixtureScope();

  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${scope}`);
  await page.getByRole("button", { name: "Nahrávat live" }).click();
  await page.getByRole("button", { name: "Simulovat výpadek přepisu" }).click();
  await expect(page.locator('[data-recorder-health="audio"]')).toContainText("Audio se nahrává");
  await expect(page.locator('[data-recorder-health="provider"]')).toHaveText(
    "Live přepis: Zrušený. Audio se dál nahrává."
  );
  await page.getByRole("button", { name: "Označit moment" }).click();
  await expect.poll(() => boundary.markerRequests.length).toBe(1);
  await page.getByRole("button", { name: "Zastavit" }).click();
  await expect.poll(() => boundary.transcriptionRequests?.length ?? 0).toBe(1);
  expect(boundary.transcriptionRequests![0]).toContain("restart=1");
});

test("audio limit finalizes archive before exact remote and local safety cleanup", async ({ page }) => {
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [], markerRequests: [], recordingUpdates: [],
    storageEvents: [], transcriptionRequests: []
  };
  const scope = createFixtureScope();

  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${scope}&scenario=audio-limit`);
  await page.getByRole("button", { name: "Nahrávat live" }).click();
  await expect(page.getByRole("button", { name: "Nahrávat live" })).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => boundary.recordingUpdates.length).toBe(1);
  expect(boundary.storageEvents).toEqual(["safety-upload", "archive-upload", "remote-cleanup"]);
  await expect.poll(async () => page.evaluate(async () => {
    const request = indexedDB.open("vosio-live-audio");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction("safety_parts", "readonly");
      const getAll = transaction.objectStore("safety_parts").getAll();
      getAll.onsuccess = () => resolve(getAll.result);
      getAll.onerror = () => reject(getAll.error);
    });
    database.close();
    return rows.length;
  })).toBe(0);
});

test("reload keeps a locally durable safety part recoverable", async ({ page }) => {
  test.setTimeout(60_000);
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [], markerRequests: [], recordingUpdates: []
  };
  const scope = createFixtureScope();

  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${scope}`);
  await page.getByRole("button", { name: "Nahrávat live" }).click();
  await page.waitForTimeout(15_500);
  await page.goto(`/login/live-marker-e2e?scope=${scope}&view=recovery`);
  await expect(page.getByText("Nedokončené live nahrávky")).toBeVisible();
  await expect(page.getByText("Lokálně uložená live nahrávka")).toBeVisible();
});

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

for (const width of [375, 768]) {
test(`${width}px product shell keeps the actual persistent recorder dock above clickable mobile navigation`, async ({ page }, testInfo) => {
  const boundary: CapturedBoundary = {
    liveTranscriptRequests: [],
    markerRequests: [],
    recordingUpdates: []
  };
  const scope = createFixtureScope();

  await page.setViewportSize({ width, height: 760 });
  await installBrowserMediaBoundaries(page);
  await installHttpBoundaries(page, boundary);
  await page.goto(`/login/live-marker-e2e?scope=${scope}`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page.locator('[data-e2e-live-marker-state="full"]')).toBeVisible();
  await page.getByRole("button", { name: "Nahrávat live" }).click();
  await page.getByRole("link", { name: "Přejít na jinou stránku" }).click();
  await expect(page).toHaveURL(new RegExp(`scope=${scope}&view=away`));

  const dock = page.locator(".persistent-recorder-dock:not([hidden])");
  const mobileNav = page.getByRole("navigation", { name: "Mobilní navigace" });
  await expect(dock).toBeVisible();
  await expect(mobileNav).toBeVisible();
  const [dockBox, navBox] = await Promise.all([dock.boundingBox(), mobileNav.boundingBox()]);
  expect(dockBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(boxesOverlap(dockBox!, navBox!)).toBe(false);
  expect(dockBox!.x).toBeGreaterThanOrEqual(0);
  expect(dockBox!.y).toBeGreaterThanOrEqual(0);
  expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(width);
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(760);

  const navigationTargets = mobileNav.locator(":scope > a, :scope > button");
  await expect(navigationTargets).toHaveCount(5);
  const navigationHitStates = await navigationTargets.evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return {
        hit: hit === element || element.contains(hit),
        label: element.textContent?.trim() ?? ""
      };
    }));
  expect(navigationHitStates).toEqual(navigationHitStates.map((state) => ({ ...state, hit: true })));
  await page.screenshot({ path: testInfo.outputPath(`shell-${width}-active-dock.png`) });
  await mobileNav.getByRole("button", { name: "Více" }).click();
  await expect(page.getByRole("dialog", { name: "Další možnosti" })).toBeVisible();
  await page.keyboard.press("Escape");
  await dock.getByRole("button", { name: "Zastavit" }).click();
  await expect(dock).toBeHidden();
});
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
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __fixtureMediaRecorderBitrates?: number[] })
      .__fixtureMediaRecorderBitrates ?? []
  ))).toEqual([96_000, 128_000, 96_000]);
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
  const openRecording = dock.getByRole("link", { name: "Otevřít nahrávání" });
  await expect(openRecording).toHaveAttribute("data-touch-target", "action");
  const openRecordingBox = await openRecording.boundingBox();
  expect(openRecordingBox).not.toBeNull();
  expect(openRecordingBox!.height).toBeGreaterThanOrEqual(43.5);
  expect(openRecordingBox!.width).toBeGreaterThanOrEqual(43.5);

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
