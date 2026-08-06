export const RECORDING_CLIENT_COLUMNS = "id,user_id,name,color,created_at,updated_at";
export const RECORDING_PROJECT_COLUMNS = "id,client_id,user_id,name,color,created_at,updated_at";
export const RECORDING_FOLDER_COLUMNS = "id,user_id,name,color,created_at,updated_at";
export const RECORDING_TAG_COLUMNS = "id,user_id,name,color,created_at,updated_at";
export const RECORDING_TAG_LINK_WITH_TAG_COLUMNS =
  "tag_id,recording_tags(id,name,color)";

export type RecordingClientRow = {
  color: string | null;
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
  user_id: string;
};

export type RecordingProjectRow = RecordingClientRow & {
  client_id: string;
};

export type RecordingFolderRow = RecordingClientRow;
export type RecordingTagRow = RecordingClientRow;

export type RecordingClientPicker = Pick<RecordingClientRow, "color" | "id" | "name">;
export type RecordingProjectPicker = Pick<RecordingProjectRow, "client_id" | "color" | "id" | "name">;
export type RecordingFolderPicker = Pick<RecordingFolderRow, "id" | "name">;
export type RecordingTagPicker = Pick<RecordingTagRow, "color" | "id" | "name">;

export type RecordingOrganization = {
  client: RecordingClientPicker | null;
  folder: RecordingFolderPicker | null;
  project: Pick<RecordingProjectPicker, "id" | "name"> | null;
  tags: RecordingTagPicker[];
};

export type RecordingOrganizationOptions = {
  clients: RecordingClientRow[];
  folders: RecordingFolderRow[];
  projects: RecordingProjectRow[];
  tags: RecordingTagRow[];
};

export type RecordingOrganizationEntityKind = "client" | "project" | "folder" | "tag";

export type RecordingAssignment = {
  clientId: string | null;
  folderId: string | null;
  projectId: string | null;
  tagIds: string[];
};
