import { Panel } from "@/components/ui/panel";

// SettingsLoading keeps the route boundary explicit while authenticated preferences resolve.
export default function SettingsLoading() {
  return <Panel aria-busy="true" aria-label="Načítání nastavení" className="utility-route-state" data-utility-route-state="loading"><h1>Nastavení</h1><p role="status">Načítám vaše preference…</p></Panel>;
}
