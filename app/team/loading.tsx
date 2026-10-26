import { WorkspaceLoading } from "@/components/workspace/loading";
import { Panel } from "@/components/ui/panel";

// TeamLoading displays no management data while current session authority resolves.
export default function TeamLoading() {
  return <WorkspaceLoading view="team"><Panel aria-busy="true" aria-label="Načítání týmu" className="utility-route-state"><h1>Tým</h1><p role="status">Načítám přehled lidí a přístupů…</p></Panel></WorkspaceLoading>;
}
