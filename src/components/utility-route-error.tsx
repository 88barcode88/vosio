"use client";

import Link from "next/link";

type UtilityRouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
};

// UtilityRouteError reports a sanitized route failure and offers safe recovery actions.
export function UtilityRouteError({ reset, title }: UtilityRouteErrorProps) {
  return (
    <main className="utility-route-state">
      <h1>{title}</h1>
      <p>Obsah se teď nepodařilo načíst. Vaše uložená data zůstala beze změny.</p>
      <div>
        <button onClick={reset} type="button">Zkusit znovu</button>
        <Link href="/recordings">Nahrávky</Link>
      </div>
    </main>
  );
}
