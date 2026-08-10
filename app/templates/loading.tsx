import { Panel } from "@/components/ui/panel";

// TemplatesLoading keeps the prompt document stable while RLS data resolves.
export default function TemplatesLoading() {
  return <Panel aria-busy="true" aria-label="Načítání promptů" className="utility-route-state"><h1>Prompty</h1><p role="status">Načítám šablony…</p></Panel>;
}
