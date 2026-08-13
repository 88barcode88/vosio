import { Panel } from "@/components/ui/panel";

// RecordingsLoading keeps the inbox geometry stable while its authenticated data resolves.
export default function RecordingsLoading() {
  return (
    <Panel aria-busy="true" aria-label="Načítání nahrávek" className="recordings-route-state">
      <h1>Nahrávky</h1>
      <p role="status">Načítám váš inbox…</p>
      <div aria-hidden="true" className="recordings-loading-lines">
        <span />
        <span />
        <span />
      </div>
    </Panel>
  );
}
