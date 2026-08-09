"use client";

import Link from "next/link";

// RecordingsSearchErrorActions retries the current server query or clears it explicitly.
export function RecordingsSearchErrorActions() {
  return (
    <div className="recordings-error-actions">
      <button onClick={() => window.location.reload()} type="button">Zkusit znovu</button>
      <Link href="/recordings">Vyčistit hledání a filtry</Link>
    </div>
  );
}
