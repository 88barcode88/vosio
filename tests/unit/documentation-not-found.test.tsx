import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFound from "../../app/not-found";
import { DocumentationPanel } from "@/components/documentation-panel";

describe("documentation and not found surfaces", () => {
  it("wraps the documentation TOC throughout the full mobile shell breakpoint", () => {
    const stylesheet = readFileSync(
      join(process.cwd(), "app", "styles", "trash-documentation.css"),
      "utf8"
    );
    const mobileBlock = stylesheet.match(/@media \(max-width: 900px\) \{([\s\S]*)\}\s*$/u)?.[1] ?? "";

    expect(mobileBlock).toMatch(/\.documentation-topics\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?overflow-x:\s*visible;/u);
    expect(mobileBlock).toMatch(/\.documentation-topics a\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?white-space:\s*normal;/u);
  });

  it("keeps documentation anchors stable and describes implemented transcript fulltext", () => {
    const markup = renderToStaticMarkup(createElement(DocumentationPanel));
    const anchorTargets = Array.from(markup.matchAll(/href="#([^"]+)"/gu), (match) => match[1]);
    const sectionIds = Array.from(markup.matchAll(/<section[^>]+id="([^"]+)"/gu), (match) => match[1]);

    expect(anchorTargets.length).toBeGreaterThan(3);
    expect(new Set(anchorTargets).size).toBe(anchorTargets.length);
    expect(sectionIds).toEqual(expect.arrayContaining(anchorTargets));
    expect(markup).toContain("Fulltext");
    expect(markup).not.toContain("bude samostatný fulltextový krok");
  });

  it("documents current settings, automatic timeline, and Trash behavior without the obsolete start card", () => {
    const markup = renderToStaticMarkup(createElement(DocumentationPanel));

    expect(markup).not.toContain("Začít s prvním callem");
    expect(markup).toContain("Model a kvalita");
    expect(markup).toContain("Změna hesla");
    expect(markup).toContain("Automatická časová osa je ve výchozím stavu vypnutá");
    expect(markup).toContain("24 hodin, 7 dní nebo 30 dní");
    expect(markup).toContain("Ruční trvalé smazání je dostupné po 24 hodinách");
    expect(markup).toContain("není nasazen ani aktivní");
  });

  it("renders a Czech 404 with only safe recovery links", () => {
    const markup = renderToStaticMarkup(createElement(NotFound));

    expect(markup).toContain("Stránka nebyla nalezena");
    expect(markup).toContain('href="/recordings"');
    expect(markup).toContain('href="/recordings/new"');
    expect(markup).not.toContain("error=");
  });

  it("keeps raw route error details out of the browser console", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "components", "utility-route-error.tsx"),
      "utf8"
    );

    expect(source).not.toContain("console.error");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.digest");
  });
});
