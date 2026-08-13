"use client";

const screenStyle: React.CSSProperties = {
  alignItems: "center",
  display: "flex",
  justifyContent: "center",
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
    <main style={screenStyle}>
      <div>
        <h1>Něco se pokazilo</h1>
        <p>Neočekávaná chyba přerušila načtení stránky. Vaše data zůstala uložená.</p>
        <button onClick={reset} style={buttonStyle} type="button">
          Zkusit znovu
        </button>
      </div>
    </main>
  );
}
