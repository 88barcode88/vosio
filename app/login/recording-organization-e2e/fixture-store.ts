import "server-only";

import type {
  RecordingClientRow,
  RecordingFolderRow,
  RecordingOrganization,
  RecordingOrganizationEntityKind,
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
  mutationCount: number;
  nextSuffix: number;
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

// allocateFixtureId returns one unused UUID while keeping every fixture scope bounded.
function allocateFixtureId(scope: string, state: FixtureState) {
  while (state.nextSuffix <= 15) {
    const id = fixtureId(scope, state.nextSuffix.toString(16));
    state.nextSuffix += 1;
    const exists = state.recordings.some((row) => row.id === id)
      || state.clients.some((row) => row.id === id)
      || state.projects.some((row) => row.id === id)
      || state.folders.some((row) => row.id === id)
      || state.tags.some((row) => row.id === id);
    if (!exists) return id;
  }
  throw new Error("Fixture entity capacity exceeded.");
}

// namesMatch applies the source schema's trimmed case-insensitive uniqueness rule.
function namesMatch(left: string, right: string) {
  return left.trim().toLocaleLowerCase("cs-CZ") === right.trim().toLocaleLowerCase("cs-CZ");
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
    mutationCount: 0,
    nextSuffix: 3,
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

// hasOrganizationFixture reports whether cleanup released one exact scope without creating it.
export function hasOrganizationFixture(scope: string) {
  return fixtures.has(scope);
}

// getOrganizationFixtureMutationCount exposes fixture-only mutation evidence without creating a scope.
export function getOrganizationFixtureMutationCount(scope: string) {
  return fixtures.get(scope)?.mutationCount ?? 0;
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
export function createFixtureClient(scope: string, name: string, color: string | null) {
  const state = requireFixtureState(scope);
  if (state.clients.some((row) => row.user_id === fixtureUserId && namesMatch(row.name, name))) {
    throw new Error("Fixture client name already exists.");
  }
  state.clients.push({
    color,
    created_at: fixtureTimestamp,
    id: allocateFixtureId(scope, state),
    name,
    updated_at: fixtureTimestamp,
    user_id: fixtureUserId
  });
  state.mutationCount += 1;
}

// createFixtureProject persists a project and classifies the one-tag regression row.
export function createFixtureProject(
  scope: string,
  clientId: string,
  name: string,
  color: string | null
) {
  const state = requireFixtureState(scope);
  if (!state.clients.some((row) => row.id === clientId && row.user_id === fixtureUserId)) {
    throw new Error("Fixture client not found.");
  }
  if (state.projects.some((row) =>
    row.user_id === fixtureUserId && row.client_id === clientId && namesMatch(row.name, name)
  )) {
    throw new Error("Fixture project name already exists.");
  }
  const projectId = allocateFixtureId(scope, state);
  state.projects.push({
    client_id: clientId,
    color,
    created_at: fixtureTimestamp,
    id: projectId,
    name,
    updated_at: fixtureTimestamp,
    user_id: fixtureUserId
  });
  state.recordings[1].client_id = clientId;
  state.recordings[1].project_id = projectId;
  state.mutationCount += 1;
}

// createFixtureFolder persists one owner-visible flat folder.
export function createFixtureFolder(scope: string, name: string, color: string | null) {
  const state = requireFixtureState(scope);
  if (state.folders.some((row) => row.user_id === fixtureUserId && namesMatch(row.name, name))) {
    throw new Error("Fixture folder name already exists.");
  }
  state.folders.push({
    color,
    created_at: fixtureTimestamp,
    id: allocateFixtureId(scope, state),
    name,
    updated_at: fixtureTimestamp,
    user_id: fixtureUserId
  });
  state.mutationCount += 1;
}

// createFixtureTag persists ordered tags and gives only the first one to the regression row.
export function createFixtureTag(scope: string, name: string, color: string | null) {
  const state = requireFixtureState(scope);
  const ownedTags = state.tags.filter((tag) => tag.user_id === fixtureUserId);
  if (ownedTags.some((row) => namesMatch(row.name, name))) {
    throw new Error("Fixture tag name already exists.");
  }
  const tagId = allocateFixtureId(scope, state);
  state.tags.push({
    color,
    created_at: fixtureTimestamp,
    id: tagId,
    name,
    updated_at: fixtureTimestamp,
    user_id: fixtureUserId
  });
  if (ownedTags.length === 0) state.tagIdsByRecording.set(state.recordings[1].id, [tagId]);
  state.mutationCount += 1;
}

// renameFixtureOrganizationEntity updates one owned row under schema-equivalent uniqueness rules.
export function renameFixtureOrganizationEntity(
  scope: string,
  kind: RecordingOrganizationEntityKind,
  entityId: string,
  name: string,
  color: string | null
) {
  const state = requireFixtureState(scope);
  const rows = kind === "client"
    ? state.clients
    : kind === "project"
      ? state.projects
      : kind === "folder"
        ? state.folders
        : state.tags;
  const row = rows.find((candidate) => candidate.id === entityId && candidate.user_id === fixtureUserId);
  if (!row) throw new Error("Fixture organization row not found.");

  const duplicate = rows.some((candidate) => {
    if (candidate.id === entityId || candidate.user_id !== fixtureUserId) return false;
    if (kind === "project") {
      return (candidate as RecordingProjectRow).client_id === (row as RecordingProjectRow).client_id
        && namesMatch(candidate.name, name);
    }
    return namesMatch(candidate.name, name);
  });
  if (duplicate) throw new Error("Fixture organization name already exists.");

  row.name = name;
  row.color = color;
  row.updated_at = fixtureTimestamp;
  state.mutationCount += 1;
}

// deleteFixtureOrganizationEntity applies the source schema's restrict, set-null and cascade semantics.
export function deleteFixtureOrganizationEntity(
  scope: string,
  kind: RecordingOrganizationEntityKind,
  entityId: string
) {
  const state = requireFixtureState(scope);
  if (kind === "client") {
    const index = state.clients.findIndex((row) => row.id === entityId && row.user_id === fixtureUserId);
    if (index < 0) throw new Error("Fixture client not found.");
    const isUsed = state.projects.some((row) => row.client_id === entityId && row.user_id === fixtureUserId)
      || state.recordings.some((row) => row.client_id === entityId && row.user_id === fixtureUserId);
    if (isUsed) throw new Error("Fixture client is still used.");
    state.clients.splice(index, 1);
  } else if (kind === "project") {
    const index = state.projects.findIndex((row) => row.id === entityId && row.user_id === fixtureUserId);
    if (index < 0) throw new Error("Fixture project not found.");
    state.projects.splice(index, 1);
    for (const recording of state.recordings) {
      if (recording.user_id === fixtureUserId && recording.project_id === entityId) {
        recording.project_id = null;
      }
    }
  } else if (kind === "folder") {
    const index = state.folders.findIndex((row) => row.id === entityId && row.user_id === fixtureUserId);
    if (index < 0) throw new Error("Fixture folder not found.");
    state.folders.splice(index, 1);
    for (const recording of state.recordings) {
      if (recording.user_id === fixtureUserId && recording.folder_id === entityId) {
        recording.folder_id = null;
      }
    }
  } else {
    const index = state.tags.findIndex((row) => row.id === entityId && row.user_id === fixtureUserId);
    if (index < 0) throw new Error("Fixture tag not found.");
    state.tags.splice(index, 1);
    for (const [recordingId, tagIds] of state.tagIdsByRecording) {
      state.tagIdsByRecording.set(recordingId, tagIds.filter((tagId) => tagId !== entityId));
    }
  }
  state.mutationCount += 1;
}

// assignFixtureRecording atomically replaces the primary recording assignment in fixture storage.
export function assignFixtureRecording(
  scope: string,
  assignment: RecordingOrganizationFilters,
  recordingId: string
) {
  const state = requireFixtureState(scope);
  const recording = state.recordings.find((row) =>
    row.id === recordingId && row.user_id === fixtureUserId && row.status !== "deleted"
  );
  if (!recording) throw new Error("Fixture recording not found.");
  if (assignment.clientId && !state.clients.some((row) =>
    row.id === assignment.clientId && row.user_id === fixtureUserId
  )) {
    throw new Error("Fixture client not found.");
  }
  if (assignment.projectId && !state.projects.some((row) =>
    row.id === assignment.projectId
    && row.client_id === assignment.clientId
    && row.user_id === fixtureUserId
  )) {
    throw new Error("Fixture project does not belong to client.");
  }
  if (assignment.folderId && !state.folders.some((row) =>
    row.id === assignment.folderId && row.user_id === fixtureUserId
  )) {
    throw new Error("Fixture folder not found.");
  }
  if (assignment.tagIds.some((tagId) => !state.tags.some((row) =>
    row.id === tagId && row.user_id === fixtureUserId
  ))) {
    throw new Error("Fixture tag not found.");
  }
  recording.client_id = assignment.clientId;
  recording.folder_id = assignment.folderId;
  recording.project_id = assignment.projectId;
  state.tagIdsByRecording.set(recordingId, [...assignment.tagIds]);
  state.mutationCount += 1;
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
