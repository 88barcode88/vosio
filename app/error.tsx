"use client";

const screenStyle: React.CSSProperties = {
  minHeight: "60vh",
  padding: "2rem",
  textAlign: "center"
};

const buttonStyle: React.CSSProperties = {
  cursor: "pointer",
  marginTop: "1rem",
  minHeight: "44px",
  padding: "0.5rem 1.25rem"
};

// AppError is the sanitized route-level error boundary with a touch-safe retry action.
export default function AppError({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="utility-route-state utility-route-state-error" data-utility-route-state="error" style={screenStyle}>
      <section aria-label="Chyba aplikace" className="utility-route-state-content">
        <h1>Něco se pokazilo</h1>
        <p>Neočekávaná chyba přerušila načtení stránky. Vaše data zůstala uložená.</p>
        <button onClick={reset} style={buttonStyle} type="button">
          Zkusit znovu
        </button>
      </section>
    </main>
  );
}
