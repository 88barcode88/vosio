const trashErrorMessages = {
  invalid_purge: "Požadavek na trvalé smazání nebyl platný.",
  invalid_restore: "Požadavek na obnovení nebyl platný.",
  purge_failed: "Nahrávku se nepodařilo trvale smazat. Zkuste to znovu.",
  purge_in_progress: "Trvalé mazání už probíhá. Zkuste to znovu později.",
  purge_not_found: "Smazaná nahrávka už není dostupná.",
  purge_storage_failed: "Audio soubor se nepodařilo odstranit. Nahrávka zůstala v Koši.",
  purge_too_recent: "Nahrávku lze trvale smazat až 24 hodin po přesunu do Koše.",
  restore_failed: "Nahrávku se nepodařilo obnovit. Zkuste to znovu.",
  restore_not_found: "Smazaná nahrávka už není dostupná."
} as const;

export type TrashActionError = keyof typeof trashErrorMessages;

// canonicalizeTrashSearchParams accepts only one allowlisted action error for deterministic rendering.
export function canonicalizeTrashSearchParams(input: URLSearchParams) {
  const values = input.getAll("error");
  const candidate = values[0];
  const error = values.length === 1 && candidate && Object.hasOwn(trashErrorMessages, candidate)
    ? candidate as TrashActionError
    : null;
  const searchParams = new URLSearchParams();
  if (error) searchParams.set("error", error);

  return {
    actionAlert: error ? trashErrorMessages[error] : null,
    changed: input.toString() !== searchParams.toString(),
    searchParams
  };
}

// createTrashSearchParams preserves duplicates so canonicalization can reject ambiguous requests.
export function createTrashSearchParams(query: Record<string, string | string[] | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : typeof value === "string" ? [value] : []) {
      searchParams.append(key, item);
    }
  }
  return searchParams;
}
