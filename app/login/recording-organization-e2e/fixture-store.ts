import "server-only";

import type {
  RecordingClientRow,
  RecordingFolderRow,
  RecordingOrganization,
  RecordingOrganizationOptions,
  RecordingProjectRow,
  RecordingTagRow
} from "@/lib/recording-organization/types";
import type { RecordingOrganizationFilters } from "@/lib/recording-organization/filters";
import { recordingMatchesSearch } from "@/lib/recordings/queries";
import type { RecordingRow } from "@/lib/recordings/types";

const fixtureUserId = "00000000-0000-4000-8000-000000000001";
const foreignUserId = "00000000-0000-4000-8000-000000000099";
const fixtureTimestamp = "2026-08-05T10:00:00.000Z";
const maxScopes = 32;

type FixtureState = {
  clients: RecordingClientRow[];
  folders: RecordingFolderRow[];
  projects: RecordingProjectRow[];
  recordings: RecordingRow[];
  tagIdsByRecording: Map<string, string[]>;
  tags: RecordingTagRow[];
};

type FixtureGlobal = typeof globalThis & {
  __vosioRecordingOrganizationFixtures?: Map<string, FixtureState>;
};

// fixtureId creates a valid UUID isolated by the eleven-character Playwright scope.
function fixtureId(scope: string, suffix: string) {
  return `00000000-0000-4000-8000-${scope}${suffix}`;
}

// createRecording builds one development-only list row without external storage.
function createRecording(scope: string, suffix: string, title: string, createdAt: string): RecordingRow {
  return {
    client_id: null,
    created_at: createdAt,
    duration_seconds: 120,
    error_message: null,
    file_size_bytes: null,
    folder_id: null,
    id: fixtureId(scope, suffix),
    mime_type: null,
    project_id: null,
    source_type: "realtime",
    status: "completed",
    storage_path: null,
    title,
    updated_at: createdAt,
    user_id: fixtureUserId
  };
}

// createFixtureState seeds recordings plus foreign lookup rows that owner projections must hide.
function createFixtureState(scope: string): FixtureState {
  return {
    clients: [{
      color: null,
      created_at: fixtureTimestamp,
      id: fixtureId(scope, "8"),
      name: "Foreign Client",
      updated_at: fixtureTimestamp,
      user_id: foreignUserId
    }],
    folders: [],
    projects: [{
      client_id: fixtureId(scope, "8"),
      color: null,
      created_at: fixtureTimestamp,
      id: fixtureId(scope, "9"),
      name: "Foreign Project",
      updated_at: fixtureTimestamp,
      user_id: foreignUserId
    }],
    recordings: [
      createRecording(scope, "1", "Call Acme hlavní", "2026-08-05T10:00:00.000Z"),
      createRecording(scope, "2", "Call jen jeden štítek", "2026-08-05T09:00:00.000Z")
    ],
    tagIdsByRecording: new Map(),
    tags: [{
      color: null,
      created_at: fixtureTimestamp,
      id: fixtureId(scope, "a"),
      name: "Foreign Tag",
      updated_at: fixtureTimestamp,
      user_id: foreignUserId
    }]
  };
}

const fixtureGlobal = globalThis as FixtureGlobal;
const fixtures = fixtureGlobal.__vosioRecordingOrganizationFixtures ?? new Map<string, FixtureState>();
fixtureGlobal.__vosioRecordingOrganizationFixtures = fixtures;

// requireFixtureState returns one bounded isolated fixture and evicts the oldest scope if needed.
function requireFixtureState(scope: string) {
  const existing = fixtures.get(scope);
  if (existing) return existing;
  if (fixtures.size >= maxScopes) {
    const oldest = fixtures.keys().next().value;
    if (oldest) fixtures.delete(oldest);
  }
  const state = createFixtureState(scope);
  fixtures.set(scope, state);
  return state;
}

// resetOrganizationFixture restores one scope for deterministic parallel E2E projects.
export function resetOrganizationFixture(scope: string) {
  fixtures.set(scope, createFixtureState(scope));
}

// deleteOrganizationFixture releases one Playwright scope after its browser journey.
export function deleteOrganizationFixture(scope: string) {
  fixtures.delete(scope);
}

// getOrganizationFixtureSnapshot exposes only rows owned by the fixture user.
export function getOrganizationFixtureSnapshot(scope: string) {
  const state = requireFixtureState(scope);
  const options: RecordingOrganizationOptions = {
    clients: state.clients.filter((row) => row.user_id === fixtureUserId),
    folders: state.folders.filter((row) => row.user_id === fixtureUserId),
    projects: state.projects.filter((row) => row.user_id === fixtureUserId),
    tags: state.tags.filter((row) => row.user_id === fixtureUserId)
  };
  const primary = state.recordings[0];
  const organization: RecordingOrganization = {
    client: options.clients.find((row) => row.id === primary.client_id) ?? null,
    folder: options.folders.find((row) => row.id === primary.folder_id) ?? null,
    project: options.projects.find((row) => row.id === primary.project_id) ?? null,
    tags: options.tags.filter((row) => (state.tagIdsByRecording.get(primary.id) ?? []).includes(row.id))
  };
  return { options, organization, primary, recordings: state.recordings };
}

// createFixtureClient persists one owner-visible client through the dev external boundary.
export function createFixtureClient(scope: string, name: string) {
  const state = requireFixtureState(scope);
  state.clients.push({
    color: null,
    created_at: fixtureTimestamp,
    id: fixtureId(scope, "3"),
    name,
    updated_at: fixtureTimestamp,
    user_id: fixtureUserId
  });
}

// createFixtureProject persists a project and classifies the one-tag regression row.
export function createFixtureProject(scope: string, clientId: string, name: string) {
  const state = requireFixtureState(scope);
  const projectId = fixtureId(scope, "4");
  state.projects.push({
    client_id: clientId,
    color: null,
    created_at: fixtureTimestamp,
    id: projectId,
    name,
    updated_at: fixtureTimestamp,
    user_id: fixtureUserId
  });
  state.recordings[1].client_id = clientId;
  state.recordings[1].project_id = projectId;
}

// createFixtureTag persists ordered tags and gives only the first one to the regression row.
export function createFixtureTag(scope: string, name: string) {
  const state = requireFixtureState(scope);
  const ownedTags = state.tags.filter((tag) => tag.user_id === fixtureUserId);
  const tagId = fixtureId(scope, ownedTags.length === 0 ? "5" : "6");
  state.tags.push({
    color: null,
    created_at: fixtureTimestamp,
    id: tagId,
    name,
    updated_at: fixtureTimestamp,
    user_id: fixtureUserId
  });
  if (ownedTags.length === 0) state.tagIdsByRecording.set(state.recordings[1].id, [tagId]);
}

// assignFixtureRecording atomically replaces the primary recording assignment in fixture storage.
export function assignFixtureRecording(
  scope: string,
  assignment: RecordingOrganizationFilters,
  recordingId: string
) {
  const state = requireFixtureState(scope);
  const recording = state.recordings.find((row) => row.id === recordingId);
  if (!recording) throw new Error("Fixture recording not found.");
  recording.client_id = assignment.clientId;
  recording.folder_id = assignment.folderId;
  recording.project_id = assignment.projectId;
  state.tagIdsByRecording.set(recordingId, [...assignment.tagIds]);
}

// listOrganizationFixtureRecordings mocks only the external query boundary with real ALL semantics.
export function listOrganizationFixtureRecordings(
  scope: string,
  filters: RecordingOrganizationFilters,
  normalizedQuery: string
) {
  const state = requireFixtureState(scope);
  return state.recordings.filter((recording) => {
    const assignedTagIds = state.tagIdsByRecording.get(recording.id) ?? [];
    return (!filters.clientId || recording.client_id === filters.clientId)
      && (!filters.projectId || recording.project_id === filters.projectId)
      && (!filters.folderId || recording.folder_id === filters.folderId)
      && filters.tagIds.every((tagId) => assignedTagIds.includes(tagId))
      && recordingMatchesSearch(recording, normalizedQuery);
  });
}
