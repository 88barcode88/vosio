import type { RecordingAccessContext, RecordingCapabilities, RecordingShareRole } from "./types";

// getRecordingCapabilities mirrors DB custody rules for presentation; RPC/RLS remains authoritative.
export function getRecordingCapabilities(context: RecordingAccessContext): RecordingCapabilities {
  const actor = context.actorId;
  const projectCustody = context.projectId !== null && context.visibility !== "private";
  const manager = actor !== null && (projectCustody ? actor === context.founderId : actor === context.ownerId);
  const role = context.visibility === "project"
    ? context.memberRole
    : context.visibility === "selected" && context.grantScopeProjectId === context.projectId
      ? context.grantRole : null;
  const active = context.status !== "deleted";
  const read = actor !== null && (manager || (active && role !== null));
  const edit = read && active && (manager || role === "editor");
  return {
    read, editTitle: edit, editSpeakers: edit, editTaskStatus: edit,
    manageAccess: manager && active, delete: manager && active,
    restore: manager && !active, purge: manager && !active,
    runPersonalAi: manager && active && actor === context.ownerId,
    usePrivateChat: manager && active && actor === context.ownerId,
  };
}

// getProjectCapabilities resolves project-level capture separately from recording access.
export function getProjectCapabilities(role: RecordingShareRole | null, isFounder: boolean) {
  return { read: isFounder || role !== null, addRecording: isFounder || role === "editor", manageAccess: isFounder };
}
