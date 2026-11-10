// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentationPanel } from "@/components/documentation-panel";
import { whatsNewReleases } from "@/lib/whats-new/entries";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("browser extension documentation", () => {
  it("is linked from the topics and covers install, pairing, modes, participants, disconnect and HTTPS", async () => {
    await act(async () => root.render(<DocumentationPanel />));

    expect(container.querySelector("nav a[href='#rozsireni-prohlizece']")).not.toBeNull();
    const section = container.querySelector("#rozsireni-prohlizece");
    expect(section).not.toBeNull();
    const text = section?.textContent ?? "";
    for (const expected of ["Instalace", "Načíst nerozbalené", "Spárování", "Automaticky", "Zeptat se", "Vypnuto", "klávesová zkratka", "Informujte účastníky", "Odpojení", "veřejnou HTTPS adresu"]) {
      expect(text).toContain(expected);
    }
    expect(section?.querySelector("a[href='/settings#settings-connections']")).not.toBeNull();
  });

  it("is announced in Novinky with a link to the documentation section", () => {
    const items = whatsNewReleases[0].items;
    expect(items.some((item) => item.href === "/documentation#rozsireni-prohlizece")).toBe(true);
    expect(whatsNewReleases[0].date).toMatch(/^\d{2}\.\d{2}\.\d{4}$/u);
  });
});
