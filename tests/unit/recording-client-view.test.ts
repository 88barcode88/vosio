import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilesContent } from "@/components/transcript-tabs/files-content";
import { UtilityWorkspaceView } from "@/components/workspace/utility-workspace-view";
import { toRecordingClientView } from "@/lib/recordings/client-view";
import type { RecordingRow } from "@/lib/recordings/types";
import { defaultUserSettings } from "@/lib/settings/types";

const recordingWithStoragePath: RecordingRow = {
  client_id: null,
  created_at: "2026-08-05T08:00:00.000Z",
  deleted_at: "2026-08-05T08:30:00.000Z",
  duration_seconds: 60,
  error_message: null,
  file_size_bytes: 1024,
  folder_id: null,
  id: "11111111-1111-4111-8111-111111111111",
  mime_type: "audio/webm",
  purge_after: "2026-09-04T08:30:00.000Z",
  project_id: null,
  source_type: "upload",
  status: "completed",
  storage_path: "private-user/private-recording/audio.webm",
  title: "Soukromý call",
  trash_retention_hours: 720,
  updated_at: "2026-08-05T08:01:00.000Z",
  user_id: "private-user"
};

describe("recording client view", () => {
  it("serializes only safe recording metadata", () => {
    const view = toRecordingClientView(recordingWithStoragePath);
    const serialized = JSON.stringify(view);

    expect(Object.keys(view).sort()).toEqual([
      "audioAvailability",
      "created_at",
      "deleted_at",
      "duration_seconds",
      "file_size_bytes",
      "id",
      "mime_type",
      "purge_after",
      "source_type",
      "status",
      "title",
      "trash_retention_hours",
      "updated_at"
    ]);
    expect(view).toMatchObject({
      audioAvailability: "single",
      deleted_at: "2026-08-05T08:30:00.000Z",
      file_size_bytes: 1024,
      mime_type: "audio/webm",
      purge_after: "2026-09-04T08:30:00.000Z",
      trash_retention_hours: 720
    });
    expect(view).not.toHaveProperty("storage_path");
    expect(view).not.toHaveProperty("user_id");
    expect(view).not.toHaveProperty("error_message");
    expect(serialized).not.toContain("storage_path");
    expect(serialized).not.toContain(recordingWithStoragePath.storage_path);
    expect(serialized).not.toContain(recordingWithStoragePath.user_id);
  });

  it("maps each private Storage shape to the public availability contract", () => {
    expect(toRecordingClientView({
      ...recordingWithStoragePath,
      storage_path: null
    }).audioAvailability).toBe("none");
    expect(toRecordingClientView({
      ...recordingWithStoragePath,
      storage_path: "private-user/private-recording/live/"
    }).audioAvailability).toBe("segmented");
    expect(toRecordingClientView(recordingWithStoragePath).audioAvailability).toBe("single");
  });

  it("renders safe availability metadata in Files and Trash without the object key", () => {
    const view = toRecordingClientView(recordingWithStoragePath);
    const filesMarkup = renderToStaticMarkup(createElement(FilesContent, {
      activeRecording: view
    }));
    const trashMarkup = renderToStaticMarkup(createElement(UtilityWorkspaceView, {
      aiOutputs: [],
      deletedRecordings: [view],
      promptTemplates: [],
      settings: defaultUserSettings,
      settingsStatus: null,
      templateStatus: null,
      view: "trash"
    }));

    expect(filesMarkup).toContain("Jeden audio soubor");
    expect(filesMarkup).toContain("audio/webm");
    expect(trashMarkup).toContain("jeden soubor");
    expect(trashMarkup).toContain("5. 8. 2026 10:30");
    expect(trashMarkup).toContain("4. 9. 2026 10:30");
    expect(trashMarkup).toContain("30 dní");
    expect(filesMarkup).not.toContain(recordingWithStoragePath.storage_path as string);
    expect(trashMarkup).not.toContain(recordingWithStoragePath.storage_path as string);
  });
});
