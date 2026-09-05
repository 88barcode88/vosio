"use client";

// GlobalError replaces the root layout when even the document shell fails to render.
export default function GlobalError({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="cs">
      <body
        data-utility-route-state="global-error"
        style={{
          alignItems: "center",
          background: "var(--bg, #f4f4f2)",
          color: "var(--text, #171717)",
          display: "flex",
          fontFamily: "Inter, system-ui, sans-serif",
          justifyContent: "center",
          minHeight: "100dvh",
          padding: "24px",
          textAlign: "center"
        }}
      >
        <main
          className="utility-route-state utility-route-state-global-error"
          data-utility-route-state="global-error"
          role="alert"
          style={{
            background: "var(--surface, #ffffff)",
            border: "1px solid var(--border, #d8d8d4)",
            borderRadius: "16px",
            padding: "32px",
            width: "min(100%, 680px)"
          }}
        >
          <h1>Něco se pokazilo</h1>
          <p>Aplikaci se nepodařilo načíst. Zkuste stránku obnovit.</p>
          <button
            onClick={reset}
            style={{
              background: "var(--accent, #171717)",
              border: "1px solid var(--accent, #171717)",
              borderRadius: "10px",
              color: "var(--accent-text, #ffffff)",
              cursor: "pointer",
              marginTop: "1rem",
              minHeight: "44px",
              padding: "0.5rem 1.25rem"
            }}
            type="button"
          >
            Zkusit znovu
          </button>
        </main>
      </body>
    </html>
  );
}
