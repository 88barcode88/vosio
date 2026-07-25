export type TranscriptSpeakerRole = "client_customer" | "delivery_team" | "unknown";

export type TranscriptSpeakerSummary = {
  firstStartMs: number | null;
  id: string;
  label: string;
  lastEndMs: number | null;
  name: string | null;
  role: TranscriptSpeakerRole;
  roleLabel: string;
  source: "soniox_diarization" | "manual" | "ai_inferred";
  tokenCount: number;
};

export type TranscriptSpeakerUpdate = {
  name: string | null;
  role: TranscriptSpeakerRole;
  speakerId: string;
};

export type TranscriptSpeakerContext = {
  assigned_name: string | null;
  first_start_ms: number | null;
  label: string;
  name: string | null;
  owner_category: "Klient" | "Moje práce" | "Nejasné";
  role: TranscriptSpeakerRole;
  role_label: string;
  source: TranscriptSpeakerSummary["source"];
  speaker_id: string;
  speaker_label: string;
  token_count: number;
};

// getObjectField returns one provider JSON field without trusting the payload shape.
function getObjectField(input: unknown, key: string) {
  if (!input || typeof input !== "object") {
    return null;
  }

  return (input as Record<string, unknown>)[key] ?? null;
}

// isTranscriptSpeakerRole validates stored speaker roles from JSON payloads.
function isTranscriptSpeakerRole(value: unknown): value is TranscriptSpeakerRole {
  return value === "client_customer" || value === "delivery_team" || value === "unknown";
}

// getNumberOrNull normalizes optional numeric speaker evidence fields.
function getNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// getStringOrFallback normalizes optional stored speaker strings.
function getStringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// getOptionalSpeakerName normalizes a manually assigned speaker name.
function getOptionalSpeakerName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// sortTranscriptSpeakers keeps numeric Soniox speaker ids in human order.
function sortTranscriptSpeakers(speakers: TranscriptSpeakerSummary[]) {
  return [...speakers].sort((first, second) => first.id.localeCompare(second.id, "cs", { numeric: true }));
}

// getTranscriptSpeakerRoleLabel maps stored speaker roles into Czech UI copy.
export function getTranscriptSpeakerRoleLabel(role: TranscriptSpeakerRole) {
  const labels: Record<TranscriptSpeakerRole, string> = {
    client_customer: "Klient",
    delivery_team: "Dodavatel / náš tým",
    unknown: "Nepřiřazeno"
  };

  return labels[role];
}

// getTranscriptSpeakerOwnerCategory maps speaker roles into action-item owner categories.
export function getTranscriptSpeakerOwnerCategory(role: TranscriptSpeakerRole): TranscriptSpeakerContext["owner_category"] {
  if (role === "client_customer") {
    return "Klient";
  }

  if (role === "delivery_team") {
    return "Moje práce";
  }

  return "Nejasné";
}

// getTranscriptSpeakerLabel converts provider speaker ids into Czech UI labels.
export function getTranscriptSpeakerLabel(speakerId: string | null) {
  return speakerId ? `Mluvčí ${speakerId}` : "Mluvčí ?";
}

// getTranscriptSpeakerDisplayName prefers a manually assigned name over the provider label.
export function getTranscriptSpeakerDisplayName(speaker: TranscriptSpeakerSummary) {
  return speaker.name ?? speaker.label;
}

// getTranscriptTokenText reads the text value from a Soniox-style token.
export function getTranscriptTokenText(token: unknown) {
  const text = getObjectField(token, "text");

  return typeof text === "string" ? text : "";
}

// getTranscriptTokenSpeakerId reads a speaker id from Soniox diarization token JSON.
export function getTranscriptTokenSpeakerId(token: unknown) {
  const speaker = getObjectField(token, "speaker");

  if (typeof speaker === "number" || typeof speaker === "string") {
    return String(speaker);
  }

  return null;
}

// getTranscriptTokenStartMs reads a token start timestamp when the provider returned one.
export function getTranscriptTokenStartMs(token: unknown) {
  const startMs = getObjectField(token, "start_ms");

  return typeof startMs === "number" ? startMs : null;
}

// getTranscriptTokenEndMs reads a token end timestamp when the provider returned one.
export function getTranscriptTokenEndMs(token: unknown) {
  const endMs = getObjectField(token, "end_ms");

  return typeof endMs === "number" ? endMs : null;
}

// flattenTranscriptTokens extracts flat token arrays from Soniox token or segment payloads.
export function flattenTranscriptTokens(segments: unknown) {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments.flatMap((segment) => {
    const tokens = getObjectField(segment, "tokens");

    if (Array.isArray(tokens)) {
      return tokens;
    }

    return [segment];
  });
}

// extractTranscriptSpeakerSummaries builds persistent speaker metadata from diarized provider tokens.
export function extractTranscriptSpeakerSummaries(segments: unknown): TranscriptSpeakerSummary[] {
  const tokens = flattenTranscriptTokens(segments);
  const speakerMap = tokens.reduce<Map<string, TranscriptSpeakerSummary>>((currentMap, token) => {
    const speakerId = getTranscriptTokenSpeakerId(token);

    if (!speakerId) {
      return currentMap;
    }

    const existingSpeaker = currentMap.get(speakerId);
    const startMs = getTranscriptTokenStartMs(token);
    const endMs = getTranscriptTokenEndMs(token);
    const nextSpeaker: TranscriptSpeakerSummary = existingSpeaker
      ? {
          ...existingSpeaker,
          firstStartMs: existingSpeaker.firstStartMs ?? startMs,
          lastEndMs: endMs ?? existingSpeaker.lastEndMs,
          tokenCount: existingSpeaker.tokenCount + 1
        }
      : {
          firstStartMs: startMs,
          id: speakerId,
          label: getTranscriptSpeakerLabel(speakerId),
          lastEndMs: endMs,
          name: null,
          role: "unknown",
          roleLabel: getTranscriptSpeakerRoleLabel("unknown"),
          source: "soniox_diarization",
          tokenCount: 1
        };

    return new Map(currentMap).set(speakerId, nextSpeaker);
  }, new Map());

  return sortTranscriptSpeakers([...speakerMap.values()]);
}

// normalizeTranscriptSpeakerSummary validates and upgrades stored speaker JSON.
function normalizeTranscriptSpeakerSummary(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : null;

  if (!id) {
    return null;
  }

  const role = isTranscriptSpeakerRole(candidate.role) ? candidate.role : "unknown";
  const label = getStringOrFallback(candidate.label, getTranscriptSpeakerLabel(id));

  return {
    firstStartMs: getNumberOrNull(candidate.firstStartMs),
    id,
    label,
    lastEndMs: getNumberOrNull(candidate.lastEndMs),
    name: getOptionalSpeakerName(candidate.name),
    role,
    roleLabel: getTranscriptSpeakerRoleLabel(role),
    source: candidate.source === "manual" || candidate.source === "ai_inferred"
      ? candidate.source
      : "soniox_diarization",
    tokenCount: typeof candidate.tokenCount === "number" && candidate.tokenCount >= 0
      ? candidate.tokenCount
      : 0
  } satisfies TranscriptSpeakerSummary;
}

// mergeStoredAndExtractedSpeakers preserves manual labels while refreshing provider evidence.
function mergeStoredAndExtractedSpeakers(
  storedSpeakers: TranscriptSpeakerSummary[],
  extractedSpeakers: TranscriptSpeakerSummary[]
) {
  const extractedById = new Map(extractedSpeakers.map((speaker) => [speaker.id, speaker]));
  const storedIds = new Set(storedSpeakers.map((speaker) => speaker.id));
  const mergedStored = storedSpeakers.map((storedSpeaker) => {
    const extractedSpeaker = extractedById.get(storedSpeaker.id);

    return {
      ...storedSpeaker,
      firstStartMs: extractedSpeaker?.firstStartMs ?? storedSpeaker.firstStartMs,
      label: storedSpeaker.label || extractedSpeaker?.label || getTranscriptSpeakerLabel(storedSpeaker.id),
      lastEndMs: extractedSpeaker?.lastEndMs ?? storedSpeaker.lastEndMs,
      tokenCount: extractedSpeaker?.tokenCount ?? storedSpeaker.tokenCount
    };
  });
  const missingExtracted = extractedSpeakers.filter((speaker) => !storedIds.has(speaker.id));

  return sortTranscriptSpeakers([...mergedStored, ...missingExtracted]);
}

// getStoredTranscriptSpeakerSummaries returns stored summaries or rebuilds them from segments.
export function getStoredTranscriptSpeakerSummaries(
  speakers: unknown,
  segments: unknown
): TranscriptSpeakerSummary[] {
  const extractedSpeakers = extractTranscriptSpeakerSummaries(segments);

  if (!Array.isArray(speakers) || speakers.length === 0) {
    return extractedSpeakers;
  }

  const storedSpeakers = speakers
    .map((speaker) => normalizeTranscriptSpeakerSummary(speaker))
    .filter((speaker): speaker is TranscriptSpeakerSummary => Boolean(speaker));

  if (storedSpeakers.length === 0) {
    return extractedSpeakers;
  }

  return mergeStoredAndExtractedSpeakers(storedSpeakers, extractedSpeakers);
}

// updateTranscriptSpeakerSummary applies one manual speaker assignment immutably.
export function updateTranscriptSpeakerSummary(
  speakers: unknown,
  segments: unknown,
  update: TranscriptSpeakerUpdate
) {
  const currentSpeakers = getStoredTranscriptSpeakerSummaries(speakers, segments);
  const hasSpeaker = currentSpeakers.some((speaker) => speaker.id === update.speakerId);
  const speakersToUpdate = hasSpeaker
    ? currentSpeakers
    : [
        ...currentSpeakers,
        {
          firstStartMs: null,
          id: update.speakerId,
          label: getTranscriptSpeakerLabel(update.speakerId),
          lastEndMs: null,
          name: null,
          role: "unknown",
          roleLabel: getTranscriptSpeakerRoleLabel("unknown"),
          source: "manual",
          tokenCount: 0
        } satisfies TranscriptSpeakerSummary
      ];

  return sortTranscriptSpeakers(speakersToUpdate.map((speaker) => {
    if (speaker.id !== update.speakerId) {
      return speaker;
    }

    return {
      ...speaker,
      name: update.name,
      role: update.role,
      roleLabel: getTranscriptSpeakerRoleLabel(update.role),
      source: "manual" as const
    };
  }));
}

// getTranscriptSpeakerContext prepares compact speaker metadata for AI prompts.
export function getTranscriptSpeakerContext(speakers: unknown, segments: unknown): TranscriptSpeakerContext[] {
  return getStoredTranscriptSpeakerSummaries(speakers, segments).map((speaker) => ({
    assigned_name: speaker.name,
    first_start_ms: speaker.firstStartMs,
    label: speaker.label,
    name: speaker.name,
    owner_category: getTranscriptSpeakerOwnerCategory(speaker.role),
    role: speaker.role,
    role_label: speaker.roleLabel,
    source: speaker.source,
    speaker_id: speaker.id,
    speaker_label: speaker.label,
    token_count: speaker.tokenCount
  }));
}
