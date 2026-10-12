import { describe, expect, it } from "vitest";
import { getRecordingCapabilities, getProjectCapabilities } from "@/lib/recording-sharing/capabilities";
import { createRecordingWithAccessSchema, speakerPatchSchema } from "@/lib/recording-sharing/validation";
import type { RecordingAccessContext } from "@/lib/recording-sharing/types";

const F = "10000000-0000-4000-8000-000000000001";
const E = "10000000-0000-4000-8000-000000000002";
const R = "10000000-0000-4000-8000-000000000003";
const P = "20000000-0000-4000-8000-000000000001";
const base: RecordingAccessContext = {
  actorId: E, ownerId: E, createdBy: E, projectId: P, founderId: F,
  visibility: "private", status: "completed", memberRole: "editor", grantRole: null,
  grantScopeProjectId: null,
};

describe("recording sharing capabilities", () => {
  it("keeps assigned private recordings invisible even to the founder", () => {
    expect(getRecordingCapabilities({ ...base, actorId: F }).read).toBe(false);
    expect(getRecordingCapabilities(base).manageAccess).toBe(true);
  });
  it("gives project editors only the three content edits", () => {
    const caps = getRecordingCapabilities({ ...base, visibility: "project" });
    expect(caps).toEqual({ read: true, editTitle: true, editSpeakers: true, editTaskStatus: true,
      manageAccess: false, delete: false, restore: false, purge: false, runPersonalAi: false, usePrivateChat: false });
  });
  it("does not use authorship or technical ownership to bypass a revoke", () => {
    expect(getRecordingCapabilities({ ...base, visibility: "project", memberRole: null }).read).toBe(false);
    expect(getRecordingCapabilities({ ...base, visibility: "selected" }).read).toBe(false);
  });
  it("never expands selected recordings through project membership", () => {
    expect(getRecordingCapabilities({ ...base, visibility: "selected", actorId: R, memberRole: "reader" }).read).toBe(false);
    expect(getRecordingCapabilities({ ...base, visibility: "selected", actorId: R,
      grantRole: "reader", grantScopeProjectId: P, memberRole: null }).read).toBe(true);
    expect(getRecordingCapabilities({ ...base, visibility: "selected", actorId: R,
      grantRole: "editor", grantScopeProjectId: null }).read).toBe(false);
  });
  it("makes project custody belong to the founder", () => {
    const caps = getRecordingCapabilities({ ...base, visibility: "selected", actorId: F });
    expect(caps.manageAccess).toBe(true);
    expect(caps.delete).toBe(true);
    expect(caps.usePrivateChat).toBe(false);
    expect(caps.runPersonalAi).toBe(false);
  });
  it("keeps personal AI tied to the original provider owner and current authority", () => {
    expect(getRecordingCapabilities(base).runPersonalAi).toBe(true);
    expect(getRecordingCapabilities({ ...base, actorId: F, ownerId: F, createdBy: F, visibility: "project" }).runPersonalAi).toBe(true);
    expect(getRecordingCapabilities({ ...base, actorId: F, visibility: "project" }).runPersonalAi).toBe(false);
    expect(getRecordingCapabilities({ ...base, visibility: "project", memberRole: null }).runPersonalAi).toBe(false);
    expect(getRecordingCapabilities({ ...base, actorId: R, projectId: null, visibility: "selected", grantRole: "editor" }).runPersonalAi).toBe(false);
  });
  it("keeps standalone grants independent and the owner as manager", () => {
    expect(getRecordingCapabilities({ ...base, projectId: null, founderId: null, visibility: "selected" }).manageAccess).toBe(true);
    const caps = getRecordingCapabilities({ ...base, projectId: null, founderId: null, visibility: "selected",
      actorId: R, grantRole: "reader" });
    expect(caps.read).toBe(true);
    expect(caps.editTitle).toBe(false);
    expect(caps.manageAccess).toBe(false);
  });
  it("fails closed without session and hides Trash from shared recipients", () => {
    expect(getRecordingCapabilities({ ...base, actorId: null }).read).toBe(false);
    expect(getRecordingCapabilities({ ...base, visibility: "project", status: "deleted" }).read).toBe(false);
    const caps = getRecordingCapabilities({ ...base, visibility: "project", status: "deleted", actorId: F });
    expect(caps.restore).toBe(true);
    expect(caps.editSpeakers).toBe(false);
  });
  it("allows capture for founder/editor but access management only for founder", () => {
    expect(getProjectCapabilities("editor", false)).toEqual({ read: true, addRecording: true, manageAccess: false });
    expect(getProjectCapabilities("reader", false).addRecording).toBe(false);
    expect(getProjectCapabilities(null, false).read).toBe(false);
    expect(getProjectCapabilities(null, true).manageAccess).toBe(true);
  });
});

describe("sharing input validation", () => {
  const draft = { requestId: R, title: "Call", sourceType: "realtime" };
  it("defaults capture to private and permits clientless projects", () => {
    expect(createRecordingWithAccessSchema.parse({ ...draft, projectId: P }).visibility).toBe("private");
  });
  it("rejects project visibility without a project and private recipient grants", () => {
    expect(createRecordingWithAccessSchema.safeParse({ ...draft, visibility: "project" }).success).toBe(false);
    expect(createRecordingWithAccessSchema.safeParse({ ...draft, recipients: [{ userId: E, role: "reader" }] }).success).toBe(false);
    expect(createRecordingWithAccessSchema.safeParse({ ...draft, visibility: "selected", recipients: [] }).success).toBe(false);
  });
  it("rejects duplicate recipients, unknown fields, and invalid roles", () => {
    const recipient = { userId: E, role: "reader" };
    expect(createRecordingWithAccessSchema.safeParse({ ...draft, visibility: "selected", recipients: [recipient, recipient] }).success).toBe(false);
    expect(createRecordingWithAccessSchema.safeParse({ ...draft, userId: F }).success).toBe(false);
    expect(createRecordingWithAccessSchema.safeParse({ ...draft, visibility: "selected", recipients: [{ userId: E, role: "admin" }] }).success).toBe(false);
  });
  it("requires a database speaker slot version and bounded patch", () => {
    expect(speakerPatchSchema.safeParse({ transcriptId: R, speakerId: "1", expectedVersion: 0, name: " Jana ", role: "unknown" }).success).toBe(true);
    expect(speakerPatchSchema.safeParse({ transcriptId: R, speakerId: "1", name: "Jana", role: "unknown" }).success).toBe(false);
    expect(speakerPatchSchema.safeParse({ transcriptId: R, speakerId: "1", expectedVersion: -1, name: "Jana", role: "unknown" }).success).toBe(false);
  });
});
