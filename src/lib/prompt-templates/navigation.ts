export type PromptTemplateNavigationState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "selected"; templateId: string };

// createPromptTemplateSearchParams preserves repeatable values from a Next.js query object.
export function createPromptTemplateSearchParams(
  input: Record<string, string | string[] | undefined>
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    for (const item of Array.isArray(value) ? value : typeof value === "string" ? [value] : []) {
      searchParams.append(key, item);
    }
  }

  return searchParams;
}

// canonicalizePromptTemplateSearchParams accepts one selected template or the explicit create mode.
export function canonicalizePromptTemplateSearchParams(
  current: URLSearchParams,
  knownTemplateIds: Set<string>
) {
  const searchParams = new URLSearchParams(current);
  const templateValues = current.getAll("template");
  const modeValues = current.getAll("mode");
  let state: PromptTemplateNavigationState = { kind: "list" };
  let valid = templateValues.length === 0 && modeValues.length === 0;

  if (
    templateValues.length === 1
    && modeValues.length === 0
    && knownTemplateIds.has(templateValues[0]!)
  ) {
    state = { kind: "selected", templateId: templateValues[0]! };
    valid = true;
  } else if (
    templateValues.length === 0
    && modeValues.length === 1
    && modeValues[0] === "create"
  ) {
    state = { kind: "create" };
    valid = true;
  }

  if (!valid) {
    searchParams.delete("template");
    searchParams.delete("mode");
  }

  return { changed: !valid, searchParams, state };
}

// buildPromptTemplateHref keeps fixture or production base params while selecting one editor state.
export function buildPromptTemplateHref(
  baseHref: string,
  state: Exclude<PromptTemplateNavigationState, { kind: "list" }>
) {
  const url = new URL(baseHref, "https://vosio.local");
  url.searchParams.delete("template");
  url.searchParams.delete("mode");

  if (state.kind === "create") url.searchParams.set("mode", "create");
  if (state.kind === "selected") url.searchParams.set("template", state.templateId);

  return `${url.pathname}${url.search}`;
}
