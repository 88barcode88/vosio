type SearchExcerptPart = {
  highlighted: boolean;
  text: string;
};

const HIGHLIGHT_START = "[[H]]";
const HIGHLIGHT_END = "[[/H]]";

// parseSearchResultExcerpt accepts only flat, balanced literal highlight marker pairs.
export function parseSearchResultExcerpt(excerpt: string): SearchExcerptPart[] {
  const parts: SearchExcerptPart[] = [];
  let cursor = 0;

  while (cursor < excerpt.length) {
    const start = excerpt.indexOf(HIGHLIGHT_START, cursor);
    const strayEnd = excerpt.indexOf(HIGHLIGHT_END, cursor);

    if (strayEnd !== -1 && (start === -1 || strayEnd < start)) {
      return [{ highlighted: false, text: excerpt }];
    }
    if (start === -1) {
      parts.push({ highlighted: false, text: excerpt.slice(cursor) });
      break;
    }

    const contentStart = start + HIGHLIGHT_START.length;
    const end = excerpt.indexOf(HIGHLIGHT_END, contentStart);
    const nestedStart = excerpt.indexOf(HIGHLIGHT_START, contentStart);

    if (end === -1 || (nestedStart !== -1 && nestedStart < end)) {
      return [{ highlighted: false, text: excerpt }];
    }
    if (start > cursor) {
      parts.push({ highlighted: false, text: excerpt.slice(cursor, start) });
    }
    parts.push({ highlighted: true, text: excerpt.slice(contentStart, end) });
    cursor = end + HIGHLIGHT_END.length;
  }

  return parts.length > 0 ? parts : [{ highlighted: false, text: excerpt }];
}

// SearchResultExcerpt renders safe React text and mark nodes without interpreting HTML.
export function SearchResultExcerpt({ excerpt }: { excerpt: string }) {
  return (
    <p className="recording-search-excerpt">
      {parseSearchResultExcerpt(excerpt).map((part, index) =>
        part.highlighted
          ? <mark key={index}>{part.text}</mark>
          : <span key={index}>{part.text}</span>
      )}
    </p>
  );
}
