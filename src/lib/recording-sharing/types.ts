export type RecordingVisibility = "private" | "project" | "selected";
export type RecordingShareRole = "reader" | "editor";

/** Server-resolved facts only; never construct this context from browser claims. */
export type RecordingAccessContext = {
  actorId: string | null;
  ownerId: string;
  createdBy: string;
  projectId: string | null;
  founderId: string | null;
  visibility: RecordingVisibility;
  status: string;
  memberRole: RecordingShareRole | null;
  grantRole: RecordingShareRole | null;
  grantScopeProjectId: string | null;
};

export type RecordingCapabilities = {
  read: boolean;
  editTitle: boolean;
  editSpeakers: boolean;
  editTaskStatus: boolean;
  manageAccess: boolean;
  delete: boolean;
  restore: boolean;
  purge: boolean;
  runPersonalAi: boolean;
  usePrivateChat: boolean;
};

export type SpeakerPatchResult = {
  outcome: "saved" | "conflict";
  speaker: Record<string, unknown>;
  version: number;
  searchVersion: number;
};
