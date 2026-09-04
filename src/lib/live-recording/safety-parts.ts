const SAFETY_PART_NAME_PATTERN = /^part-(\d{6})\.(webm|m4a)$/;

export type SafetyPartExtension = "m4a" | "webm";

export type ParsedSafetyPart = {
  extension: SafetyPartExtension;
  index: number;
};

export type ValidatedSafetyPart<T extends { name: string }> = ParsedSafetyPart & {
  item: T;
  name: string;
};

// InvalidSafetyPartListingError marks a recoverable conflict without exposing object names.
export class InvalidSafetyPartListingError extends Error {
  readonly code = "invalid_safety_part_listing";

  // constructor keeps every malformed listing on one safe public error type.
  constructor() {
    super("Uložené části audia netvoří souvislou nahrávku.");
    this.name = "InvalidSafetyPartListingError";
  }
}

// formatSafetyPartName creates the only supported object name for a finalized safety part.
export function formatSafetyPartName(index: number, extension: SafetyPartExtension) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 999_999) {
    throw new RangeError("Safety part index must be an integer from 0 to 999999.");
  }

  return `part-${String(index).padStart(6, "0")}.${extension}`;
}

// parseSafetyPartName accepts only the exact lowercase six-digit part grammar.
export function parseSafetyPartName(name: string): ParsedSafetyPart | null {
  const match = SAFETY_PART_NAME_PATTERN.exec(name);

  if (!match) {
    return null;
  }

  return {
    extension: match[2] as SafetyPartExtension,
    index: Number(match[1])
  };
}

// getSafetyPartExtension maps finalized browser MIME types to the supported part extension.
export function getSafetyPartExtension(mimeType: string): SafetyPartExtension | null {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim();

  if (normalized === "audio/webm" || normalized === "video/webm") {
    return "webm";
  }

  if (["audio/m4a", "audio/mp4", "audio/x-m4a", "video/mp4"].includes(normalized ?? "")) {
    return "m4a";
  }

  return null;
}

// validateSafetyPartListing ignores unrelated objects and rejects duplicate, mixed, or gapped parts.
export function validateSafetyPartListing<T extends { name: string }>(
  items: readonly T[]
): Array<ValidatedSafetyPart<T>> {
  const parts = items.flatMap((item) => {
    const parsed = parseSafetyPartName(item.name);

    return parsed ? [{ ...parsed, item, name: item.name }] : [];
  }).sort((left, right) => left.index - right.index);

  if (parts.length === 0) {
    return [];
  }

  const extension = parts[0]?.extension;
  const isInvalid = parts.some((part, position) => (
    part.extension !== extension || part.index !== position
  ));

  if (isInvalid) {
    throw new InvalidSafetyPartListingError();
  }

  return parts;
}
