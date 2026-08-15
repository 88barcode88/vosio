"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/panel";

// TemplatesError exposes a real route reset without rendering private provider details.
export default function TemplatesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Panel aria-label="AI prompty se nepodařilo načíst" className="utility-route-state" role="alert"><h1>AI prompty se nepodařilo načíst</h1><p>Uložená data zůstala beze změny.</p><div><button onClick={reset} type="button">Zkusit znovu</button><Link href="/recordings">Nahrávky</Link></div></Panel>;
}
