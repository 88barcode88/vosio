import { knownMarkdownHeadings } from "@/components/transcript-tabs/constants";
import { getAiOutputPreview } from "@/components/transcript-tabs/ai-output-formatting";
import type { AiMarkdownLine } from "@/components/transcript-tabs/types";
import type { AiOutputView } from "@/lib/ai/types";

// splitLongParagraph breaks dense single-line AI text into readable sentence groups.
function splitLongParagraph(text: string) {
  if (text.length < 220) {
    return [text];
  }

  const sentences = text
    .match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [text];
  const paragraphs: string[] = [];

  sentences.forEach((sentence) => {
    const previous = paragraphs.at(-1);

    if (!previous || previous.length + sentence.length > 220) {
      paragraphs.push(sentence);
      return;
    }

    paragraphs[paragraphs.length - 1] = `${previous} ${sentence}`;
  });

  return paragraphs;
}

// stripInlineMarkdown removes simple emphasis markers that should not appear as raw text in the UI.
function stripInlineMarkdown(text: string) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .trim();
}

// splitKnownHeadingText separates common markdown headings from text that follows on the same line.
function splitKnownHeadingText(text: string): AiMarkdownLine[] {
  const normalizedText = stripInlineMarkdown(text);
  const knownHeading = knownMarkdownHeadings.find((heading) => normalizedText.startsWith(`${heading} `));

  if (!knownHeading) {
    return [{ kind: "heading" as const, text: normalizedText.replace(/:$/, "") }];
  }

  const rest = normalizedText.slice(knownHeading.length).trim();

  if (!rest) {
    return [{ kind: "heading" as const, text: knownHeading }];
  }

  return [
    { kind: "heading" as const, text: knownHeading },
    ...splitLongParagraph(rest).map((paragraph) => ({ kind: "paragraph" as const, text: paragraph }))
  ];
}

// normalizeAiMarkdownSourceLines prepares imperfect model markdown for the AI output preview.
function normalizeAiMarkdownSourceLines(text: string) {
  return text
    .replace(/\s+(#{1,6}\s+)/g, "\n$1")
    .split(/\r?\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return [];
      }

      return trimmed
        .replace(/^•\s+/, "- ")
        .replace(/\s+•\s+/g, "\n- ")
        .replace(/\s+[-*]\s+/g, "\n- ")
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean);
    });
}

// isMarkdownTableLine detects simple GitHub-style markdown table rows.
function isMarkdownTableLine(line: string) {
  return line.startsWith("|") && line.endsWith("|") && line.split("|").length > 2;
}

// parseMarkdownTableLine converts one markdown table row into trimmed cells.
function parseMarkdownTableLine(line: string) {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => stripInlineMarkdown(cell));
}

// isMarkdownTableSeparator identifies the alignment row between table header and body.
function isMarkdownTableSeparator(cells: string[]) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

// readMarkdownTable consumes consecutive markdown table rows from a normalized line list.
function readMarkdownTable(lines: string[], startIndex: number) {
  const rows: string[][] = [];
  let index = startIndex;

  while (index < lines.length && isMarkdownTableLine(lines[index])) {
    const cells = parseMarkdownTableLine(lines[index]);

    if (!isMarkdownTableSeparator(cells)) {
      rows.push(cells);
    }

    index += 1;
  }

  return {
    line: rows.length > 0 ? { kind: "table" as const, rows } : null,
    nextIndex: index
  };
}

// parseAiMarkdownLine turns one non-table markdown line into one or more UI blocks.
function parseAiMarkdownLine(line: string): AiMarkdownLine[] {
  if (/^#{1,6}\s+/.test(line)) {
    return splitKnownHeadingText(line.replace(/^#{1,6}\s+/, ""));
  }

  const boldHeading = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);

  if (boldHeading) {
    const heading = stripInlineMarkdown(boldHeading[1]).replace(/:$/, "");
    const rest = stripInlineMarkdown(boldHeading[2] ?? "");

    return rest
      ? [
          { kind: "heading" as const, text: heading },
          ...splitLongParagraph(rest).map((paragraph) => ({ kind: "paragraph" as const, text: paragraph }))
        ]
      : [{ kind: "heading" as const, text: heading }];
  }

  if (/^[-*]\s+/.test(line)) {
    return [{ kind: "bullet" as const, text: stripInlineMarkdown(line.replace(/^[-*]\s+/, "")) }];
  }

  return splitLongParagraph(stripInlineMarkdown(line)).map((paragraph) => ({ kind: "paragraph" as const, text: paragraph }));
}

// getAiMarkdownLines turns untrusted markdown-like AI text into safe readable document blocks.
export function getAiMarkdownLines(text: string): AiMarkdownLine[] {
  const lines = normalizeAiMarkdownSourceLines(text);

  if (lines.length === 0) {
    return [{ kind: "paragraph" as const, text: "Výstup je uložený jako strukturovaná data." }];
  }

  const parsedLines: AiMarkdownLine[] = [];
  let index = 0;

  while (index < lines.length) {
    if (isMarkdownTableLine(lines[index])) {
      const table = readMarkdownTable(lines, index);

      if (table.line) {
        parsedLines.push(table.line);
      }

      index = table.nextIndex;
      continue;
    }

    parsedLines.push(...parseAiMarkdownLine(lines[index]));
    index += 1;
  }

  return parsedLines;
}

// getAiOutputMarkdownLines turns saved markdown-like AI text into readable document blocks.
export function getAiOutputMarkdownLines(output: AiOutputView): AiMarkdownLine[] {
  return getAiMarkdownLines(getAiOutputPreview(output));
}
