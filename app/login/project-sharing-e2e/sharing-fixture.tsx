"use client";
import { useRef, useState } from "react";
import { createCaptureAttempt, type CaptureAttempt } from "@/lib/recordings/capture";
import { bulkShareRecordings, type BulkSharingAttempt } from "@/lib/recording-sharing/bulk";
const project = "29000000-0000-4000-8000-000000000001";
const author = "19000000-0000-4000-8000-000000000001";
const request = "99000000-0000-4000-8000-000000000001";

// Exercise actual immutable capture and atomic caller contracts with local fakes, never browser/provider services.
export function ProjectSharingFixture() {
  const [selected, setSelected] = useState(false);
  const [snapshot, setSnapshot] = useState<CaptureAttempt | null>(null);
  const [result, setResult] = useState("");
  const attempt = useRef<BulkSharingAttempt | null>(null);
  const fail = useRef(true);
  const accepted = useRef(0);
  return <main><h1>Test projektového sdílení</h1>
    <label>Schválený výběr <input type="checkbox" checked={selected} onChange={(event) => setSelected(event.target.checked)} /></label>
    <button onClick={() => setSnapshot(createCaptureAttempt(selected ? { projectId: project, visibility: "selected", recipients: [{ userId: author, role: "editor" }] } : undefined, selected ? request : undefined))}>Zahájit místní pokus</button>
    <output aria-label="Scope relace">{snapshot ? JSON.stringify({ scope: snapshot.scope, requestId: snapshot.requestId }) : "Žádná relace"}</output>
    <button onClick={async () => {
      attempt.current ??= { requestId: request, recordingIds: [project, author], projectId: null, visibility: "selected", recipients: [{ userId: author, role: "reader" }] };
      try {
        await bulkShareRecordings({ rpc: async () => {
          if (fail.current) { fail.current = false; return { error: { code: "42501" }, data: null }; }
          accepted.current = 2;
          return { error: null, data: [author, project].sort().map((recording_id) => ({ recording_id, visibility: "selected" })) };
        } } as never, attempt.current);
        setResult(`Sdíleno ${accepted.current}, request ${attempt.current.requestId}`);
      } catch { setResult(`Sdíleno ${accepted.current}, request ${attempt.current.requestId}`); }
    }}>Sdílet nebo zopakovat celý výběr</button>
    <output aria-label="Bulk výsledek">{result}</output>
  </main>;
}
