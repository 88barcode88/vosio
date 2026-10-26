"use client";

import Link from "next/link";
import { WorkspaceLoading } from "@/components/workspace/loading";
import { Panel } from "@/components/ui/panel";

// TeamError offers a fresh authorized retry without exposing stale management data or raw backend errors.
export default function TeamError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <WorkspaceLoading view="team"><Panel aria-label="Tým se nepodařilo načíst" className="utility-route-state" role="alert"><h1>Tým se nepodařilo načíst</h1><p>Obnovte přehled a zkuste to znovu.</p><div><button type="button" onClick={reset}>Zkusit znovu</button><Link href="/recordings">Nahrávky</Link></div></Panel></WorkspaceLoading>;
}
