"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/panel";

// AiError exposes a real route reset without rendering query or provider details.
export default function AiError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Panel aria-label="AI archiv se nepodařilo načíst" className="utility-route-state" role="alert"><h1>AI archiv se nepodařilo načíst</h1><p>Výstupy zůstaly beze změny. Zkuste načtení zopakovat.</p><div><button onClick={reset} type="button">Zkusit znovu</button><Link href="/recordings">Nahrávky</Link></div></Panel>;
}
