import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const recordingId = "00000000-0000-4000-8000-000000000201";
const clientId = "00000000-0000-4000-8000-000000000204";
const tagId = "00000000-0000-4000-8000-000000000205";

// createFixtureScope keeps concurrent desktop and mobile fixture URLs isolated.
function createFixtureScope() {
  return randomBytes(6).toString("hex").slice(0, 11);
}

test("opens one owned current search result at its transcript without autoplay", async ({ page }) => {
  test.slow();
  const scope = createFixtureScope();

  await page.addInitScript(() => {
    const state = window as typeof window & {
      __searchHighlightSeen?: boolean;
      __searchHighlightText?: string;
      __searchHighlightObserver?: MutationObserver;
      __searchPlayCalls?: number;
      __searchReadyState?: number;
      __searchSeekSeconds?: number;
      __searchSeekWrites?: number;
    };
    state.__searchHighlightSeen = window.sessionStorage.getItem("search-highlight-seen") === "1";
    state.__searchHighlightText = window.sessionStorage.getItem("search-highlight-text") ?? "";
    state.__searchPlayCalls = 0;
    state.__searchReadyState = 0;
    state.__searchSeekSeconds = 0;
    state.__searchSeekWrites = Number(window.sessionStorage.getItem("search-seek-writes") ?? "0");
    const watchHighlight = () => {
      const inspectHighlight = () => {
        const row = document.querySelector("#transcript-at-8000");

        if (row?.getAttribute("aria-current") === "true") {
          state.__searchHighlightSeen = true;
          state.__searchHighlightText = row.querySelector("mark")?.textContent ?? "";
          window.sessionStorage.setItem("search-highlight-seen", "1");
          window.sessionStorage.setItem("search-highlight-text", state.__searchHighlightText);
        }
      };
      state.__searchHighlightObserver = new MutationObserver(inspectHighlight);
      state.__searchHighlightObserver.observe(document, {
        attributeFilter: ["aria-current"],
        attributes: true,
        childList: true,
        subtree: true
      });
      inspectHighlight();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", watchHighlight, { once: true });
    } else {
      watchHighlight();
    }
    Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 60 });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => state.__searchReadyState ?? 0
    });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => state.__searchSeekSeconds ?? 0,
      set: (value: number) => {
        state.__searchSeekSeconds = value;
        state.__searchSeekWrites = (state.__searchSeekWrites ?? 0) + 1;
        window.sessionStorage.setItem("search-seek-writes", String(state.__searchSeekWrites));
      }
    });
    HTMLMediaElement.prototype.play = async function play() {
      state.__searchPlayCalls = (state.__searchPlayCalls ?? 0) + 1;
    };
  });
  await page.route("**/api/recordings/*/audio", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { expiresIn: 300, mimeType: "audio/wav", url: "https://media.vosio.test/search.wav" }
    });
  });
  await page.route("https://media.vosio.test/search.wav", async (route) => {
    await route.fulfill({
      body: Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", "base64"),
      contentType: "audio/wav"
    });
  });
  await page.route("**/api/recordings/recoverable", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { recordings: [] } });
  });
  await page.route("**/recordings**", async (route) => {
    const requested = new URL(route.request().url());

    if (!requested.pathname.startsWith("/recordings")) {
      await route.fallback();
      return;
    }

    const fixture = new URL("/login/recording-search-e2e", requested.origin);
    fixture.searchParams.set("scope", scope);

    requested.searchParams.forEach((value, key) => {
      if (key === "scope") {
        if (!fixture.searchParams.has("scope")) fixture.searchParams.set("scope", value);
        return;
      }

      fixture.searchParams.append(key, value);
    });
    if (requested.pathname === `/recordings/${recordingId}`) {
      fixture.searchParams.set("view", "detail");
    }

    await route.fulfill({ status: 307, headers: { location: fixture.toString() } });
  });

  await page.goto(
    `/login/recording-search-e2e?scope=${scope}&q=Lucern+CRM&client=${clientId}&tag=${tagId}`
  );
  const resultLink = page.getByRole("link", { name: /Otevřít nalezenou nahrávku/ }).first();

  await expect(page.getByText("Foreign transcript secret")).toHaveCount(0);
  await expect(page.getByText("Deleted transcript secret")).toHaveCount(0);
  await expect(page.getByText("Older transcript secret")).toHaveCount(0);
  await expect(page.locator(".recording-search-excerpt img")).toHaveCount(0);
  await expect(page.locator(".recording-search-excerpt")).toContainText("<img src=x onerror=alert(1)>");
  await expect(resultLink).toHaveAttribute(
    "href",
    `/recordings/${recordingId}?tab=transcript&at=8000&highlight=Lucern+CRM`
  );

  const next = page.getByRole("link", { name: "Další" });
  const nextHref = await next.getAttribute("href");
  expect(nextHref).not.toBeNull();
  const nextUrl = new URL(nextHref as string, "https://vosio.local");
  expect(nextUrl.searchParams.get("page")).toBe("2");
  expect(nextUrl.searchParams.get("q")).toBe("Lucern CRM");
  expect(nextUrl.searchParams.get("client")).toBe(clientId);
  expect(nextUrl.searchParams.getAll("tag")).toContain(tagId);

  await next.click();
  await expect(page.locator('[data-e2e-search-view="list"]')).toBeVisible();
  await expect(page.locator(".recordings-search-status")).toContainText("Strana 2 z 2");
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("page") === "2"
    && url.searchParams.get("q") === "Lucern CRM"
    && url.searchParams.get("client") === clientId
    && url.searchParams.getAll("tag").includes(tagId)
    && url.searchParams.getAll("scope").length === 1
  );
  const pageTwoFilters = page.getByRole("form", { name: "Filtrování nahrávek" });
  await expect(pageTwoFilters.getByLabel("Hledat")).toHaveValue("Lucern CRM");
  await pageTwoFilters.getByRole("button", { name: /^Filtry \(\d+\)$/u }).click();
  await expect(pageTwoFilters.getByLabel("Klient")).toHaveValue(clientId);
  await expect(pageTwoFilters.getByRole("checkbox", { name: "Důležité" })).toBeChecked();

  const pageTwoResultLink = page.getByRole("link", { name: /Otevřít nalezenou nahrávku/ }).first();
  await expect(page.locator('[data-e2e-candidate-count="4"]')).toBeVisible();
  await pageTwoResultLink.click();
  await expect(page.locator('[data-e2e-search-view="detail"]')).toBeVisible();
  await expect(page.getByRole("tab", { name: "Přepis" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __searchHighlightSeen?: boolean }).__searchHighlightSeen ?? false
  )).toBe(true);
  expect(await page.evaluate(() =>
    (window as typeof window & { __searchHighlightText?: string }).__searchHighlightText ?? ""
  )).toBe("Lucern CRM");
  expect(await page.evaluate(() =>
    (window as typeof window & { __searchSeekSeconds?: number }).__searchSeekSeconds ?? 0
  )).toBe(0);
  await page.evaluate(() => {
    const state = window as typeof window & { __searchReadyState?: number };
    state.__searchReadyState = 1;
    document.querySelector("audio")?.dispatchEvent(new Event("loadedmetadata"));
  });
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __searchSeekSeconds?: number }).__searchSeekSeconds ?? 0
  )).toBe(8);
  expect(await page.evaluate(() =>
    (window as typeof window & { __searchSeekWrites?: number }).__searchSeekWrites ?? 0
  )).toBe(1);
  expect(await page.evaluate(() =>
    (window as typeof window & { __searchPlayCalls?: number }).__searchPlayCalls ?? 0
  )).toBe(0);
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("view") === "detail"
    && url.searchParams.get("tab") === "transcript"
    && !url.searchParams.has("at")
    && !url.searchParams.has("highlight")
  );

  await expect(page.locator("#transcript-at-8000")).not.toHaveAttribute("aria-current", "true", {
    timeout: 4_000
  });
  await page.evaluate(() => {
    const state = window as typeof window & { __searchHighlightSeen?: boolean };
    state.__searchHighlightSeen = false;
    window.sessionStorage.removeItem("search-highlight-seen");
    window.sessionStorage.removeItem("search-highlight-text");
  });

  await page.goBack();
  await expect(page.locator('[data-e2e-search-view="list"]')).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("page") === "2");
  await page.goForward();
  await expect(page.locator('[data-e2e-search-view="detail"]')).toBeVisible();
  await page.waitForTimeout(2_200);

  expect(await page.evaluate(() =>
    (window as typeof window & { __searchHighlightSeen?: boolean }).__searchHighlightSeen ?? false
  )).toBe(false);
  expect(await page.evaluate(() =>
    Number(window.sessionStorage.getItem("search-seek-writes") ?? "0")
  )).toBe(1);
  await expect(page.locator("#transcript-at-8000")).not.toHaveAttribute("aria-current", "true");
  expect(await page.evaluate(() =>
    (window as typeof window & { __searchPlayCalls?: number }).__searchPlayCalls ?? 0
  )).toBe(0);
});
