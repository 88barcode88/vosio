import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RECORDING_CLIENT_COLUMNS,
  RECORDING_FOLDER_COLUMNS,
  RECORDING_PROJECT_COLUMNS,
  RECORDING_TAG_COLUMNS,
  RECORDING_TAG_LINK_WITH_TAG_COLUMNS,
  type RecordingClientPicker,
  type RecordingClientRow,
  type RecordingFolderPicker,
  type RecordingFolderRow,
  type RecordingOrganization,
  type RecordingOrganizationOptions,
  type RecordingProjectRow,
  type RecordingTagPicker,
  type RecordingTagRow
} from "@/lib/recording-organization/types";
import type { RecordingRow } from "@/lib/recordings/types";
import { fetchAllRows } from "@/lib/supabase/pagination";

type RecordingTagJoinRow = {
  recording_tags: RecordingTagPicker | RecordingTagPicker[] | null;
  tag_id: string;
};

// listOrganizationRows pages one explicit organization table projection in stable name order.
async function listOrganizationRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  errorLabel: string
) {
  return fetchAllRows<T>(errorLabel, (from, to) =>
    supabase
      .from(table)
      .select(columns)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
      .returns<T[]>()
  );
}

// getOwnedOrganizationRow resolves one lookup row through the request-scoped RLS client.
async function getOwnedOrganizationRow<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  id: string | null,
  errorLabel: string
): Promise<T | null> {
  if (!id) {
    return null;
  }

  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`${errorLabel}: ${error.message}`);
  }

  return data as T | null;
}

// normalizeJoinedTag accepts PostgREST's to-one object while tolerating generated array shapes.
function normalizeJoinedTag(value: RecordingTagJoinRow["recording_tags"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

// listRecordingOrganizationOptions loads all owner-visible lookup choices without admin access.
export async function listRecordingOrganizationOptions(
  supabase: SupabaseClient
): Promise<RecordingOrganizationOptions> {
  const [clients, projects, folders, tags] = await Promise.all([
    listOrganizationRows<RecordingClientRow>(
      supabase,
      "recording_clients",
      RECORDING_CLIENT_COLUMNS,
      "Unable to load recording clients"
    ),
    listOrganizationRows<RecordingProjectRow>(
      supabase,
      "recording_projects",
      RECORDING_PROJECT_COLUMNS,
      "Unable to load recording projects"
    ),
    listOrganizationRows<RecordingFolderRow>(
      supabase,
      "recording_folders",
      RECORDING_FOLDER_COLUMNS,
      "Unable to load recording folders"
    ),
    listOrganizationRows<RecordingTagRow>(
      supabase,
      "recording_tags",
      RECORDING_TAG_COLUMNS,
      "Unable to load recording tags"
    )
  ]);

  const resolvedProjects = await Promise.all(projects.map(async (project) => {
    const [capture, { data: founder, error: founderError }] = await Promise.all([
      supabase.rpc("can_capture_in_recording_project", { p_project_id: project.id }),
      supabase.rpc("is_recording_project_founder_v1", { p_project_id: project.id })
    ]);
    if (capture.error) throw new Error("Unable to load project capture authority");
    if (founderError) throw new Error("Unable to load project authority");
    if (founder !== true) return { ...project, client_id: null, can_manage_access: false, can_capture: capture.data === true };
    const { data, error } = await supabase.rpc("get_personal_recording_project_v1", { p_project_id: project.id });
    if (error || !data || data.id !== project.id) throw new Error("Unable to load personal project metadata");
    return { ...project, client_id: typeof data.client_id === "string" ? data.client_id : null, can_manage_access: true, can_capture: capture.data === true };
  }));
  return { clients, folders, projects: resolvedProjects, tags };
}

// getRecordingOrganization builds a separate nullable organization projection for one recording.
export async function getRecordingOrganization(
  supabase: SupabaseClient,
  recording: RecordingRow
): Promise<RecordingOrganization> {
  const [client, project, folder, tagResult] = await Promise.all([
    getOwnedOrganizationRow<RecordingClientPicker>(
      supabase,
      "recording_clients",
      "id,name,color",
      recording.client_id,
      "Unable to load recording client"
    ),
    Promise.resolve(recording.project_id && recording.project_name
      ? { id: recording.project_id, name: recording.project_name, color: null } : null),
    getOwnedOrganizationRow<RecordingFolderPicker>(
      supabase,
      "recording_folders",
      "id,name,color",
      recording.folder_id,
      "Unable to load recording folder"
    ),
    recording.tag_ids?.length ? supabase
      .from("recording_tag_links").select(RECORDING_TAG_LINK_WITH_TAG_COLUMNS)
      .eq("recording_id", recording.id).in("tag_id", recording.tag_ids)
      .order("tag_id", { ascending: true }).returns<RecordingTagJoinRow[]>()
      : Promise.resolve({ data: [], error: null })
  ]);

  if (tagResult.error) {
    throw new Error(`Unable to load recording tags: ${tagResult.error.message}`);
  }

  const tags = (tagResult.data ?? [])
    .map((row) => normalizeJoinedTag(row.recording_tags))
    .filter((tag): tag is RecordingTagPicker => tag !== null)
    .sort((left, right) => left.name.localeCompare(right.name, "cs-CZ") || left.id.localeCompare(right.id));

  return { client, folder, project, tags };
}
