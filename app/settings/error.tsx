"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/panel";

// SettingsError offers a route retry without exposing provider or account internals.
export default function SettingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Panel aria-label="Nastavení se nepodařilo načíst" className="utility-route-state" role="alert"><h1>Nastavení se nepodařilo načíst</h1><p>Uložené preference zůstaly beze změny.</p><div><button onClick={reset} type="button">Zkusit znovu</button><Link href="/recordings">Nahrávky</Link></div></Panel>;
}
