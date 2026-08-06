import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SearchResultExcerpt,
  parseSearchResultExcerpt
} from "@/components/search-result-excerpt";

describe("search result excerpt", () => {
  it("renders only balanced literal markers as React mark nodes", () => {
    expect(parseSearchResultExcerpt("Před [[H]]Lucern[[/H]] a [[H]]CRM[[/H]] po"))
      .toEqual([
        { highlighted: false, text: "Před " },
        { highlighted: true, text: "Lucern" },
        { highlighted: false, text: " a " },
        { highlighted: true, text: "CRM" },
        { highlighted: false, text: " po" }
      ]);
    const markup = renderToStaticMarkup(createElement(SearchResultExcerpt, {
      excerpt: "Před [[H]]Lucern[[/H]] po"
    }));
    expect(markup).toContain("<mark>Lucern</mark>");
    expect(markup).not.toContain("[[H]]");
  });

  it("escapes XSS-like text instead of interpreting HTML", () => {
    const markup = renderToStaticMarkup(createElement(SearchResultExcerpt, {
      excerpt: 'Text [[H]]<img src=x onerror="alert(1)">[[/H]] konec'
    }));

    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });

  it.each([
    "Začátek [[H]]bez konce",
    "Konec [[/H]] bez začátku",
    "[[H]]vnější [[H]]vnitřní[[/H]][[/H]]",
    "[[H]]první[[/H]] a stray [[/H]]"
  ])("renders malformed or nested markers inert: %s", (excerpt) => {
    const parts = parseSearchResultExcerpt(excerpt);
    const markup = renderToStaticMarkup(createElement(SearchResultExcerpt, { excerpt }));

    expect(parts).toEqual([{ highlighted: false, text: excerpt }]);
    expect(markup).not.toContain("<mark>");
    expect(markup).toContain("[[");
  });
});
