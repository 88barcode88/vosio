import { Plus } from "lucide-react";
import Link from "next/link";
import { DeleteRecordingForm } from "@/components/delete-recording-form";
import { LiveRecordingRecoveryPanel } from "@/components/live-recording-recovery-panel";
import { RecordingTitleEditor } from "@/components/workspace/recording-title-editor";
import { getRecordingCounts, getSourceTypeLabel } from "@/components/workspace/utils";
import {
  formatFileSize,
  formatRecordingDate,
  getStatusLabel,
  type RecordingRow
} from "@/lib/recordings/types";

// getRecordingsErrorMessage maps recordings URL errors into compact Czech UI copy.
function getRecordingsErrorMessage(errorCode: string | null) {
  const messages: Record<string, string> = {
    delete_failed: "Nahrávku se nepodařilo přesunout do Koše.",
    invalid_delete: "Mazání nahrávky nemá platná data.",
    invalid_title: "Název nahrávky není platný.",
    title_update_failed: "Název nahrávky se nepodařilo uložit."
  };

  return errorCode ? messages[errorCode] ?? "Akce nad nahrávkou se nepodařila." : null;
}

// RecordingsManager renders the compact inbox-style all-recordings workspace.
export function RecordingsManager({
  errorCode,
  recordings,
  searchQuery
}: {
  errorCode: string | null;
  recordings: RecordingRow[];
  searchQuery: string;
}) {
  const counts = getRecordingCounts(recordings);
  const hasSearch = Boolean(searchQuery);
  const errorMessage = getRecordingsErrorMessage(errorCode);

  return (
    <section className="recordings-inbox" aria-label="Správa nahrávek">
      <div className="recordings-inbox-header">
        <div>
          <span>Přehled</span>
          <h1>Nahrávky</h1>
          <p>Rychlý přehled všech uložených callů, live záznamů a uploadů.</p>
        </div>
        <div className="recordings-header-action">
          <Link className="recordings-header-new" href="/recordings/new">
            <Plus size={15} />
            Nová nahrávka
          </Link>
        </div>
      </div>
      {errorMessage ? (
        <p className="recordings-alert" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <LiveRecordingRecoveryPanel />
      <form action="/recordings" className="recordings-search">
        <label>
          <span>Hledat</span>
          <input
            defaultValue={searchQuery}
            maxLength={120}
            name="q"
            placeholder="Název, stav, zdroj nebo typ souboru"
            type="search"
          />
        </label>
        <button type="submit">Hledat</button>
        {hasSearch ? <Link href="/recordings">Vyčistit</Link> : null}
      </form>
      {hasSearch ? (
        <p className="recordings-search-status">
          Výsledky pro "{searchQuery}": {recordings.length} nahrávek.
        </p>
      ) : null}
      <div className="recordings-inbox-stats" aria-label="Stavy nahrávek">
        <span><strong>{counts.total}</strong> celkem</span>
        <span><strong>{counts.completed}</strong> dokončeno</span>
        <span><strong>{counts.transcribing}</strong> přepisuje se</span>
        <span><strong>{counts.failed}</strong> chyba</span>
      </div>
      <div className="recordings-table">
        {recordings.length > 0 ? (
          <>
            <div className="recordings-table-head" aria-hidden="true">
              <span>Název</span>
              <span>Stav</span>
              <span>Velikost</span>
              <span>Akce</span>
              <span />
            </div>
            {recordings.map((recording) => (
              <article className="recordings-row" key={recording.id}>
                <Link
                  aria-label={`Detail nahrávky ${recording.title}`}
                  className="recordings-row-main"
                  href={`/recordings/${recording.id}`}
                >
                  <div className="recordings-row-title">
                    <strong>{recording.title}</strong>
                    <span>{formatRecordingDate(recording.created_at)} · {getSourceTypeLabel(recording.source_type)}</span>
                  </div>
                  <span>{getStatusLabel(recording.status)}</span>
                  <span>{formatFileSize(recording.file_size_bytes)}</span>
                </Link>
                <RecordingTitleEditor recordingId={recording.id} title={recording.title} />
                <DeleteRecordingForm recordingId={recording.id} />
              </article>
            ))}
          </>
        ) : (
          <article className="utility-empty">
            <strong>Zatím žádné nahrávky</strong>
            <p>První položka se objeví po live nahrávání nebo uploadu souboru.</p>
          </article>
        )}
      </div>
    </section>
  );
}
