import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCaptureAttempt, createCaptureDraft, applyCaptureTransition, captureScopeSchema } from "@/lib/recordings/capture";

const id = "10000000-0000-4000-8000-000000000001";
const project = "20000000-0000-4000-8000-000000000001";

describe("capture scope and canonical writes", () => {
  it("drains attribution backfill FK events before recording DDL and restores deferred mode", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260922190000_add_project_sharing.sql"), "utf8")
      .replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
    expect(sql).toContain("created_by uuid references auth.users(id) on delete no action deferrable initially deferred");
    expect(sql).toContain("disable trigger recordings_set_updated_at; update public.recordings set created_by = user_id; set constraints public.recordings_created_by_fkey immediate; alter table public.recordings enable trigger recordings_set_updated_at; alter table public.recordings alter column created_by set not null; alter table public.recordings alter column created_by set default auth.uid(); set constraints public.recordings_created_by_fkey deferred;");
    expect(sql).not.toMatch(/set constraints all|disable trigger (all|user)/);
  });

  it("freezes each item's private default and exact selected scope before draft", () => {
    const recipients = [{ userId: id, role: "editor" as const }];
    const selected = createCaptureAttempt({ projectId: project, visibility: "selected", recipients });
    recipients[0]!.role = "reader" as "editor";
    expect(selected.scope.recipients[0]!.role).toBe("editor");
    expect(Object.isFrozen(selected.scope.recipients)).toBe(true);
    expect(createCaptureAttempt().scope).toEqual({ projectId: null, visibility: "private", recipients: [] });
    expect(captureScopeSchema.safeParse({ projectId: null, visibility: "project", recipients: [] }).success).toBe(false);
  });

  it("retries the identical create request and lets DB derive attribution", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: id, error: null });
    const attempt = createCaptureAttempt({ projectId: project, visibility: "project", recipients: [] });
    const client = { rpc } as never;
    await createCaptureDraft(client, attempt, "Schůzka", "upload");
    await createCaptureDraft(client, attempt, "Schůzka", "upload");
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0]![1]).toEqual({ p_request_id: attempt.requestId, p_title: "Schůzka", p_source_type: "upload", p_project_id: project, p_visibility: "project", p_recipients: [] });
  });

  it("never retries denied editor/reader/revoked writes through admin", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(createCaptureDraft({ rpc } as never, createCaptureAttempt(), "A", "upload")).rejects.toMatchObject({ code: "42501" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps exact transition UUID, revision and payload after an uncertain response", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { code: "network" } })
      .mockResolvedValueOnce({ data: { recordingId: id, captureRevision: 1, status: "uploaded", transcriptId: null, jobId: null }, error: null });
    const attempt = createCaptureAttempt();
    attempt.recordingId = id;
    const payload = { transition: "upload_complete" as const, mimeType: "audio/webm", fileSizeBytes: 50 };
    await expect(applyCaptureTransition({ rpc } as never, attempt, "complete", payload)).rejects.toThrow();
    await applyCaptureTransition({ rpc } as never, attempt, "complete", payload);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(attempt.captureRevision).toBe(1);
  });
});
