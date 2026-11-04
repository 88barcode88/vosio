// Token fields the detail client reads through the speakers.ts token accessors; everything else stays server-side.
const CLIENT_TOKEN_FIELDS = ["text", "speaker", "start_ms", "end_ms"] as const;

// toClientToken keeps only the client-read fields of one Soniox-style token object.
function toClientToken(token: unknown) {
  if (!token || typeof token !== "object") {
    return token;
  }

  const source = token as Record<string, unknown>;
  return Object.fromEntries(
    CLIENT_TOKEN_FIELDS.flatMap((field) => source[field] === undefined ? [] : [[field, source[field]]])
  );
}

// toClientTranscriptSegments slims stored transcript segments for the recording detail client payload:
// nested `{ tokens: [...] }` segments keep only their token arrays and flat (legacy) token segments are slimmed in place,
// mirroring flattenTranscriptTokens/listEvidenceTokens so client grouping, evidence and playback stay identical.
export function toClientTranscriptSegments(segments: unknown): unknown[] {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments.map((segment) => {
    const tokens = segment && typeof segment === "object"
      ? (segment as { tokens?: unknown }).tokens
      : undefined;

    return Array.isArray(tokens) ? { tokens: tokens.map(toClientToken) } : toClientToken(segment);
  });
}
