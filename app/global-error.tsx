"use client";

import { useEffect } from "react";

// GlobalError replaces the root layout when even the document shell fails to render.
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Vosio global error]", error.message, error.digest ?? "");
  }, [error]);

  return (
    <html lang="cs">
      <body
        style={{
          alignItems: "center",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          minHeight: "100vh",
          textAlign: "center"
        }}
      >
        <div>
          <h1>Něco se pokazilo</h1>
          <p>Aplikaci se nepodařilo načíst. Zkuste stránku obnovit.</p>
          <button
            onClick={reset}
            style={{ cursor: "pointer", marginTop: "1rem", minHeight: "40px", padding: "0.5rem 1.25rem" }}
            type="button"
          >
            Zkusit znovu
          </button>
        </div>
      </body>
    </html>
  );
}
