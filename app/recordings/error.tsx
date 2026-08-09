"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/panel";

// RecordingsError exposes a real App Router retry without rendering private error details.
export default function RecordingsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Panel aria-label="Nahrávky se nepodařilo načíst" className="recordings-route-state" role="alert">
      <h1>Nahrávky se nepodařilo načíst</h1>
      <p>Data zůstala beze změny. Zkuste načtení zopakovat nebo založte novou nahrávku.</p>
      <div className="recordings-error-actions">
        <button onClick={reset} type="button">Zkusit znovu</button>
        <Link href="/recordings/new">Nová nahrávka</Link>
      </div>
    </Panel>
  );
}
