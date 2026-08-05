import type {
  StructuredAiItems,
  StructuredChapterRow,
  StructuredDecisionRow,
  StructuredOwnerCategory,
  StructuredRiskRow,
  StructuredSourceType,
  StructuredTaskRow,
  StructuredTaskStatus
} from "@/lib/ai/structured-types";
import { resolveEvidenceLocation } from "@/lib/transcripts/evidence-location";

type JsonRecord = Record<string, unknown>;

type StructuredBuildContext = {
  aiOutputId: string;
  processingJobId: string;
  transcriptSegments?: unknown;
  transcriptId: string;
  userId: string;
};

type DecisionGroup = {
  defaultStatus: string | null;
  items: unknown[];
};

const ownerCategories = ["Moje práce", "Klient", "Nejasné"] as const;
const ownerRoles = ["client_customer", "delivery_team", "unknown"] as const;
const sourceTypes = ["explicit", "inferred", "unknown"] as const;
const taskStatuses = ["new", "in_progress", "waiting", "done", "unclear", "ignored"] as const;
const confidenceLevels = ["high", "medium", "low"] as const;

// emptyStructuredAiItems returns the neutral value used when an AI response has no structured JSON.
export function emptyStructuredAiItems(): StructuredAiItems {
  return {
    chapters: [],
    decisions: [],
    risks: [],
    tasks: []
  };
}

// buildStructuredAiItems extracts reusable workspace rows from the saved AI JSON contract.
export function buildStructuredAiItems(context: StructuredBuildContext, outputJson: unknown): StructuredAiItems {
  const root = asRecord(outputJson);

  if (!root) {
    return emptyStructuredAiItems();
  }

  const data = asRecord(root.data) ?? root;

  return {
    chapters: buildChapters(context, data),
    decisions: buildDecisions(context, data),
    risks: buildRisks(context, data),
    tasks: buildTasks(context, data)
  };
}

// asRecord narrows arbitrary JSON into an object record.
function asRecord(input: unknown): JsonRecord | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as JsonRecord
    : null;
}

// asArray reads an array field from arbitrary JSON without mutating the source.
function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

// getStringField reads the first non-empty string from a set of possible JSON keys.
function getStringField(input: unknown, keys: string[]) {
  const record = asRecord(input);

  if (!record) {
    return typeof input === "string" && input.trim() ? input.trim() : null;
  }

  const value = keys.map((key) => record[key]).find((candidate) => typeof candidate === "string" && candidate.trim());

  return typeof value === "string" ? value.trim() : null;
}

// getStringArray reads a string array from prompt JSON and supports compact object arrays.
function getStringArray(input: unknown) {
  return asArray(input)
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      return getStringField(item, ["title", "topic", "name", "task", "decision", "item", "speaker_label", "label"]);
    })
    .filter((item): item is string => Boolean(item));
}

// normalizeSourceType keeps source_type constrained to the database contract.
function normalizeSourceType(input: unknown): StructuredSourceType | null {
  return sourceTypes.find((sourceType) => sourceType === input) ?? null;
}

// normalizeOwnerCategory maps prompt ownership variants into Vosio's checklist buckets.
function normalizeOwnerCategory(input: unknown, fallback: StructuredOwnerCategory | null = null): StructuredOwnerCategory {
  if (ownerCategories.some((category) => category === input)) {
    return input as StructuredOwnerCategory;
  }

  if (input === "my_work" || input === "delivery_team" || input === "internal") {
    return "Moje práce";
  }

  if (input === "client" || input === "client_customer" || input === "customer") {
    return "Klient";
  }

  return fallback ?? "Nejasné";
}

// normalizeOptionalOwnerCategory returns null when ownership is not useful for this row type.
function normalizeOptionalOwnerCategory(input: unknown) {
  if (input === null || typeof input === "undefined") {
    return null;
  }

  return normalizeOwnerCategory(input);
}

// normalizeOwnerRole keeps business role values inside the stored contract.
function normalizeOwnerRole(input: unknown) {
  return ownerRoles.find((ownerRole) => ownerRole === input) ?? null;
}

// normalizeTaskStatus stores AI task states while defaulting actionable items to new.
function normalizeTaskStatus(input: unknown): StructuredTaskStatus {
  return taskStatuses.find((status) => status === input) ?? "new";
}

// normalizeConfidence stores only supported confidence labels.
function normalizeConfidence(input: unknown) {
  return confidenceLevels.find((level) => level === input) ?? null;
}

// normalizeDate keeps only ISO date strings that Postgres can store safely as a date.
function normalizeDate(input: unknown) {
  return typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? input
    : null;
}

// getRawItem keeps the original AI object for later debugging without storing prompt text.
function getRawItem(input: unknown) {
  return asRecord(input) ?? { value: input };
}

// getSectionArray returns the first array-like section matching any of the provided keys.
function getSectionArray(data: JsonRecord, keys: string[]) {
  const value = keys.map((key) => data[key]).find(Array.isArray);

  return asArray(value);
}

// buildTasks extracts checklist items from action prompts and meeting minute prompts.
function buildTasks(context: StructuredBuildContext, data: JsonRecord): StructuredTaskRow[] {
  const taskGroups = getTaskGroups(data);
  let position = 0;

  return taskGroups.flatMap((group) =>
    group.items
      .map((item) => buildTaskRow(context, item, group.ownerCategory, position += 1))
      .filter((row): row is StructuredTaskRow => Boolean(row))
  );
}

// getTaskGroups normalizes old and new prompt contracts into owner-aware item groups.
function getTaskGroups(data: JsonRecord): Array<{ items: unknown[]; ownerCategory: StructuredOwnerCategory }> {
  const tasksRoot = asRecord(data.tasks);

  if (tasksRoot) {
    return [
      { items: asArray(tasksRoot.my_work), ownerCategory: "Moje práce" },
      { items: asArray(tasksRoot.client), ownerCategory: "Klient" },
      { items: asArray(tasksRoot.unclear), ownerCategory: "Nejasné" }
    ];
  }

  return [
    { items: getSectionArray(data, ["action_items", "tasks", "cross_chapter_action_items"]), ownerCategory: "Nejasné" },
    { items: getSectionArray(data, ["unassigned_items"]), ownerCategory: "Nejasné" },
    { items: getSectionArray(data, ["blocked_items"]), ownerCategory: "Nejasné" }
  ];
}

// buildTaskRow converts one AI task object into the transcript_tasks insert shape.
function buildTaskRow(
  context: StructuredBuildContext,
  item: unknown,
  ownerCategory: StructuredOwnerCategory,
  position: number
): StructuredTaskRow | null {
  const title = getStringField(item, ["task", "title", "item", "step", "deliverable"]);

  if (!title) {
    return null;
  }

  const record = asRecord(item);
  const evidenceQuote = getStringField(item, ["evidence_quote", "evidence"]);
  const evidenceLocation = resolveEvidenceLocation(context.transcriptSegments, evidenceQuote);

  return {
    ai_output_id: context.aiOutputId,
    deadline: getStringField(item, ["deadline", "due", "term"]),
    deadline_confidence: getStringField(item, ["deadline_confidence", "deadline_type"]),
    deadline_normalized: normalizeDate(record?.deadline_normalized ?? record?.normalized_deadline),
    description: getStringField(item, ["context", "description", "reason", "impact", "notes"]),
    evidence_end_ms: evidenceLocation?.endMs ?? null,
    evidence_quote: evidenceQuote,
    evidence_start_ms: evidenceLocation?.startMs ?? null,
    owner_category: normalizeOwnerCategory(record?.owner_category ?? record?.owner_role, ownerCategory),
    owner_name: getStringField(item, ["owner_name", "owner"]),
    position,
    processing_job_id: context.processingJobId,
    raw_item: getRawItem(item),
    source_type: normalizeSourceType(record?.source_type),
    status: normalizeTaskStatus(record?.status),
    title,
    transcript_id: context.transcriptId,
    user_id: context.userId
  };
}

// buildChapters extracts AI timeline chapters for the timeline tab.
function buildChapters(context: StructuredBuildContext, data: JsonRecord): StructuredChapterRow[] {
  return getSectionArray(data, ["chapters", "timeline_chapters", "timeline"])
    .map((item, index) => buildChapterRow(context, item, index + 1))
    .filter((row): row is StructuredChapterRow => Boolean(row));
}

// buildChapterRow converts one AI timeline chapter into a stored chapter row.
function buildChapterRow(
  context: StructuredBuildContext,
  item: unknown,
  position: number
): StructuredChapterRow | null {
  const title = getStringField(item, ["title", "topic", "name"]) ?? "Kapitola";
  const record = asRecord(item);

  return {
    ai_output_id: context.aiOutputId,
    confidence: normalizeConfidence(record?.confidence),
    dominant_roles: getStringArray(record?.dominant_roles),
    end_time: getStringField(item, ["end_time", "end", "time_end"]),
    position,
    processing_job_id: context.processingJobId,
    raw_item: getRawItem(item),
    source_type: normalizeSourceType(record?.source_type),
    speakers: getStringArray(record?.speakers ?? record?.related_speakers),
    start_time: getStringField(item, ["start_time", "start", "time_start"]),
    summary: getStringField(item, ["summary", "description"]),
    title,
    topics: getStringArray(record?.topics),
    transcript_id: context.transcriptId,
    user_id: context.userId
  };
}

// buildDecisions extracts decisions and confirmations from multiple prompt contracts.
function buildDecisions(context: StructuredBuildContext, data: JsonRecord): StructuredDecisionRow[] {
  let position = 0;

  return getDecisionGroups(data)
    .flatMap((group) =>
      group.items.map((item) => buildDecisionRow(context, item, position += 1, group.defaultStatus))
    )
    .filter((row): row is StructuredDecisionRow => Boolean(row));
}

// getDecisionGroups separates unresolved confirmations from already decided items.
function getDecisionGroups(data: JsonRecord): DecisionGroup[] {
  return [
    { defaultStatus: "needs_confirmation", items: getSectionArray(data, ["decisions_to_confirm"]) },
    { defaultStatus: "decided", items: getSectionArray(data, ["decided_items"]) },
    { defaultStatus: null, items: getSectionArray(data, ["decisions"]) },
    { defaultStatus: null, items: getSectionArray(data, ["cross_chapter_decisions"]) }
  ];
}

// buildDecisionRow converts one AI decision into a stored decision row.
function buildDecisionRow(
  context: StructuredBuildContext,
  item: unknown,
  position: number,
  defaultStatus: string | null
): StructuredDecisionRow | null {
  const title = getStringField(item, ["decision", "title", "item", "agreement"]);

  if (!title) {
    return null;
  }

  const record = asRecord(item);
  const evidenceQuote = getStringField(item, ["evidence_quote", "evidence"]);
  const evidenceLocation = resolveEvidenceLocation(context.transcriptSegments, evidenceQuote);

  return {
    ai_output_id: context.aiOutputId,
    evidence_end_ms: evidenceLocation?.endMs ?? null,
    evidence_quote: evidenceQuote,
    evidence_start_ms: evidenceLocation?.startMs ?? null,
    owner_category: normalizeOptionalOwnerCategory(record?.owner_category),
    owner_role: normalizeOwnerRole(record?.owner_role),
    position,
    processing_job_id: context.processingJobId,
    raw_item: getRawItem(item),
    source_type: normalizeSourceType(record?.source_type),
    status: getStringField(item, ["status"]) ?? defaultStatus,
    title,
    transcript_id: context.transcriptId,
    user_id: context.userId
  };
}

// buildRisks extracts risks and blockers from AI output JSON.
function buildRisks(context: StructuredBuildContext, data: JsonRecord): StructuredRiskRow[] {
  const risks = [
    ...getSectionArray(data, ["risks_blockers"]),
    ...getSectionArray(data, ["risks_or_blockers"]),
    ...getSectionArray(data, ["risks"]),
    ...getSectionArray(data, ["blockers"])
  ];

  return risks
    .map((item, index) => buildRiskRow(context, item, index + 1))
    .filter((row): row is StructuredRiskRow => Boolean(row));
}

// buildRiskRow converts one AI risk or blocker into a stored risk row.
function buildRiskRow(
  context: StructuredBuildContext,
  item: unknown,
  position: number
): StructuredRiskRow | null {
  const title = getStringField(item, ["risk", "blocker", "item", "title"]);

  if (!title) {
    return null;
  }

  const record = asRecord(item);
  const evidenceQuote = getStringField(item, ["evidence_quote", "evidence"]);
  const evidenceLocation = resolveEvidenceLocation(context.transcriptSegments, evidenceQuote);

  return {
    ai_output_id: context.aiOutputId,
    evidence_end_ms: evidenceLocation?.endMs ?? null,
    evidence_quote: evidenceQuote,
    evidence_start_ms: evidenceLocation?.startMs ?? null,
    impact: getStringField(item, ["impact"]),
    mitigation: getStringField(item, ["mitigation", "mitigation_or_next_step", "needed_to_unblock"]),
    owner_category: normalizeOptionalOwnerCategory(record?.owner_category),
    owner_role: normalizeOwnerRole(record?.owner_role),
    position,
    processing_job_id: context.processingJobId,
    raw_item: getRawItem(item),
    source_type: normalizeSourceType(record?.source_type),
    title,
    transcript_id: context.transcriptId,
    user_id: context.userId
  };
}
