import { Panel } from "@/components/ui/panel";

// AiLoading keeps the archive document stable while RLS joins resolve.
export default function AiLoading() {
  return <Panel aria-busy="true" aria-label="Načítání AI archivu" className="utility-route-state" data-utility-route-state="loading"><h1>AI archiv</h1><p role="status">Načítám uložené výstupy…</p></Panel>;
}
