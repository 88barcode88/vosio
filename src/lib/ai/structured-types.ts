export type StructuredOwnerCategory = "Moje práce" | "Klient" | "Nejasné";

export type StructuredSourceType = "explicit" | "inferred" | "unknown";

export type StructuredTaskStatus = "new" | "in_progress" | "waiting" | "done" | "unclear" | "ignored";

export type StructuredTaskRow = {
  ai_output_id: string;
  created_at?: string;
  deadline: string | null;
  deadline_confidence: string | null;
  deadline_normalized: string | null;
  description: string | null;
  evidence_quote: string | null;
  id?: string;
  owner_category: StructuredOwnerCategory;
  owner_name: string | null;
  position: number;
  processing_job_id: string;
  raw_item: unknown;
  source_type: StructuredSourceType | null;
  status: StructuredTaskStatus;
  title: string;
  transcript_id: string;
  updated_at?: string;
  user_id: string;
};

export type StructuredChapterRow = {
  ai_output_id: string;
  confidence: "high" | "medium" | "low" | null;
  created_at?: string;
  dominant_roles: unknown[];
  end_time: string | null;
  id?: string;
  position: number;
  processing_job_id: string;
  raw_item: unknown;
  source_type: StructuredSourceType | null;
  speakers: unknown[];
  start_time: string | null;
  summary: string | null;
  title: string;
  topics: unknown[];
  transcript_id: string;
  updated_at?: string;
  user_id: string;
};

export type StructuredDecisionRow = {
  ai_output_id: string;
  created_at?: string;
  evidence_quote: string | null;
  id?: string;
  owner_category: StructuredOwnerCategory | null;
  owner_role: "client_customer" | "delivery_team" | "unknown" | null;
  position: number;
  processing_job_id: string;
  raw_item: unknown;
  source_type: StructuredSourceType | null;
  status: string | null;
  title: string;
  transcript_id: string;
  updated_at?: string;
  user_id: string;
};

export type StructuredRiskRow = {
  ai_output_id: string;
  created_at?: string;
  id?: string;
  impact: string | null;
  mitigation: string | null;
  owner_category: StructuredOwnerCategory | null;
  owner_role: "client_customer" | "delivery_team" | "unknown" | null;
  position: number;
  processing_job_id: string;
  raw_item: unknown;
  source_type: StructuredSourceType | null;
  title: string;
  transcript_id: string;
  updated_at?: string;
  user_id: string;
};

export type StructuredAiItems = {
  chapters: StructuredChapterRow[];
  decisions: StructuredDecisionRow[];
  risks: StructuredRiskRow[];
  tasks: StructuredTaskRow[];
};
